"""
GitHub and Git Tools for LangGraph and Antigravity Swarm Agents.
Delegates to real Git operations and GitHub REST API in `agents.git_service`.
Provides both direct callable Python functions and LangChain `@tool` wrappers.
"""

import os
import urllib.parse
import re
import time
import logging
from typing import Dict, Any, Optional, List, Tuple

import requests
from django.conf import settings
from langchain_core.tools import tool

from agents.git_service import (
    create_remote_repo as _git_create_remote_repo,
    clone_or_pull as _git_clone_or_pull,
    commit_and_push as _git_commit_and_push,
    git_checkout_branch,
    git_commit,
    git_push,
    git_create_pull_request,
    git_merge_pull_request,
    sanitize_sensitive_data,
)

logger = logging.getLogger(__name__)

_PR_URL = re.compile(r"^https://github\.com/([^/\s]+/[^/\s]+)/pull/(\d+)")


def _github_token() -> str:
    from agents.git_service import platform_github_token

    return platform_github_token()


def _parse_pr_url(pr_url: str) -> Optional[Tuple[str, int]]:
    match = _PR_URL.match((pr_url or "").strip())
    if not match:
        return None
    return match.group(1), int(match.group(2))


def _github_headers(token: str) -> Dict[str, str]:
    return {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "TeamFlow-Agent-Swarm",
    }


def create_remote_repo(
    repo_name: str,
    private: bool = False,
    description: str = "",
    auto_init: bool = True,
    org: Optional[str] = None,
) -> Dict[str, Any]:
    """GitHub Tool: Creates a new remote repository on GitHub via REST API."""
    return _git_create_remote_repo(
        repo_name=repo_name,
        private=private,
        description=description,
        auto_init=auto_init,
        org=org,
    )


def clone_or_pull(
    repo_url: str,
    local_dir: str,
    branch: str = "main",
) -> Dict[str, Any]:
    """GitHub Tool: Clones a remote repository or pulls latest branch updates into local_dir."""
    return _git_clone_or_pull(
        repo_url=repo_url,
        local_dir=local_dir,
        branch=branch,
    )


