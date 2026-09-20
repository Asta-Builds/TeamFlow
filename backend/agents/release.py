"""
Release Gate and Deployment Module for TeamFlow Agent Swarm.
Enforces human approval invariants, commit pinning, honest pull request merges,
and staging deployment triggers.
"""

from dataclasses import dataclass, asdict
import logging
from typing import Dict, Any, Optional
import requests
from django.conf import settings

from agents import git_service
from agents.tools import github_tool
from agents.tools.app_tool import trigger_app_deployment
from agents.untrusted_text import neutralize_untrusted_markdown
from agents.git_service import sanitize_sensitive_data, is_protected_repo

logger = logging.getLogger(__name__)


@dataclass
class ReleaseResult:
    merged: bool
    merge_mode: str            # "github_api" | "local" | "none"
    merged_sha: str            # "" when not merged
    detail: str                # one plain sentence about the merge, e.g. "Merged PR #12 into main at abc1234 through GitHub."
    pr_url: str                # the real pull request URL when one exists, else ""
    deployment: Dict[str, Any] # trigger_app_deployment's return value, or {} when no deployment was requested
    deployment_status: str     # "in_progress" | "not_configured" | "failed" | "skipped"
    deployment_detail: str     # one plain sentence about the deployment
    ticket_moved_to_done: bool = False  # only True when the ticket really reached Done

    def to_dict(self) -> dict:
        return asdict(self)


def current_branch_head(task, branch: str) -> str:
    """SHA of `branch` in the task's project workspace, or "" when it cannot be resolved."""
    if not task or not branch:
        return ""
    try:
        workspace = git_service.get_project_workspace(task)
        if not workspace or not git_service.is_isolated_workspace(workspace):
            return ""
        res = git_service._run_git_command(["rev-parse", "--verify", f"{branch}^{{commit}}"], cwd=workspace)
        if not res.get("success"):
            res = git_service._run_git_command(["rev-parse", "--verify", branch], cwd=workspace)
        if res.get("success"):
            return res.get("stdout", "").strip()
        return ""
    except Exception as exc:
        logger.warning("Could not resolve current branch head for %s: %s", branch, exc)
        return ""


def _resolve_actor(task, actor_email: str):
    if not task:
        return None
    try:
        from django.contrib.auth import get_user_model
        User = get_user_model()
        org = getattr(task, "organization", None) or (
            getattr(task.project, "organization", None)
            if hasattr(task, "project") and task.project
            else None
        )
        if actor_email:
            user = None
            if org:
                user = User.objects.filter(email=actor_email, organization=org).first()
            if not user:
                user = User.objects.filter(email=actor_email).first()
            if user:
                return user
            if org:
                try:
                    from agents.tools.app_tool import _agent_for_organization
                    return _agent_for_organization(org, actor_email)
                except Exception:
                    pass
        return getattr(task, "assignee", None)
    except Exception:
        return None


