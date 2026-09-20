import os
import shutil
import subprocess
import tempfile
from unittest.mock import patch, MagicMock

import requests
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model

from accounts.models import User
from organizations.models import Organization
from projects.models import Project
from tasks.models import Task
from tasks.application.use_cases import TaskApplicationService

from agents import git_service
from agents.tools import github_tool
from agents.release import (
    ReleaseResult,
    current_branch_head,
    perform_release,
    format_release_comment,
)


class ReleaseModuleTestCase(TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="release-tests-")
        self.projects_root = os.path.join(self.root, "generated_projects")
        os.makedirs(self.projects_root, exist_ok=True)

        self.env_patcher = patch.dict(
            os.environ,
            {
                "WORKSPACE_ROOT": self.root,
                "GIT_AUTHOR_NAME": "DevOps Specialist",
                "GIT_AUTHOR_EMAIL": "devops@teamflow.dev",
                "GITHUB_TOKEN": "",
                "GH_TOKEN": "",
            },
        )
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

        self.root_patcher = patch("agents.git_service.WORKSPACE_ROOT", self.root)
        self.gen_root_patcher = patch("agents.git_service.GENERATED_PROJECTS_ROOT", self.projects_root)
        self.root_patcher.start()
        self.gen_root_patcher.start()
        self.addCleanup(self.root_patcher.stop)
        self.addCleanup(self.gen_root_patcher.stop)
        self.addCleanup(shutil.rmtree, self.root, True)

        self.org = Organization.objects.create(name="Release Org")
        self.user = User.objects.create_user(
            email="lead@teamflow.dev",
            name="Tech Lead",
            role="tech_lead",
            organization=self.org,
            password="password123",
        )
        self.project = Project.objects.create(
            name="Release Project",
            organization=self.org,
            owner=self.user,
            github_repo="teamflow/demo-repo",
        )
        self.task = Task.objects.create(
            project=self.project,
            title="Implement Release Flow",
            description="Ticket for testing release gate.",
            status=Task.Status.QA,
            task_type=Task.Type.FEATURE,
            priority=Task.Priority.HIGH,
            created_by=self.user,
            organization=self.org,
        )

    def _setup_git_repo(self, folder_name="1_release-project", branch="feat/ticket-1-release"):
        ws = os.path.join(self.projects_root, folder_name)
        os.makedirs(ws, exist_ok=True)
        subprocess.run(["git", "init", "-b", "main"], cwd=ws, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.name", "DevOps Specialist"], cwd=ws, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "devops@teamflow.dev"], cwd=ws, capture_output=True, check=True)

        readme_path = os.path.join(ws, "README.md")
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write("# Release Project Initial")
        subprocess.run(["git", "add", "."], cwd=ws, capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "initial commit"], cwd=ws, capture_output=True, check=True)

        subprocess.run(["git", "checkout", "-b", branch], cwd=ws, capture_output=True, check=True)
        feat_path = os.path.join(ws, "feature.txt")
        with open(feat_path, "w", encoding="utf-8") as f:
            f.write("feature commit 1")
        subprocess.run(["git", "add", "."], cwd=ws, capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "feat: first commit"], cwd=ws, capture_output=True, check=True)

        res = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ws, capture_output=True, text=True, check=True)
        sha = res.stdout.strip()
        return ws, sha

    def test_01_perform_release_branch_moved(self):
        ws, initial_sha = self._setup_git_repo()
        # Add a second commit so the branch moves
        feat_path = os.path.join(ws, "feature.txt")
        with open(feat_path, "w", encoding="utf-8") as f:
            f.write("feature commit 2 - moved")
        subprocess.run(["git", "add", "."], cwd=ws, capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "feat: second commit"], cwd=ws, capture_output=True, check=True)

        res_moved = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ws, capture_output=True, text=True, check=True)
        moved_sha = res_moved.stdout.strip()
        self.assertNotEqual(initial_sha, moved_sha)

        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("requests.put") as mock_put:
            result = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=initial_sha,
                repo="teamflow/demo-repo",
                pr_url="https://github.com/teamflow/demo-repo/pull/1",
                actor_email="lead@teamflow.dev",
            )
            mock_put.assert_not_called()
            self.assertFalse(result.merged)
            self.assertEqual(result.merge_mode, "none")
            self.assertEqual(result.merged_sha, "")
            self.assertEqual(result.deployment_status, "skipped")
            self.assertEqual(result.deployment, {})
            self.assertIn("The branch moved since it was approved", result.detail)
            self.assertIn(initial_sha[:7], result.detail)
            self.assertIn(moved_sha[:7], result.detail)

    def test_02_real_pr_token_github_merge_200_and_409(self):
        ws, head_sha = self._setup_git_repo()

        # 2a: GitHub 200 OK
        resp_200 = MagicMock()
        resp_200.status_code = 200
        resp_200.text = '{"sha": "merged_sha_200_hex_abcdef1234567890"}'
        resp_200.json.return_value = {"sha": "merged_sha_200_hex_abcdef1234567890"}

        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("teamflow/demo-repo", "ghp_validtok123456789012345678", "teamflow")), \
             patch("agents.release.trigger_app_deployment", return_value={"ok": True, "deployment_id": 42}) as mock_deploy, \
             patch("requests.put", return_value=resp_200) as mock_put:
            result = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="teamflow/demo-repo",
                pr_url="https://github.com/teamflow/demo-repo/pull/10",
                actor_email="lead@teamflow.dev",
            )
            mock_put.assert_called_once()
            call_url = mock_put.call_args[0][0]
            self.assertIn("/repos/teamflow/demo-repo/pulls/10/merge", call_url)
            self.assertEqual(mock_put.call_args[1]["json"], {"sha": head_sha, "merge_method": "merge"})

            self.assertTrue(result.merged)
            self.assertEqual(result.merge_mode, "github_api")
            self.assertEqual(result.merged_sha, "merged_sha_200_hex_abcdef1234567890")
            self.assertEqual(result.deployment_status, "in_progress")
            self.assertEqual(result.deployment, {"ok": True, "deployment_id": 42})
            self.assertIn("Merged PR #10 into main", result.detail)

            # Ticket transitioned to DONE
            self.task.refresh_from_db()
            self.assertEqual(self.task.status, Task.Status.DONE)
            mock_deploy.assert_called_once()
            self.assertEqual(mock_deploy.call_args[1]["commit_sha"], "merged_sha_200_hex_abcdef1234567890")

        # Reset task status to QA for 2b test
        self.task.status = Task.Status.QA
        self.task.save()

        # 2b: GitHub 409 Conflict
        resp_409 = MagicMock()
        resp_409.status_code = 409
        resp_409.text = '{"message": "Head branch was modified"}'
        resp_409.json.return_value = {"message": "Head branch was modified"}

        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("teamflow/demo-repo", "ghp_validtok123456789012345678", "teamflow")), \
             patch("agents.release.trigger_app_deployment") as mock_deploy_409, \
             patch("requests.put", return_value=resp_409):
            result_409 = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="teamflow/demo-repo",
                pr_url="https://github.com/teamflow/demo-repo/pull/10",
                actor_email="lead@teamflow.dev",
            )
            self.assertFalse(result_409.merged)
            self.assertEqual(result_409.merge_mode, "none")
            self.assertEqual(result_409.merged_sha, "")
            self.assertEqual(result_409.deployment_status, "skipped")
            self.assertIn("Head branch was modified", result_409.detail)

            self.task.refresh_from_db()
            self.assertEqual(self.task.status, Task.Status.QA)
            mock_deploy_409.assert_not_called()

    def test_03_no_repository_linked_local_merge(self):
        ws, head_sha = self._setup_git_repo()

        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("", "", "")), \
             patch("agents.release.trigger_app_deployment", return_value={"ok": True, "deployment_id": 55}) as mock_deploy:
            result = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="",
                pr_url="",
                actor_email="lead@teamflow.dev",
            )
            self.assertTrue(result.merged)
            self.assertEqual(result.merge_mode, "local")
            self.assertEqual(result.merged_sha, head_sha)
            self.assertIn("locally because no GitHub repository is linked", result.detail)
            self.assertEqual(result.deployment_status, "in_progress")

            # Verify local main has feature commit
            res_main = subprocess.run(["git", "rev-parse", "main"], cwd=ws, capture_output=True, text=True, check=True)
            self.assertEqual(res_main.stdout.strip(), head_sha)

            self.task.refresh_from_db()
            self.assertEqual(self.task.status, Task.Status.DONE)
            mock_deploy.assert_called_once()

    def test_03b_local_merge_refuses_when_main_cannot_be_checked_out(self):
        """A failed checkout must never be reported as a merge into main."""
        ws, head_sha = self._setup_git_repo()
        # An uncommitted change to a file that differs between the branch and main blocks `git checkout main`.
        with open(os.path.join(ws, "feature.txt"), "w", encoding="utf-8") as f:
            f.write("uncommitted edit")
        main_before = subprocess.run(["git", "rev-parse", "main"], cwd=ws, capture_output=True, text=True, check=True).stdout.strip()

        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("", "", "")), \
             patch("agents.release.trigger_app_deployment") as mock_deploy:
            result = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="",
                pr_url="",
                actor_email="lead@teamflow.dev",
            )

        self.assertFalse(result.merged)
        self.assertEqual(result.merge_mode, "none")
        self.assertIn("could not switch the workspace to main", result.detail)
        mock_deploy.assert_not_called()
        main_after = subprocess.run(["git", "rev-parse", "main"], cwd=ws, capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(main_after, main_before)
        self.task.refresh_from_db()
        self.assertNotEqual(self.task.status, "done")

    def test_03c_refuses_pull_request_from_another_repository(self):
        """A PR number is only meaningful inside its own repository."""
        ws, head_sha = self._setup_git_repo()
        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("owner/project", "token", "owner")), \
             patch("requests.put") as mock_put:
            result = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="owner/project",
                pr_url="https://github.com/someone-else/other-repo/pull/5",
                actor_email="lead@teamflow.dev",
            )

        self.assertFalse(result.merged)
        self.assertIn("belongs to someone-else/other-repo", result.detail)
        self.assertIn("owner/project", result.detail)
        mock_put.assert_not_called()

    def test_04_repo_linked_but_no_pr_or_only_compare_link(self):
        ws, head_sha = self._setup_git_repo()

        # 4a: No PR URL provided
        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("owner/linked-repo", "token", "owner")), \
             patch("requests.put") as mock_put:
            res_no_pr = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="owner/linked-repo",
                pr_url="",
                actor_email="lead@teamflow.dev",
            )
            mock_put.assert_not_called()
            self.assertFalse(res_no_pr.merged)
            self.assertEqual(res_no_pr.merge_mode, "none")
            self.assertEqual(res_no_pr.deployment_status, "skipped")
            self.assertIn("no pull request was opened", res_no_pr.detail)

        # 4b: Only compare link provided
        compare_url = "https://github.com/owner/linked-repo/compare/main...feat/ticket-1-release?expand=1"
        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("owner/linked-repo", "token", "owner")), \
             patch("requests.put") as mock_put:
            res_compare = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="owner/linked-repo",
                pr_url=compare_url,
                actor_email="lead@teamflow.dev",
            )
            mock_put.assert_not_called()
            self.assertFalse(res_compare.merged)
            self.assertEqual(res_compare.merge_mode, "none")
            self.assertEqual(res_compare.pr_url, "")
            self.assertEqual(res_compare.deployment_status, "skipped")
            self.assertIn("no pull request was opened", res_compare.detail)

    def test_05_deployment_mapping(self):
        ws, head_sha = self._setup_git_repo()
        resp_200 = MagicMock()
        resp_200.status_code = 200
        resp_200.json.return_value = {"sha": head_sha}

        # Case 5a: ok -> in_progress
        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("owner/repo", "token", "owner")), \
             patch("requests.put", return_value=resp_200), \
             patch("agents.release.trigger_app_deployment", return_value={"ok": True, "deployment_id": 77}):
            r = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="owner/repo",
                pr_url="https://github.com/owner/repo/pull/1",
                actor_email="lead@teamflow.dev",
            )
            self.assertEqual(r.deployment_status, "in_progress")
            self.assertIn("Deployment #77 was accepted by the provider", r.deployment_detail)

        # Case 5b: configured is False -> not_configured
        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("owner/repo", "token", "owner")), \
             patch("requests.put", return_value=resp_200), \
             patch("agents.release.trigger_app_deployment", return_value={"ok": False, "configured": False, "error": "No hook configured"}):
            r = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="owner/repo",
                pr_url="https://github.com/owner/repo/pull/1",
                actor_email="lead@teamflow.dev",
            )
            self.assertEqual(r.deployment_status, "not_configured")
            self.assertEqual(r.deployment_detail, "No deployment provider is configured, so no deployment was started.")

        # Case 5c: error / not ok -> failed
        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("owner/repo", "token", "owner")), \
             patch("requests.put", return_value=resp_200), \
             patch("agents.release.trigger_app_deployment", return_value={"ok": False, "error": "Railway API unreachable"}):
            r = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="owner/repo",
                pr_url="https://github.com/owner/repo/pull/1",
                actor_email="lead@teamflow.dev",
            )
            self.assertEqual(r.deployment_status, "failed")
            self.assertIn("No deployment is running: Railway API unreachable", r.deployment_detail)

    def test_06_perform_release_never_raises(self):
        ws, head_sha = self._setup_git_repo()

        # requests.put raises network exception
        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("owner/repo", "token", "owner")), \
             patch("requests.put", side_effect=requests.RequestException("Connection refused")):
            r = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="owner/repo",
                pr_url="https://github.com/owner/repo/pull/1",
                actor_email="lead@teamflow.dev",
            )
            self.assertFalse(r.merged)
            self.assertEqual(r.merge_mode, "none")
            self.assertIn("Connection refused", r.detail)
            self.assertEqual(r.deployment_status, "skipped")

        # task resolution raises internal exception
        with patch("agents.git_service.get_project_workspace", side_effect=RuntimeError("Filesystem corrupted")):
            r2 = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="owner/repo",
                pr_url="https://github.com/owner/repo/pull/1",
                actor_email="lead@teamflow.dev",
            )
            self.assertFalse(r2.merged)
            self.assertEqual(r2.merge_mode, "none")
            # current_branch_head absorbs the error; the result must say the branch was unreadable, not that it moved.
            self.assertIn("could not be resolved", r2.detail)
            self.assertNotIn("moved", r2.detail)

    @patch.dict(os.environ, {"AGENT_PROTECTED_REPOS": "teamflow/platform,owner/protected-repo"})
    def test_07_protected_repository_blocks_both_paths(self):
        ws, head_sha = self._setup_git_repo()

        # Path 1: GitHub API merge attempt
        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("owner/protected-repo", "token", "owner")), \
             patch("requests.put") as mock_put:
            r1 = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="owner/protected-repo",
                pr_url="https://github.com/owner/protected-repo/pull/5",
                actor_email="lead@teamflow.dev",
            )
            mock_put.assert_not_called()
            self.assertFalse(r1.merged)
            self.assertEqual(r1.merge_mode, "none")
            self.assertIn("protected repository", r1.detail)

        # Path 2: Local merge attempt where origin remote is protected
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/owner/protected-repo.git"], cwd=ws, capture_output=True, check=True)
        with patch("agents.git_service.get_project_workspace", return_value=ws), \
             patch("agents.git_service._resolve_project_repo_and_token", return_value=("", "", "")):
            r2 = perform_release(
                self.task,
                branch="feat/ticket-1-release",
                expected_head_sha=head_sha,
                repo="",
                pr_url="",
                actor_email="lead@teamflow.dev",
            )
            self.assertFalse(r2.merged)
            self.assertEqual(r2.merge_mode, "none")
            self.assertIn("protected repository", r2.detail)

    def test_08_ensure_origin_configured_clean_and_credentials_in_env_only(self):
        ws = os.path.join(self.projects_root, "clean_origin_ws")
        os.makedirs(ws, exist_ok=True)
        subprocess.run(["git", "init", "-b", "main"], cwd=ws, capture_output=True, check=True)

        token = "ghp_supersecretpat1234567890123456"

        # Pre-existing tokenized remote
        subprocess.run(
            ["git", "remote", "add", "origin", f"https://x-access-token:{token}@github.com/owner/sample.git"],
            cwd=ws,
            capture_output=True,
            check=True,
        )

        # Call _ensure_origin_configured
        cleaned_url = git_service._ensure_origin_configured(ws, "owner/sample", token)
        self.assertEqual(cleaned_url, "https://github.com/owner/sample.git")

        # Verify remote.origin.url in git config is completely clean
        cfg_out = subprocess.run(["git", "config", "remote.origin.url"], cwd=ws, capture_output=True, text=True, check=True)
        self.assertEqual(cfg_out.stdout.strip(), "https://github.com/owner/sample.git")

        # Verify config file on disk has no token
        with open(os.path.join(ws, ".git", "config"), "r", encoding="utf-8") as f:
            cfg_content = f.read()
        self.assertNotIn(token, cfg_content)

        # Test push/pull credential propagation in GIT_CONFIG_* env vars, not argv
        def fake_git(argv, *args, **kwargs):
            # Behave like a repository whose origin is already configured.
            if argv[-1:] == ["remote"]:
                return MagicMock(returncode=0, stdout="origin\n", stderr="")
            if "get-url" in argv:
                return MagicMock(returncode=0, stdout="https://github.com/owner/sample.git\n", stderr="")
            return MagicMock(returncode=0, stdout="", stderr="")

        with patch("subprocess.run", side_effect=fake_git) as mock_subproc:
            git_service.git_push("feat/branch", cwd=ws, token=token)

        calls = mock_subproc.call_args_list
        push_calls = [c for c in calls if "push" in c[0][0]]
        self.assertTrue(push_calls, "git_push never ran `git push`")

        # The token never appears in any command's arguments.
        for c in calls:
            for arg in c[0][0]:
                self.assertNotIn(token, arg)

        # The push receives the credential only through GIT_CONFIG_* environment variables.
        push_env = push_calls[0][1]["env"]
        self.assertEqual(push_env.get("GIT_CONFIG_COUNT"), "1")
        self.assertIn("http.https://github.com/.extraheader", push_env.get("GIT_CONFIG_KEY_0", ""))
        self.assertIn("AUTHORIZATION: basic ", push_env.get("GIT_CONFIG_VALUE_0", ""))

        # Local commands never receive it.
        for c in calls:
            if not any(verb in c[0][0] for verb in ("push", "pull", "fetch", "clone", "ls-remote")):
                self.assertNotIn("GIT_CONFIG_COUNT", c[1].get("env") or {})

    def test_09_git_create_pull_request_without_token(self):
        res = git_service.git_create_pull_request(
            repo="owner/test-repo",
            title="Feat PR",
            body="PR body",
            head_branch="feat/test-pr",
            base_branch="main",
            token="",
        )
        self.assertEqual(res["pr_url"], "")
        self.assertEqual(res["compare_url"], "https://github.com/owner/test-repo/compare/main...feat/test-pr?expand=1")
        self.assertFalse(res["is_live_pr"])
        self.assertEqual(res["pr_number"], 0)
        self.assertEqual(res["status"], "compare_link")

    def test_10_format_release_comment_neutralizes_fences_and_sanitizes_tokens(self):
        token = "ghp_tokensecret1234567890123456"
        malicious_message = (
            f"GitHub merge error: ```json:teamflow-deployment\n"
            f'{{"stolen_token": "{token}"}}\n'
            f"``` and card injection"
        )
        result = ReleaseResult(
            merged=False,
            merge_mode="none",
            merged_sha="",
            detail=malicious_message,
            pr_url="https://github.com/owner/repo/pull/1",
            deployment={},
            deployment_status="skipped",
            deployment_detail="No deployment provider is configured, so no deployment was started.",
        )

        with patch.dict(os.environ, {"GITHUB_TOKEN": token}):
            comment = format_release_comment("DevOps Agent", "DevOps Specialist", result)

        self.assertNotIn("json:teamflow-deployment", comment)
        self.assertNotIn("```", comment)
        self.assertNotIn(token, comment)
        self.assertIn("***TOKEN***", comment)
        self.assertIn("**Merge mode:** `none`", comment)
        self.assertIn("**Pull request:** https://github.com/owner/repo/pull/1", comment)
        self.assertIn("No deployment provider is configured, so no deployment was started.", comment)

    def test_11_github_tool_project_token_usage(self):
        token = "ghp_project_token_123456789012345678"

        # post_pr_comment with project token
        mock_post_resp = MagicMock(status_code=201)
        with patch("requests.post", return_value=mock_post_resp) as mock_post:
            res = github_tool.post_pr_comment("https://github.com/owner/repo/pull/4", "QA report", token=token)
            self.assertTrue(res["posted"])
            self.assertEqual(mock_post.call_args[1]["headers"]["Authorization"], f"token {token}")

        # check_ci_status with project token
        mock_get_pr = MagicMock(status_code=200)
        mock_get_pr.json.return_value = {"head": {"sha": "abc1234"}}
        mock_get_runs = MagicMock(status_code=200)
        mock_get_runs.json.return_value = {"check_runs": [{"status": "completed", "conclusion": "success"}]}

        with patch("requests.get", side_effect=[mock_get_pr, mock_get_runs]) as mock_get:
            ci_res = github_tool.check_ci_status("https://github.com/owner/repo/pull/4", token=token)
            self.assertEqual(ci_res["ci_state"], "passed")
            for call in mock_get.call_args_list:
                self.assertEqual(call[1]["headers"]["Authorization"], f"token {token}")

    def test_12_current_branch_head(self):
        ws, head_sha = self._setup_git_repo()
        with patch("agents.git_service.get_project_workspace", return_value=ws):
            found_sha = current_branch_head(self.task, "feat/ticket-1-release")
            self.assertEqual(found_sha, head_sha)

            missing_sha = current_branch_head(self.task, "nonexistent-branch")
            self.assertEqual(missing_sha, "")
