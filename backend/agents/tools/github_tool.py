import hashlib
import time
from typing import Dict, Any, Optional


def create_branch(repo: str, branch_name: str, base_branch: str = "main") -> Dict[str, Any]:
    """GitHub Tool: Creates a new feature branch for an agent subtask."""
    return {
        "status": "success",
        "repo": repo,
        "branch": branch_name,
        "base": base_branch,
        "ref": f"refs/heads/{branch_name}",
        "sha": hashlib.sha1(branch_name.encode()).hexdigest()[:8],
    }


def open_pull_request(
    repo: str,
    title: str,
    body: str,
    head_branch: str,
    base_branch: str = "main",
) -> Dict[str, Any]:
    """GitHub Tool: Opens a new Pull Request with code changes."""
    pr_number = int(time.time()) % 1000 + 40
    pr_url = f"https://github.com/{repo}/pull/{pr_number}"
    return {
        "status": "success",
        "pr_number": pr_number,
        "pr_url": pr_url,
        "title": title,
        "head": head_branch,
        "base": base_branch,
        "mergeable": True,
    }


def post_pr_comment(pr_url: str, comment: str) -> Dict[str, Any]:
    """GitHub Tool: Posts an automated code review or QA report on a Pull Request."""
    return {
        "status": "success",
        "pr_url": pr_url,
        "comment": comment,
    }


def check_ci_status(pr_url: str) -> Dict[str, Any]:
    """GitHub Tool: Checks GitHub Actions CI pipeline status."""
    return {
        "status": "success",
        "ci_state": "passed",
        "total_checks": 12,
        "passed_checks": 12,
        "failed_checks": 0,
        "duration_seconds": 28,
    }


def merge_pull_request(pr_url: str, merge_method: str = "squash") -> Dict[str, Any]:
    """
    GitHub Tool: Merges a Pull Request to main branch.
    Restricted to Tech Lead orchestrator node only (Least Privilege governance).
    """
    return {
        "status": "merged",
        "pr_url": pr_url,
        "merge_method": merge_method,
        "merged_at": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    }
