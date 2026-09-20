import os
import tempfile
from unittest.mock import MagicMock, patch

import requests
import yaml
from django.test import SimpleTestCase

from agents.git_service import (
    autonomous_git_pipeline,
    bootstrap_new_project_repo,
)
from agents.verification.github_executor import GitHubActionsExecutor
from agents.verification.result import StepResult, VerificationResult
from agents.verification.workflow_template import (
    WORKFLOW_PATH,
    WORKFLOW_TEMPLATE,
    ensure_verification_workflow,
)


class MockClock:
    def __init__(self, start: float = 1000.0, step: float = 30.0) -> None:
        self.current = start
        self.step = step

    def __call__(self) -> float:
        val = self.current
        self.current += self.step
        return val


class GitHubVerificationTestCase(SimpleTestCase):
    databases = set()


class TestGitHubExecutorAvailable(GitHubVerificationTestCase):
    def test_missing_repo_or_token(self) -> None:
        # Condition 1: Missing repo
        exec_no_repo = GitHubActionsExecutor(repo="", token="valid-token")
        usable, reason = exec_no_repo.available(workspace="/fake", ref="HEAD")
        self.assertFalse(usable)
        self.assertEqual(reason, "no GitHub repository or token is configured for this project")

        # Condition 1: Missing token
        exec_no_token = GitHubActionsExecutor(repo="owner/repo", token="")
        usable, reason = exec_no_token.available(workspace="/fake", ref="HEAD")
        self.assertFalse(usable)
        self.assertEqual(reason, "no GitHub repository or token is configured for this project")

    @patch("subprocess.run")
    def test_missing_workspace_fails_closed_without_subprocess(self, mock_subproc: MagicMock) -> None:
        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token")
        usable, reason = executor.available()
        self.assertFalse(usable)
        self.assertEqual(reason, "no project workspace was given to the GitHub Actions executor")
        mock_subproc.assert_not_called()

    @patch("subprocess.run")
    def test_sha_not_resolved_locally(self, mock_subproc: MagicMock) -> None:
        # Condition 2: Git rev-parse fails
        mock_subproc.return_value = MagicMock(returncode=1, stdout="", stderr="fatal: Not a valid object name HEAD")
        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token", workspace="/fake")
        usable, reason = executor.available()
        self.assertFalse(usable)
        self.assertEqual(reason, "commit 'HEAD' could not be resolved locally")

    @patch("requests.get")
    @patch("subprocess.run")
    def test_commit_not_pushed(self, mock_subproc: MagicMock, mock_get: MagicMock) -> None:
        # Condition 3: Commit not found on remote (404)
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")
        mock_get.return_value = MagicMock(status_code=404)

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token", workspace="/fake")
        usable, reason = executor.available()
        self.assertFalse(usable)
        self.assertEqual(reason, "commit abcdef1 has not been pushed to owner/repo")

    @patch("requests.get")
    @patch("subprocess.run")
    def test_workflow_file_missing_in_repo(self, mock_subproc: MagicMock, mock_get: MagicMock) -> None:
        # Condition 4: Commit exists (200), but workflow file not found (404)
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")
        mock_get.side_effect = [
            MagicMock(status_code=200),  # commit check
            MagicMock(status_code=404),  # workflow file check
        ]

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token", workspace="/fake")
        usable, reason = executor.available()
        self.assertFalse(usable)
        self.assertEqual(reason, f"the repository has no TeamFlow verification workflow at {WORKFLOW_PATH}")

    @patch("requests.get")
    @patch("subprocess.run")
    def test_requests_exception_handled(self, mock_subproc: MagicMock, mock_get: MagicMock) -> None:
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")
        mock_get.side_effect = requests.RequestException("Connection reset by peer")

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token", workspace="/fake")
        usable, reason = executor.available()
        self.assertFalse(usable)
        self.assertIn("Connection reset by peer", reason)

    @patch("requests.get")
    @patch("subprocess.run")
    def test_all_conditions_satisfied(self, mock_subproc: MagicMock, mock_get: MagicMock) -> None:
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")
        mock_get.side_effect = [
            MagicMock(status_code=200),  # commit exists
            MagicMock(status_code=200),  # workflow exists
        ]

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token", workspace="/fake")
        usable, reason = executor.available()
        self.assertTrue(usable)
        self.assertEqual(reason, "")