def commit_and_push(
    local_dir: str,
    commit_message: str,
    branch: str = "main",
    author_name: Optional[str] = None,
    author_email: Optional[str] = None,
    files: Optional[List[str]] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """GitHub Tool: Stages changes, creates a commit with agent author identity, and pushes to remote."""
    return _git_commit_and_push(
        local_dir=local_dir,
        commit_message=commit_message,
        branch=branch,
        author_name=author_name,
        author_email=author_email,
        files=files,
        force=force,
    )


def create_branch(
    repo: str,
    branch_name: str,
    base_branch: str = "main",
    cwd: Optional[str] = None,
) -> Dict[str, Any]:
    """GitHub Tool: Creates and checks out a new feature branch for an agent subtask."""
    res = git_checkout_branch(branch_name, create_if_missing=True, cwd=cwd)
    return {
        "status": "success" if res["success"] else "warning",
        "repo": repo,
        "branch": branch_name,
        "base": base_branch,
        "ref": f"refs/heads/{branch_name}",
        "message": res.get("output", ""),
    }


def open_pull_request(
    repo: str,
    title: str,
    body: str,
    head_branch: str,
    base_branch: str = "main",
    cwd: Optional[str] = None,
) -> Dict[str, Any]:
    """GitHub Tool: Pushes the branch and opens a Pull Request on GitHub."""
    push_res = git_push(head_branch, cwd=cwd)
    if not push_res.get("success"):
        return {
            "status": "error",
            "pr_number": 0,
            "pr_url": "",
            "title": title,
            "head": head_branch,
            "base": base_branch,
            "is_live_pr": False,
            "error": push_res.get("output", "Branch was not pushed."),
        }
    pr_data = git_create_pull_request(repo, title, body, head_branch, base_branch, cwd=cwd)
    return {
        "status": "success" if pr_data.get("is_live_pr") else "compare_link_only",
        "pr_number": pr_data.get("pr_number", 0),
        "pr_url": pr_data.get("pr_url", ""),
        "title": title,
        "head": head_branch,
        "base": base_branch,
        "is_live_pr": pr_data.get("is_live_pr", False),
    }


def post_pr_comment(pr_url: str, comment: str) -> Dict[str, Any]:
    """GitHub Tool: Posts a review or QA report on a Pull Request. Reports ``posted: False`` when it cannot."""
    parsed = _parse_pr_url(pr_url)
    token = _github_token()
    if not parsed or not token:
        return {
            "status": "skipped",
            "posted": False,
            "pr_url": pr_url,
            "reason": "No GitHub pull request URL or token is available.",
        }
    repo, number = parsed
    try:
        resp = requests.post(
            f"{settings.GITHUB_API_URL}/repos/{repo}/issues/{number}/comments",
            json={"body": comment},
            headers=_github_headers(token),
            timeout=10,
        )
    except requests.RequestException as exc:
        return {"status": "error", "posted": False, "pr_url": pr_url, "reason": sanitize_sensitive_data(str(exc))}
    posted = resp.status_code == 201
    return {
        "status": "success" if posted else "error",
        "posted": posted,
        "pr_url": pr_url,
        "reason": "" if posted else f"GitHub returned HTTP {resp.status_code}",
    }


def check_ci_status(pr_url: str) -> Dict[str, Any]:
    """GitHub Tool: Reads the check runs for a Pull Request's head commit from GitHub."""
    unknown = {
        "status": "unavailable",
        "ci_state": "unknown",
        "total_checks": 0,
        "passed_checks": 0,
        "failed_checks": 0,
    }
    parsed = _parse_pr_url(pr_url)
    token = _github_token()
    if not parsed or not token:
        return {**unknown, "reason": "No GitHub pull request URL or token is available."}
    repo, number = parsed
    headers = _github_headers(token)
    try:
        pr = requests.get(f"{settings.GITHUB_API_URL}/repos/{repo}/pulls/{number}", headers=headers, timeout=10)
        if pr.status_code != 200:
            return {**unknown, "reason": f"GitHub returned HTTP {pr.status_code} for the pull request"}
        sha = pr.json().get("head", {}).get("sha", "")
        runs = requests.get(
            f"{settings.GITHUB_API_URL}/repos/{repo}/commits/{sha}/check-runs",
            headers=headers,
            timeout=10,
        )
        if runs.status_code != 200:
            return {**unknown, "reason": f"GitHub returned HTTP {runs.status_code} for check runs"}
        check_runs = runs.json().get("check_runs", [])
    except requests.RequestException as exc:
        return {**unknown, "reason": sanitize_sensitive_data(str(exc))}

    total = len(check_runs)
    completed = [r for r in check_runs if r.get("status") == "completed"]
    passed = sum(1 for r in completed if r.get("conclusion") in {"success", "neutral", "skipped"})
    failed = sum(1 for r in completed if r.get("conclusion") not in {"success", "neutral", "skipped"})
    if total == 0:
        state = "no_checks"
    elif failed:
        state = "failed"
    elif len(completed) < total:
        state = "pending"
    else:
        state = "passed"
    return {
        "status": "success",
        "ci_state": state,
        "head_sha": sha,
        "total_checks": total,
        "passed_checks": passed,
        "failed_checks": failed,
    }


def merge_pull_request(
    repo: str,
    source_branch: Optional[str] = None,
    target_branch: str = "main",
    pr_number: Optional[int] = None,
    cwd: Optional[str] = None,
) -> Dict[str, Any]:
    """
    GitHub Tool: Merges a Pull Request to main branch.
    Restricted to Tech Lead per governance rules.
    """
    actual_repo = repo or ""
    actual_source = source_branch
    actual_pr_number = pr_number

    if urllib.parse.urlsplit(settings.GITHUB_WEB_URL).netloc in actual_repo and not source_branch:
        if "/tree/" in actual_repo:
            actual_repo, actual_source = actual_repo.split("/tree/")
        elif "/pull/" in actual_repo:
            parts = actual_repo.split("/pull/")
            actual_repo = parts[0]
            if not actual_pr_number:
                try:
                    actual_pr_number = int(parts[1].split("/")[0].split("?")[0])
                except Exception:
                    pass
            actual_source = ""
        else:
            actual_source = ""
    elif not source_branch:
        actual_source = actual_repo
        actual_repo = ""

    res = git_merge_pull_request(actual_repo, actual_source or "", target_branch, actual_pr_number, cwd=cwd)
    return {
        "status": "merged" if res["success"] else "error",
        "repo": actual_repo,
        "source_branch": actual_source or res.get("source_branch", ""),
        "target_branch": target_branch,
        "merged_sha": res.get("merged_sha", ""),
        "merged_at": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        "message": res.get("output", ""),
    }


# ==========================================
# LangChain / LangGraph @tool Definitions
# ==========================================

@tool
def tool_create_remote_repo(repo_name: str, private: bool = False, description: str = "", auto_init: bool = True) -> str:
    """Creates a new remote repository on GitHub for a project via the GitHub API."""
    result = create_remote_repo(repo_name=repo_name, private=private, description=description, auto_init=auto_init)
    return str(result)


@tool
def tool_clone_or_pull(repo_url: str, local_dir: str, branch: str = "main") -> str:
    """Clones a remote GitHub repository to a local sandboxed directory, or pulls latest changes if already present."""
    result = clone_or_pull(repo_url=repo_url, local_dir=local_dir, branch=branch)
    return str(result)


@tool
def tool_commit_and_push(local_dir: str, commit_message: str, branch: str = "main") -> str:
    """Stages all modified files in the local repository, creates a git commit, and pushes to remote branch."""
    result = commit_and_push(local_dir=local_dir, commit_message=commit_message, branch=branch)
    return str(result)


@tool
def tool_create_branch(repo: str, branch_name: str, base_branch: str = "main") -> str:
    """Creates and checks out a new feature branch for an agent subtask."""
    result = create_branch(repo=repo, branch_name=branch_name, base_branch=base_branch)
    return str(result)


@tool
def tool_open_pull_request(repo: str, title: str, body: str, head_branch: str, base_branch: str = "main") -> str:
    """Pushes changes to remote origin and opens a Pull Request on GitHub."""
    result = open_pull_request(repo=repo, title=title, body=body, head_branch=head_branch, base_branch=base_branch)
    return str(result)


@tool
def tool_post_pr_comment(pr_url: str, comment: str) -> str:
    """Posts an automated review, test report, or comment on a GitHub Pull Request."""
    result = post_pr_comment(pr_url=pr_url, comment=comment)
    return str(result)


@tool
def tool_check_ci_status(pr_url: str) -> str:
    """Checks the continuous integration (CI) status for a GitHub Pull Request."""
    result = check_ci_status(pr_url=pr_url)
    return str(result)


@tool
def tool_merge_pull_request(repo: str, source_branch: str, target_branch: str = "main") -> str:
    """Merges an approved feature branch into the main branch. Restricted to Tech Lead."""
    result = merge_pull_request(repo=repo, source_branch=source_branch, target_branch=target_branch)
    return str(result)


AGENT_GITHUB_TOOLS = [
    tool_create_remote_repo,
    tool_clone_or_pull,
    tool_commit_and_push,
    tool_create_branch,
    tool_open_pull_request,
    tool_post_pr_comment,
    tool_check_ci_status,
]

TECH_LEAD_GITHUB_TOOLS = AGENT_GITHUB_TOOLS + [
    tool_merge_pull_request,
]
