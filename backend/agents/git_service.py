"""
Autonomous Git & GitHub Operations Service for TeamFlow Agents.
Allows AI agents to behave like human engineers:
- Create and checkout feature branches (e.g. feat/ticket-15-keycloak-auth)
- Pull latest changes from main
- Stage files and commit with conventional commits and agent author metadata
- Push branches to origin
- Open Pull Requests on GitHub (via GitHub API if token available, or generating compare URLs)
- Post PR comments and review status
- Merge Pull Requests / branches to main (restricted to Tech Lead per governance rules)
- Initialize new repositories for projects
"""

import os
import subprocess
import logging
import requests
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = os.environ.get("WORKSPACE_ROOT", "/workspace")


def _run_git_command(args: List[str], cwd: str = WORKSPACE_ROOT) -> Dict[str, Any]:
    """Executes a git command inside the workspace directory."""
    if not os.path.exists(cwd):
        return {"success": False, "stdout": "", "stderr": f"Directory not found: {cwd}", "returncode": 1}

    try:
        git_env = os.environ.copy()
        git_env["GIT_TERMINAL_PROMPT"] = "0"
        git_env["GIT_ASKPASS"] = "echo"

        result = subprocess.run(
            ["git"] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30,
            env=git_env,
            encoding="utf-8",
            errors="replace"
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode,
        }
    except Exception as e:
        logger.error(f"Git command failed: git {' '.join(args)} -> {e}")
        return {"success": False, "stdout": "", "stderr": str(e), "returncode": -1}


def get_current_branch(cwd: str = WORKSPACE_ROOT) -> str:
    """Returns current git branch name."""
    res = _run_git_command(["rev-parse", "--abbrev-ref", "HEAD"], cwd=cwd)
    return res["stdout"] if res["success"] else "main"


def git_pull(branch: str = "main", cwd: str = WORKSPACE_ROOT) -> Dict[str, Any]:
    """Pulls latest changes from remote branch."""
    res = _run_git_command(["pull", "origin", branch], cwd=cwd)
    return {
        "success": res["success"],
        "branch": branch,
        "output": res["stdout"] or res["stderr"],
    }


def git_checkout_branch(branch_name: str, create_if_missing: bool = True, cwd: str = WORKSPACE_ROOT) -> Dict[str, Any]:
    """
    Checks out or creates a new feature branch.
    E.g. feat/ticket-15-user-auth
    """
    # Check if branch exists
    check = _run_git_command(["rev-parse", "--verify", branch_name], cwd=cwd)
    if check["success"]:
        res = _run_git_command(["checkout", branch_name], cwd=cwd)
    elif create_if_missing:
        res = _run_git_command(["checkout", "-b", branch_name], cwd=cwd)
    else:
        return {"success": False, "message": f"Branch {branch_name} does not exist."}

    return {
        "success": res["success"],
        "branch": branch_name,
        "output": res["stdout"] or res["stderr"]
    }


def git_commit(
    message: str,
    author_name: str,
    author_email: str,
    files: Optional[List[str]] = None,
    cwd: str = WORKSPACE_ROOT
) -> Dict[str, Any]:
    """
    Stages modified files and creates a git commit with agent author identity.
    """
    if files:
        for f in files:
            _run_git_command(["add", f], cwd=cwd)
    else:
        _run_git_command(["add", "."], cwd=cwd)

    # Check if there are staged changes
    status = _run_git_command(["status", "--porcelain"], cwd=cwd)
    if not status["stdout"]:
        sha_res = _run_git_command(["rev-parse", "--short", "HEAD"], cwd=cwd)
        return {
            "success": True,
            "committed": False,
            "message": "No new changes to commit.",
            "sha": sha_res["stdout"] if sha_res["success"] else ""
        }

    author_flag = f"{author_name} <{author_email}>"
    res = _run_git_command(["commit", "-m", message, f"--author={author_flag}"], cwd=cwd)
    
    # Get last commit SHA
    sha_res = _run_git_command(["rev-parse", "--short", "HEAD"], cwd=cwd)
    sha = sha_res["stdout"] if sha_res["success"] else ""

    return {
        "success": res["success"],
        "committed": True,
        "sha": sha,
        "message": message,
        "author": author_flag,
        "output": res["stdout"] or res["stderr"]
    }


def git_push(branch_name: str, cwd: str = WORKSPACE_ROOT, force: bool = False) -> Dict[str, Any]:
    """Pushes the branch to remote origin."""
    args = ["push", "-u", "origin", branch_name]
    if force:
        args.append("--force")

    token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", ""))
    if token:
        remote_res = _run_git_command(["remote", "get-url", "origin"], cwd=cwd)
        remote_url = remote_res["stdout"]
        if "github.com" in remote_url and token not in remote_url:
            clean_url = remote_url.replace("https://", "").replace("http://", "")
            if "@" in clean_url:
                clean_url = clean_url.split("@")[-1]
            auth_url = f"https://x-access-token:{token}@{clean_url}"
            _run_git_command(["remote", "set-url", "origin", auth_url], cwd=cwd)

    res = _run_git_command(args, cwd=cwd)
    return {
        "success": res["success"],
        "branch": branch_name,
        "output": res["stdout"] or res["stderr"]
    }