class TestGitHubExecutorRun(GitHubVerificationTestCase):
    @patch("subprocess.run")
    def test_run_missing_workspace(self, mock_subproc: MagicMock) -> None:
        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token")
        res = executor.run(workspace="", ref="HEAD")
        self.assertEqual(res.status, "unverified")
        self.assertEqual(res.reason, "no project workspace was given to the GitHub Actions executor")
        mock_subproc.assert_not_called()

    @patch("time.sleep", return_value=None)
    @patch("time.monotonic")
    @patch("requests.get")
    @patch("subprocess.run")
    def test_run_never_appears(
        self,
        mock_subproc: MagicMock,
        mock_get: MagicMock,
        mock_monotonic: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")
        mock_monotonic.side_effect = MockClock(start=1000.0, step=45.0)

        resp = MagicMock(status_code=200)
        resp.json.return_value = {"workflow_runs": []}
        mock_get.return_value = resp

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token", poll_interval=10)
        res = executor.run(workspace="/fake", ref="HEAD")

        self.assertEqual(res.status, "unverified")
        self.assertEqual(res.executor, "github_actions")
        self.assertEqual(res.reason, "the verification workflow did not start for commit abcdef1")

    @patch("time.sleep", return_value=None)
    @patch("time.monotonic")
    @patch("requests.get")
    @patch("subprocess.run")
    def test_run_stays_in_progress_past_budget(
        self,
        mock_subproc: MagicMock,
        mock_get: MagicMock,
        mock_monotonic: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")
        # 1000 (start), 1001 (discovery while condition), 1500 (poll loop timeout check), 1500 (duration)
        mock_monotonic.side_effect = [1000.0, 1001.0, 1500.0, 1500.0]

        run_obj = {
            "id": 101,
            "path": WORKFLOW_PATH,
            "event": "push",
            "status": "in_progress",
            "html_url": "https://github.com/owner/repo/actions/runs/101",
        }

        runs_list_resp = MagicMock(status_code=200)
        runs_list_resp.json.return_value = {"workflow_runs": [run_obj]}

        mock_get.side_effect = [runs_list_resp]

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token", poll_interval=10)
        res = executor.run(workspace="/fake", ref="HEAD", timeout=300)

        self.assertEqual(res.status, "unverified")
        self.assertEqual(res.details_url, "https://github.com/owner/repo/actions/runs/101")
        self.assertIn("in_progress", res.reason)

    @patch("time.sleep", return_value=None)
    @patch("requests.get")
    @patch("subprocess.run")
    def test_run_success(
        self,
        mock_subproc: MagicMock,
        mock_get: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")

        run_obj = {
            "id": 102,
            "path": WORKFLOW_PATH,
            "event": "push",
            "status": "completed",
            "conclusion": "success",
            "html_url": "https://github.com/owner/repo/actions/runs/102",
        }

        jobs_obj = {
            "jobs": [
                {
                    "id": 201,
                    "conclusion": "success",
                    "steps": [
                        {
                            "name": "Checkout Code",
                            "conclusion": "success",
                            "started_at": "2026-09-19T10:00:00Z",
                            "completed_at": "2026-09-19T10:00:05Z",
                        },
                        {
                            "name": "TeamFlow Verification",
                            "conclusion": "success",
                            "started_at": "2026-09-19T10:00:05Z",
                            "completed_at": "2026-09-19T10:01:05Z",
                        },
                    ],
                }
            ]
        }

        runs_resp = MagicMock(status_code=200)
        runs_resp.json.return_value = {"workflow_runs": [run_obj]}

        jobs_resp = MagicMock(status_code=200)
        jobs_resp.json.return_value = jobs_obj

        mock_get.side_effect = [runs_resp, jobs_resp]

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token")
        res = executor.run(workspace="/fake", ref="HEAD")

        self.assertEqual(res.status, "passed")
        self.assertEqual(res.details_url, "https://github.com/owner/repo/actions/runs/102")
        self.assertEqual(len(res.steps), 2)
        for s in res.steps:
            self.assertIsNone(s.exit_code)
            self.assertEqual(s.conclusion, "success")
            self.assertEqual(s.cwd, ".")
        self.assertEqual(res.steps[0].duration_s, 5.0)
        self.assertEqual(res.steps[1].duration_s, 60.0)

    @patch("time.sleep", return_value=None)
    @patch("requests.get")
    @patch("subprocess.run")
    def test_run_failure_with_log_tail(
        self,
        mock_subproc: MagicMock,
        mock_get: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")

        run_obj = {
            "id": 103,
            "path": WORKFLOW_PATH,
            "event": "push",
            "status": "completed",
            "conclusion": "failure",
            "html_url": "https://github.com/owner/repo/actions/runs/103",
        }

        jobs_obj = {
            "jobs": [
                {
                    "id": 301,
                    "conclusion": "failure",
                    "steps": [
                        {
                            "name": "Checkout Code",
                            "conclusion": "success",
                            "started_at": "2026-09-19T10:00:00Z",
                            "completed_at": "2026-09-19T10:00:05Z",
                        },
                        {
                            "name": "TeamFlow Verification",
                            "conclusion": "failure",
                            "started_at": "2026-09-19T10:00:05Z",
                            "completed_at": "2026-09-19T10:00:25Z",
                        },
                    ],
                }
            ]
        }

        runs_resp = MagicMock(status_code=200)
        runs_resp.json.return_value = {"workflow_runs": [run_obj]}

        jobs_resp = MagicMock(status_code=200)
        jobs_resp.json.return_value = jobs_obj

        logs_resp = MagicMock(status_code=200, text="Build error: module not found in src/index.ts")

        mock_get.side_effect = [runs_resp, jobs_resp, logs_resp]

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token")
        res = executor.run(workspace="/fake", ref="HEAD")

        self.assertEqual(res.status, "failed")
        self.assertIn("TeamFlow Verification", res.reason)
        failed_steps = res.failed_steps
        self.assertEqual(len(failed_steps), 1)
        self.assertEqual(failed_steps[0].name, "TeamFlow Verification")
        self.assertIn("Build error: module not found", failed_steps[0].output_tail)

    @patch("time.sleep", return_value=None)
    @patch("requests.get")
    @patch("subprocess.run")
    def test_run_cancelled(
        self,
        mock_subproc: MagicMock,
        mock_get: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")

        run_obj = {
            "id": 104,
            "path": WORKFLOW_PATH,
            "event": "push",
            "status": "completed",
            "conclusion": "cancelled",
            "html_url": "https://github.com/owner/repo/actions/runs/104",
        }

        runs_resp = MagicMock(status_code=200)
        runs_resp.json.return_value = {"workflow_runs": [run_obj]}

        jobs_resp = MagicMock(status_code=200)
        jobs_resp.json.return_value = {"jobs": []}

        mock_get.side_effect = [runs_resp, jobs_resp]

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token")
        res = executor.run(workspace="/fake", ref="HEAD")

        self.assertEqual(res.status, "unverified")
        self.assertEqual(res.reason, "GitHub Actions run concluded cancelled")
        self.assertEqual(res.details_url, "https://github.com/owner/repo/actions/runs/104")

    @patch("requests.get")
    @patch("subprocess.run")
    def test_requests_exception_mid_run_never_escapes(
        self,
        mock_subproc: MagicMock,
        mock_get: MagicMock,
    ) -> None:
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")
        mock_get.side_effect = requests.RequestException("Mid-run network disconnection")

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token")
        res = executor.run(workspace="/fake", ref="HEAD")

        self.assertEqual(res.status, "unverified")
        self.assertIn("Mid-run network disconnection", res.reason)


class TestRunSelectionPreference(GitHubVerificationTestCase):
    @patch("time.sleep", return_value=None)
    @patch("requests.get")
    @patch("subprocess.run")
    def test_run_selection_prefers_workflow_path_and_push(
        self,
        mock_subproc: MagicMock,
        mock_get: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")

        runs = [
            # Different workflow
            {
                "id": 1,
                "path": ".github/workflows/other.yml",
                "event": "push",
                "status": "completed",
                "conclusion": "failure",
                "html_url": "url-1",
            },
            # Matching workflow with pull_request
            {
                "id": 2,
                "path": WORKFLOW_PATH,
                "event": "pull_request",
                "status": "completed",
                "conclusion": "failure",
                "html_url": "url-2",
            },
            # Matching workflow with push (should be preferred!)
            {
                "id": 3,
                "path": WORKFLOW_PATH,
                "event": "push",
                "status": "completed",
                "conclusion": "success",
                "html_url": "url-3",
            },
        ]

        runs_resp = MagicMock(status_code=200)
        runs_resp.json.return_value = {"workflow_runs": runs}

        jobs_resp = MagicMock(status_code=200)
        jobs_resp.json.return_value = {"jobs": []}

        mock_get.side_effect = [runs_resp, jobs_resp]

        executor = GitHubActionsExecutor(repo="owner/repo", token="valid-token")
        res = executor.run(workspace="/fake", ref="HEAD")

        # Must pick run id=3
        self.assertEqual(res.details_url, "url-3")
        self.assertEqual(res.status, "passed")


class TestTokenSanitizationAndLogging(GitHubVerificationTestCase):
    @patch("time.sleep", return_value=None)
    @patch("requests.get")
    @patch("subprocess.run")
    def test_token_string_scrubbed_and_never_logged(
        self,
        mock_subproc: MagicMock,
        mock_get: MagicMock,
        mock_sleep: MagicMock,
    ) -> None:
        secret_token = "ghp_123456789012345678901234567890123456"
        mock_subproc.return_value = MagicMock(returncode=0, stdout="abcdef1234567890\n")

        run_obj = {
            "id": 105,
            "path": WORKFLOW_PATH,
            "event": "push",
            "status": "completed",
            "conclusion": "failure",
            "html_url": "https://github.com/owner/repo/actions/runs/105",
        }

        jobs_obj = {
            "jobs": [
                {
                    "id": 401,
                    "conclusion": "failure",
                    "steps": [
                        {
                            "name": "TeamFlow Verification",
                            "conclusion": "failure",
                            "started_at": "2026-09-19T10:00:00Z",
                            "completed_at": "2026-09-19T10:00:10Z",
                        }
                    ],
                }
            ]
        }

        runs_resp = MagicMock(status_code=200)
        runs_resp.json.return_value = {"workflow_runs": [run_obj]}

        jobs_resp = MagicMock(status_code=200)
        jobs_resp.json.return_value = jobs_obj

        logs_resp = MagicMock(
            status_code=200,
            text=f"Authentication error: leaked token={secret_token} while checking out",
        )

        mock_get.side_effect = [runs_resp, jobs_resp, logs_resp]

        executor = GitHubActionsExecutor(repo="owner/repo", token=secret_token)

        with self.assertLogs("agents.verification.github_executor", level="INFO") as cm:
            res = executor.run(workspace="/fake", ref="HEAD")

        # 1. Output tail must have scrubbed token
        self.assertEqual(res.status, "failed")
        self.assertNotIn(secret_token, res.failed_steps[0].output_tail)
        self.assertIn("***TOKEN***", res.failed_steps[0].output_tail)

        # 2. Token must never be present in any log output
        for log_line in cm.output:
            self.assertNotIn(secret_token, log_line)


class TestWorkflowTemplate(GitHubVerificationTestCase):
    def test_ensure_verification_workflow_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            # First call: writes workflow and returns True
            created = ensure_verification_workflow(tmp_dir)
            self.assertTrue(created)
            target_path = os.path.join(tmp_dir, WORKFLOW_PATH)
            self.assertTrue(os.path.exists(target_path))

            # Second call: already exists, returns False
            created_again = ensure_verification_workflow(tmp_dir)
            self.assertFalse(created_again)

            # Custom modifications are preserved
            with open(target_path, "w", encoding="utf-8") as f:
                f.write("custom: workflow content")

            created_third = ensure_verification_workflow(tmp_dir)
            self.assertFalse(created_third)
            with open(target_path, "r", encoding="utf-8") as f:
                self.assertEqual(f.read(), "custom: workflow content")

    def test_workflow_template_syntax_and_contents(self) -> None:
        # 1. Parses as valid YAML
        parsed = yaml.safe_load(WORKFLOW_TEMPLATE)
        self.assertIsInstance(parsed, dict)

        # 2. Permissions: contents: read
        self.assertEqual(parsed.get("permissions"), {"contents": "read"})

        # 3. Contains --ignore-scripts
        self.assertIn("--ignore-scripts", WORKFLOW_TEMPLATE)

        # 4. Contains no secrets. references
        self.assertNotIn("secrets.", WORKFLOW_TEMPLATE)

        # 5. Contains "No build toolchain was detected" failure path
        self.assertIn("No build toolchain was detected", WORKFLOW_TEMPLATE)

        # 6. compileall exclusion matches local
        self.assertIn(r"-x '[/\\]\.venv'", WORKFLOW_TEMPLATE)

        # 7. Test discovery without maxdepth and without grep -q
        self.assertIn(r'[ -n "$(find .', WORKFLOW_TEMPLATE)
        self.assertNotIn(r"maxdepth 3", WORKFLOW_TEMPLATE)

        # 8. npm placeholder test detection handles both 'no test specified' and 'exit 1'
        self.assertIn("no test specified", WORKFLOW_TEMPLATE)
        self.assertIn("exit 1", WORKFLOW_TEMPLATE)


class TestGitServiceIntegration(GitHubVerificationTestCase):
    @patch("agents.git_service.is_isolated_workspace", return_value=True)
    @patch("agents.git_service._configure_git_identity")
    @patch("agents.git_service.git_create_pull_request")
    @patch("agents.git_service.git_push")
    @patch("agents.git_service.git_commit")
    @patch("agents.git_service.run_project_build")
    @patch("agents.git_service.git_checkout_branch")
    @patch("agents.git_service.git_pull")
    def test_autonomous_git_pipeline_appends_workflow(
        self,
        mock_pull: MagicMock,
        mock_checkout: MagicMock,
        mock_build: MagicMock,
        mock_commit: MagicMock,
        mock_push: MagicMock,
        mock_pr: MagicMock,
        mock_identity: MagicMock,
        mock_iso: MagicMock,
    ) -> None:
        mock_build.return_value = {"success": True, "output": "ok"}
        mock_commit.return_value = {"success": True, "committed": True}

        # Case A: files_written is a list -> WORKFLOW_PATH is appended
        with tempfile.TemporaryDirectory() as tmp_dir:
            files_written = ["app.py"]
            autonomous_git_pipeline(
                project_workspace=tmp_dir,
                branch_name="feat/test",
                commit_message="feat: test",
                author_name="Agent",
                author_email="agent@teamflow.local",
                files_written=files_written,
                run_build=True,
            )
            self.assertIn(WORKFLOW_PATH, files_written)
            mock_commit.assert_called_with(
                message="feat: test",
                author_name="Agent",
                author_email="agent@teamflow.local",
                files=files_written,
                cwd=tmp_dir,
            )

        # Case B: files_written is None -> remains None
        with tempfile.TemporaryDirectory() as tmp_dir:
            autonomous_git_pipeline(
                project_workspace=tmp_dir,
                branch_name="feat/test-none",
                commit_message="feat: test none",
                author_name="Agent",
                author_email="agent@teamflow.local",
                files_written=None,
                run_build=True,
            )
            mock_commit.assert_called_with(
                message="feat: test none",
                author_name="Agent",
                author_email="agent@teamflow.local",
                files=None,
                cwd=tmp_dir,
            )

    @patch("agents.git_service.is_isolated_workspace", return_value=True)
    @patch("agents.git_service._configure_git_identity")
    @patch("agents.git_service._run_git_command")
    def test_bootstrap_readme_and_workflow(
        self,
        mock_git: MagicMock,
        mock_identity: MagicMock,
        mock_iso: MagicMock,
    ) -> None:
        mock_git.return_value = {"success": True, "stdout": "", "stderr": ""}

        with tempfile.TemporaryDirectory() as tmp_dir:
            bootstrap_new_project_repo(project_dir=tmp_dir, project_name="DemoApp")

            readme_path = os.path.join(tmp_dir, "README.md")
            self.assertTrue(os.path.exists(readme_path))

            with open(readme_path, "r", encoding="utf-8") as f:
                readme_text = f.read()

            self.assertNotIn("ci.yml", readme_text)
            self.assertIn("teamflow-verify.yml", readme_text)

            workflow_file = os.path.join(tmp_dir, WORKFLOW_PATH)
            self.assertTrue(os.path.exists(workflow_file))

            ci_file = os.path.join(tmp_dir, ".github", "workflows", "ci.yml")
            self.assertFalse(os.path.exists(ci_file))