def perform_release(
    task,
    *,
    branch: str,
    expected_head_sha: str,
    repo: str,
    pr_url: str,
    actor_email: str,
) -> ReleaseResult:
    """Merge exactly expected_head_sha of branch into main, then request a staging deployment.
    Never raises."""
    try:
        # Determine whether pr_url is a real pull request URL
        parsed_pr = github_tool._parse_pr_url(pr_url)
        real_pr_url = pr_url.strip() if parsed_pr else ""

        # 1. Check head sha matches expected_head_sha
        head_sha = current_branch_head(task, branch)
        expected_sha = (expected_head_sha or "").strip()
        if not expected_sha or not head_sha or head_sha != expected_sha:
            if not expected_sha:
                head_detail = "No approved commit was recorded for this release; nothing was merged."
            elif not head_sha:
                head_detail = f"The branch {branch} could not be resolved in the project workspace; nothing was merged."
            else:
                head_detail = (
                    f"The branch moved since it was approved (expected {expected_sha[:7]}, "
                    f"found {head_sha[:7]}); nothing was merged."
                )
            return ReleaseResult(
                merged=False,
                merge_mode="none",
                merged_sha="",
                detail=head_detail,
                pr_url=real_pr_url,
                deployment={},
                deployment_status="skipped",
                deployment_detail="Deployment was skipped because the branch was not merged.",
            )

        workspace = git_service.get_project_workspace(task)
        resolved_repo, token, _ = git_service._resolve_project_repo_and_token(workspace, task)
        effective_repo = (repo or resolved_repo).strip()

        # 5. Protected repository guard
        if is_protected_repo(effective_repo):
            return ReleaseResult(
                merged=False,
                merge_mode="none",
                merged_sha="",
                detail=f"Refusing to merge: {effective_repo} is a protected repository.",
                pr_url=real_pr_url,
                deployment={},
                deployment_status="skipped",
                deployment_detail="Deployment was skipped because the branch was not merged.",
            )

        if workspace and git_service.is_isolated_workspace(workspace):
            origin_res = git_service._run_git_command(["remote", "get-url", "origin"], cwd=workspace)
            if is_protected_repo(origin_res.get("stdout", "")):
                return ReleaseResult(
                    merged=False,
                    merge_mode="none",
                    merged_sha="",
                    detail="Refusing to merge: the workspace remote is a protected repository.",
                    pr_url=real_pr_url,
                    deployment={},
                    deployment_status="skipped",
                    deployment_detail="Deployment was skipped because the branch was not merged.",
                )

        merged = False
        merge_mode = "none"
        merged_sha = ""
        merge_detail = ""

        # 2. A real pull request exists and token resolves
        if parsed_pr:
            pr_repo, pr_num = parsed_pr
            target_repo = pr_repo
            if is_protected_repo(pr_repo):
                merge_detail = f"Refusing to merge: {pr_repo} is a protected repository."
            elif effective_repo and pr_repo.lower() != effective_repo.lower():
                # The PR number only identifies a change inside its own repository.
                merge_detail = (
                    f"Refusing to merge: pull request #{pr_num} belongs to {pr_repo}, "
                    f"but this project's repository is {effective_repo}."
                )
            elif token and "/" in target_repo:
                api_url = f"{settings.GITHUB_API_URL}/repos/{target_repo}/pulls/{pr_num}/merge"
                headers = {
                    "Authorization": f"token {token}",
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "TeamFlow-Agent-Swarm",
                }
                payload = {
                    "sha": expected_sha,
                    "merge_method": "merge",
                }
                try:
                    resp = requests.put(api_url, json=payload, headers=headers, timeout=15)
                    if resp.status_code == 200:
                        resp_data = resp.json() if resp.text else {}
                        # GitHub's merge commit is a different commit from the branch head;
                        # never substitute the head when GitHub did not report one.
                        merged_sha = (resp_data.get("sha") or "").strip()
                        merged = True
                        merge_mode = "github_api"
                        if merged_sha:
                            merge_detail = f"Merged PR #{pr_num} into main at {merged_sha[:7]} through GitHub."
                        else:
                            merge_detail = f"Merged PR #{pr_num} into main through GitHub; it did not report the merge commit."

                        # Bring workspace local main up to date
                        if workspace and git_service.is_isolated_workspace(workspace):
                            git_service._run_git_command(["checkout", "main"], cwd=workspace)
                            pull_res = git_service.git_pull("main", cwd=workspace, token=token)
                            if not pull_res.get("success"):
                                pull_err = sanitize_sensitive_data(pull_res.get("output", ""))
                                merge_detail += f" Local main could not be fast-forwarded: {pull_err}"
                    elif resp.status_code in (405, 409):
                        try:
                            err_json = resp.json()
                            gh_msg = err_json.get("message", resp.text)
                        except Exception:
                            gh_msg = resp.text
                        clean_msg = sanitize_sensitive_data(gh_msg)
                        merged = False
                        merge_mode = "none"
                        merged_sha = ""
                        merge_detail = f"GitHub refused to merge PR #{pr_num}: {clean_msg}"
                    else:
                        try:
                            err_json = resp.json()
                            gh_msg = err_json.get("message", resp.text)
                        except Exception:
                            gh_msg = resp.text
                        clean_msg = sanitize_sensitive_data(gh_msg)
                        merged = False
                        merge_mode = "none"
                        merged_sha = ""
                        merge_detail = f"GitHub returned HTTP {resp.status_code}: {clean_msg}"
                except Exception as api_exc:
                    clean_exc = sanitize_sensitive_data(str(api_exc))
                    merged = False
                    merge_mode = "none"
                    merged_sha = ""
                    merge_detail = f"GitHub API merge request failed: {clean_exc}"
            else:
                merged = False
                merge_mode = "none"
                merged_sha = ""
                merge_detail = f"No GitHub token is available to merge pull request #{pr_num}."

        # 3. No repository is linked
        elif not effective_repo:
            if not workspace or not git_service.is_isolated_workspace(workspace):
                merged = False
                merge_mode = "none"
                merged_sha = ""
                merge_detail = "Merge refused: a generated project workspace is required."
            else:
                checkout_res = git_service._run_git_command(["checkout", "main"], cwd=workspace)
                current_res = git_service._run_git_command(["rev-parse", "--abbrev-ref", "HEAD"], cwd=workspace)
                on_main = checkout_res.get("success") and current_res.get("stdout", "").strip() == "main"
                if on_main:
                    # Merge the approved commit itself, not whatever the branch points to now.
                    merge_res = git_service._run_git_command([
                        "merge", expected_sha,
                        "-m", f"chore(release): merge branch '{branch}' at {expected_sha[:7]} into main",
                    ], cwd=workspace)
                else:
                    reason = checkout_res.get("stderr") or checkout_res.get("stdout") or "the workspace is not on main"
                    merge_res = {"success": False, "stderr": f"could not switch the workspace to main: {reason}"}
                if merge_res.get("success"):
                    sha_res = git_service._run_git_command(["rev-parse", "HEAD"], cwd=workspace)
                    merged_sha = sha_res.get("stdout", "").strip()
                    merged = True
                    merge_mode = "local"
                    merge_detail = f"Merged {branch} into main at {merged_sha[:7]} locally because no GitHub repository is linked."
                else:
                    git_service._run_git_command(["merge", "--abort"], cwd=workspace)
                    err_msg = sanitize_sensitive_data(merge_res.get("stderr") or merge_res.get("stdout") or "merge conflict")
                    merged = False
                    merge_mode = "none"
                    merged_sha = ""
                    merge_detail = f"Local merge of {branch} into main failed: {err_msg}"

        # 4. A repository is linked but no pull request exists
        else:
            merged = False
            merge_mode = "none"
            merged_sha = ""
            merge_detail = f"A repository is linked ({effective_repo}), but no pull request was opened; merge refused."

        # 6. Post-merge actions
        deployment = {}
        deployment_status = "skipped"
        deployment_detail = "Deployment was skipped because the branch was not merged."

        ticket_moved_to_done = False

        if merged:
            # Move ticket to done
            if task:
                try:
                    from tasks.application.use_cases import TaskApplicationService
                    from tasks.models import Task
                    actor = _resolve_actor(task, actor_email)
                    TaskApplicationService().transition_status(task, Task.Status.DONE, actor=actor)
                    ticket_moved_to_done = True
                except Exception as exc:
                    logger.warning("Failed to transition task to done: %s", exc)
                    merge_detail += f" The ticket could not be moved to Done: {sanitize_sensitive_data(str(exc))}"

            # Request staging deployment
            project_id = None
            if task:
                project_id = getattr(task, "project_id", None) or (
                    getattr(task.project, "id", None) if hasattr(task, "project") and task.project else None
                )

            if project_id:
                deploy_info = trigger_app_deployment(
                    project_id=project_id,
                    environment="staging",
                    branch="main",
                    commit_sha=merged_sha,
                    actor_email=actor_email or "devops",
                )
            else:
                deploy_info = {"ok": False, "configured": False, "error": "No project associated with task."}

            deployment = deploy_info
            if deploy_info.get("ok"):
                deployment_status = "in_progress"
                deployment_detail = f"Deployment #{deploy_info.get('deployment_id')} was accepted by the provider; it reports the final outcome."
            elif deploy_info.get("configured") is False:
                deployment_status = "not_configured"
                deployment_detail = "No deployment provider is configured, so no deployment was started."
            else:
                deployment_status = "failed"
                deployment_detail = f"No deployment is running: {deploy_info.get('error') or deploy_info.get('status')}."

        return ReleaseResult(
            merged=merged,
            merge_mode=merge_mode,
            merged_sha=merged_sha,
            detail=merge_detail,
            pr_url=real_pr_url,
            deployment=deployment,
            deployment_status=deployment_status,
            deployment_detail=deployment_detail,
            ticket_moved_to_done=ticket_moved_to_done,
        )

    except Exception as exc:
        clean_err = sanitize_sensitive_data(str(exc))
        logger.error("Release failed with unexpected error: %s", clean_err)
        return ReleaseResult(
            merged=False,
            merge_mode="none",
            merged_sha="",
            detail=f"Release failed unexpectedly: {clean_err}",
            pr_url=pr_url if github_tool._parse_pr_url(pr_url) else "",
            deployment={},
            deployment_status="skipped",
            deployment_detail="Deployment was skipped because the release failed.",
        )