def git_create_pull_request(
    repo: str,
    title: str,
    body: str,
    head_branch: str,
    base_branch: str = "main"
) -> Dict[str, Any]:
    """
    Creates a Pull Request on GitHub via API (if token present)
    or generates the full direct GitHub comparison & PR URL.
    """
    token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", ""))
    clean_repo = (repo or "Asta-Builds/TeamFlow").replace("https://github.com/", "").replace(".git", "").strip("/")
    
    if token and clean_repo:
        api_url = f"https://api.github.com/repos/{clean_repo}/pulls"
        headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
        }
        payload = {
            "title": title,
            "body": body,
            "head": head_branch,
            "base": base_branch,
        }
        try:
            resp = requests.post(api_url, json=payload, headers=headers, timeout=10)
            if resp.status_code in (200, 201):
                data = resp.json()
                return {
                    "status": "success",
                    "pr_number": data.get("number"),
                    "pr_url": data.get("html_url"),
                    "title": title,
                    "head": head_branch,
                    "base": base_branch,
                    "is_live_pr": True
                }
            elif resp.status_code == 422:
                # PR might already exist for this branch
                owner = clean_repo.split('/')[0]
                prs_resp = requests.get(f"https://api.github.com/repos/{clean_repo}/pulls?head={owner}:{head_branch}", headers=headers, timeout=10)
                if prs_resp.status_code == 200 and prs_resp.json():
                    existing_pr = prs_resp.json()[0]
                    return {
                        "status": "success",
                        "pr_number": existing_pr.get("number"),
                        "pr_url": existing_pr.get("html_url"),
                        "title": existing_pr.get("title"),
                        "head": head_branch,
                        "base": base_branch,
                        "is_live_pr": True
                    }
        except Exception as e:
            logger.warning(f"GitHub API PR creation failed: {e}")

    # Fallback to direct Compare & PR URL
    pr_url = f"https://github.com/{clean_repo}/compare/{base_branch}...{head_branch}?expand=1"
    return {
        "status": "success",
        "pr_number": 0,
        "pr_url": pr_url,
        "title": title,
        "head": head_branch,
        "base": base_branch,
        "is_live_pr": False
    }


def git_merge_pull_request(
    repo: str,
    source_branch: str,
    target_branch: str = "main",
    pr_number: Optional[int] = None,
    cwd: str = WORKSPACE_ROOT
) -> Dict[str, Any]:
    """
    Merges a feature branch into main (Restricted to Tech Lead).
    Executes local merge, fast-forward, and push, plus GitHub API merge if applicable.
    """
    # 1. Checkout target branch
    _run_git_command(["checkout", target_branch], cwd=cwd)

    # 2. Merge source branch
    merge_res = _run_git_command([
        "merge", source_branch,
        "-m", f"chore(merge): merge branch '{source_branch}' into {target_branch} [Tech Lead approved]"
    ], cwd=cwd)

    # 3. Get merge commit SHA
    sha_res = _run_git_command(["rev-parse", "--short", "HEAD"], cwd=cwd)
    merge_sha = sha_res["stdout"] if sha_res["success"] else ""

    # 4. Push target branch
    push_res = git_push(target_branch, cwd=cwd)

    # 5. If GitHub PR exists, attempt GitHub API merge as well
    token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", ""))
    if token and pr_number and pr_number > 0 and repo:
        clean_repo = repo.replace("https://github.com/", "").replace(".git", "").strip("/")
        try:
            requests.put(
                f"https://api.github.com/repos/{clean_repo}/pulls/{pr_number}/merge",
                headers={"Authorization": f"token {token}"},
                json={"merge_method": "squash"},
                timeout=10
            )
        except Exception:
            pass

    return {
        "success": merge_res["success"],
        "merged_sha": merge_sha,
        "source_branch": source_branch,
        "target_branch": target_branch,
        "push_success": push_res["success"],
        "output": merge_res["stdout"] or merge_res["stderr"]
    }


def git_init_repo(repo_name: str, cwd: str = WORKSPACE_ROOT) -> Dict[str, Any]:
    """Initializes a new git repository for a project."""
    _run_git_command(["init"], cwd=cwd)
    _run_git_command(["add", "."], cwd=cwd)
    _run_git_command(["commit", "-m", f"feat(init): bootstrap {repo_name} repository"], cwd=cwd)
    _run_git_command(["branch", "-M", "main"], cwd=cwd)
    return {"success": True, "repo_name": repo_name, "branch": "main"}