def format_release_comment(author_name: str, agent_role: str, result: ReleaseResult) -> str:
    """The ticket comment both engines post after a release attempt."""
    clean_author = sanitize_sensitive_data(author_name)
    clean_role = sanitize_sensitive_data(agent_role)
    clean_mode = sanitize_sensitive_data(result.merge_mode)
    clean_pr_url = sanitize_sensitive_data(result.pr_url)
    clean_sha = sanitize_sensitive_data(result.merged_sha)
    clean_detail = sanitize_sensitive_data(neutralize_untrusted_markdown(result.detail))
    clean_deploy_detail = sanitize_sensitive_data(neutralize_untrusted_markdown(result.deployment_detail))

    lines = [
        f"**{clean_author} - {clean_role}**\n",
        "**Release step:**\n",
        f"- **Merge mode:** `{clean_mode}`",
    ]
    if clean_pr_url:
        lines.append(f"- **Pull request:** {clean_pr_url}")
    if clean_sha:
        lines.append(f"- **Merged SHA:** `{clean_sha[:7]}`")
    lines.append(f"- **Merge:** {clean_detail}")
    lines.append(f"- **Deployment:** {clean_deploy_detail}")
    lines.append(f"- **Ticket:** {'moved to Done' if result.ticket_moved_to_done else 'left open for follow-up'}.")

    comment_text = "\n".join(lines)
    return sanitize_sensitive_data(neutralize_untrusted_markdown(comment_text))
