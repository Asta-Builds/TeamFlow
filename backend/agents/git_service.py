"""
Autonomous Git & GitHub Operations Service for TeamFlow Agents.
Allows AI agents to behave like human engineers:
- Create isolated project codebases inside `generated_projects/{project_id}_{slug}/`
- Initialize standalone git repositories with initial commit & starter scaffolding
- Create and checkout feature branches (e.g. feat/ticket-15-keycloak-auth)
- Pull latest changes from main
- Stage files and commit with conventional commits and agent author metadata
- Push branches to origin
- Open Pull Requests on GitHub (via GitHub API if token available, or generating compare URLs)
- Post PR comments and review status
- Merge Pull Requests / branches to main (restricted to Tech Lead per governance rules)
"""

import os
import re
import subprocess
import logging
import requests
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

try:
    from django.conf import settings
    _default_ws = "/workspace" if os.path.exists("/workspace") else (str(settings.BASE_DIR) if settings.is_configured() else os.getcwd())
except Exception:
    _default_ws = "/workspace" if os.path.exists("/workspace") else os.getcwd()

WORKSPACE_ROOT = os.environ.get("WORKSPACE_ROOT", _default_ws)


def sanitize_sensitive_data(text: Any) -> str:
    """Removes sensitive GitHub tokens from strings before logging or LLM consumption."""
    if text is None:
        return ""
    result = str(text)
    token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", ""))
    if token:
        result = result.replace(token, "***TOKEN***")
    result = re.sub(r"https://[^@\s]+@github\.com", "https://***@github.com", result)
    return result


def get_project_workspace(task_or_project: Any = None) -> str:
    """
    Returns the isolated workspace directory for a specific project.
    All user project files are kept isolated in `generated_projects/{project_id}_{slug}/`
    so the TeamFlow platform repository itself is NEVER modified.
    """
    project = None
    if task_or_project:
        if hasattr(task_or_project, "project"):
            project = task_or_project.project
        elif hasattr(task_or_project, "name"):
            project = task_or_project

    if not project:
        default_dir = os.path.join(WORKSPACE_ROOT, "generated_projects", "default_project")
        os.makedirs(default_dir, exist_ok=True)
        return default_dir

    project_id = getattr(project, "id", "0")
    project_name = getattr(project, "name", "project")
    slug = re.sub(r'[^a-zA-Z0-9]+', '-', project_name.lower()).strip('-')[:30] or "app"
    project_folder_name = f"{project_id}_{slug}"

    project_dir = os.path.join(WORKSPACE_ROOT, "generated_projects", project_folder_name)
    os.makedirs(project_dir, exist_ok=True)

    # Check if this project codebase has been initialized with a git repository
    git_dir = os.path.join(project_dir, ".git")
    if not os.path.exists(git_dir):
        repo_name = getattr(project, "github_repo", "")
        description = getattr(project, "description", "")
        bootstrap_new_project_repo(project_dir, project_name, description, repo_name)

    return project_dir


def bootstrap_new_project_repo(
    project_dir: str,
    project_name: str,
    description: str = "",
    github_repo: str = ""
) -> Dict[str, Any]:
    """
    Bootstraps a fresh, standalone Git repository and starter files for a new user project.
    """
    os.makedirs(project_dir, exist_ok=True)

    # 1. Initialize git repo
    _run_git_command(["init", "-b", "main"], cwd=project_dir)
    _run_git_command(["config", "user.name", "TeamFlow AI Swarm"], cwd=project_dir)
    _run_git_command(["config", "user.email", "swarm@teamflow.dev"], cwd=project_dir)

    # 2. Add remote if github_repo is configured
    if github_repo:
        clean_repo = github_repo.replace("https://github.com/", "").replace(".git", "").strip("/")
        remote_url = f"https://github.com/{clean_repo}.git"
        token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", ""))
        if token:
            remote_url = f"https://x-access-token:{token}@github.com/{clean_repo}.git"
        _run_git_command(["remote", "add", "origin", remote_url], cwd=project_dir)

    # 3. Create initial README.md
    readme_path = os.path.join(project_dir, "README.md")
    if not os.path.exists(readme_path):
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(
                f"# {project_name}\n\n"
                f"{description or 'Autonomous software project created and managed by TeamFlow AI Specialists.'}\n\n"
                f"## 🚀 Project Overview\n"
                f"This codebase is autonomously generated, tested, and maintained by TeamFlow Virtual Tech Specialists.\n"
            )

    # 4. Create standard .gitignore
    gitignore_path = os.path.join(project_dir, ".gitignore")
    if not os.path.exists(gitignore_path):
        with open(gitignore_path, "w", encoding="utf-8") as f:
            f.write("node_modules/\n.env\n.env.local\ndist/\nbuild/\n__pycache__/\n*.pyc\n.venv/\n.DS_Store\n")

    # 5. Create initial commit
    _run_git_command(["add", "."], cwd=project_dir)
    _run_git_command(["commit", "-m", f"feat(init): bootstrap {project_name} project codebase"], cwd=project_dir)

    logger.info(f"Initialized new standalone project repository at '{project_dir}'")
    return {"success": True, "project_dir": project_dir}


def _run_git_command(args: List[str], cwd: Optional[str] = None) -> Dict[str, Any]:
    """Executes a git command inside the target directory."""
    target_cwd = cwd or WORKSPACE_ROOT
    if not os.path.exists(target_cwd):
        return {"success": False, "stdout": "", "stderr": f"Directory not found: {target_cwd}", "returncode": 1}

    try:
        git_env = os.environ.copy()
        git_env["GIT_TERMINAL_PROMPT"] = "0"
        git_env["GIT_ASKPASS"] = "echo"

        result = subprocess.run(
            ["git"] + args,
            cwd=target_cwd,
            capture_output=True,
            text=True,
            timeout=30,
            env=git_env,
            encoding="utf-8",
            errors="replace"
        )
        return {
            "success": result.returncode == 0,
            "stdout": sanitize_sensitive_data(result.stdout.strip()),
            "stderr": sanitize_sensitive_data(result.stderr.strip()),
            "returncode": result.returncode,
        }
    except Exception as e:
        err_msg = sanitize_sensitive_data(str(e))
        logger.error(f"Git command failed: git {' '.join(args)} -> {err_msg}")
        return {"success": False, "stdout": "", "stderr": err_msg, "returncode": -1}


def get_current_branch(cwd: Optional[str] = None) -> str:
    """Returns current git branch name."""
    res = _run_git_command(["rev-parse", "--abbrev-ref", "HEAD"], cwd=cwd)
    return res["stdout"] if res["success"] else "main"


def git_pull(branch: str = "main", cwd: Optional[str] = None) -> Dict[str, Any]:
    """Pulls latest changes from remote branch."""
    res = _run_git_command(["pull", "origin", branch], cwd=cwd)
    return {
        "success": res["success"],
        "branch": branch,
        "output": res["stdout"] or res["stderr"],
    }


def git_checkout_branch(branch_name: str, create_if_missing: bool = True, cwd: Optional[str] = None) -> Dict[str, Any]:
    """
    Checks out or creates a new feature branch.
    E.g. feat/ticket-15-user-auth
    """
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
    cwd: Optional[str] = None
) -> Dict[str, Any]:
    """
    Stages modified files and creates a git commit with agent author identity.
    """
    target_cwd = cwd or WORKSPACE_ROOT
    if files:
        for f in files:
            _run_git_command(["add", f], cwd=target_cwd)
    else:
        _run_git_command(["add", "."], cwd=target_cwd)

    status = _run_git_command(["status", "--porcelain"], cwd=target_cwd)
    if not status["stdout"]:
        sha_res = _run_git_command(["rev-parse", "--short", "HEAD"], cwd=target_cwd)
        return {
            "success": True,
            "committed": False,
            "message": "No new changes to commit.",
            "sha": sha_res["stdout"] if sha_res["success"] else ""
        }

    author_flag = f"{author_name} <{author_email}>"
    res = _run_git_command(["commit", "-m", message, f"--author={author_flag}"], cwd=target_cwd)
    
    sha_res = _run_git_command(["rev-parse", "--short", "HEAD"], cwd=target_cwd)
    sha = sha_res["stdout"] if sha_res["success"] else ""

    return {
        "success": res["success"],
        "committed": True,
        "sha": sha,
        "message": message,
        "author": author_flag,
        "output": res["stdout"] or res["stderr"]
    }


def git_push(branch_name: str, cwd: Optional[str] = None, force: bool = False) -> Dict[str, Any]:
    """Pushes the branch to remote origin."""
    target_cwd = cwd or WORKSPACE_ROOT
    args = ["push", "-u", "origin", branch_name]
    if force:
        args.append("--force")

    token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", ""))
    if token:
        remote_res = _run_git_command(["remote", "get-url", "origin"], cwd=target_cwd)
        remote_url = remote_res["stdout"]
        if "github.com" in remote_url and token not in remote_url:
            clean_url = remote_url.replace("https://", "").replace("http://", "")
            if "@" in clean_url:
                clean_url = clean_url.split("@")[-1]
            auth_url = f"https://x-access-token:{token}@{clean_url}"
            _run_git_command(["remote", "set-url", "origin", auth_url], cwd=target_cwd)

    res = _run_git_command(args, cwd=target_cwd)
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
    clean_repo = (repo or "").replace("https://github.com/", "").replace(".git", "").strip("/")
    
    if token and clean_repo and "/" in clean_repo:
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
    if clean_repo and "/" in clean_repo:
        pr_url = f"https://github.com/{clean_repo}/compare/{base_branch}...{head_branch}?expand=1"
    else:
        pr_url = f"https://github.com/local-project/compare/{base_branch}...{head_branch}"
        
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
    cwd: Optional[str] = None
) -> Dict[str, Any]:
    """
    Merges a feature branch into main (Restricted to Tech Lead).
    Executes local merge, fast-forward, and push, plus GitHub API merge if applicable.
    """
    target_cwd = cwd or WORKSPACE_ROOT
    _run_git_command(["checkout", target_branch], cwd=target_cwd)

    merge_res = _run_git_command([
        "merge", source_branch,
        "-m", f"chore(merge): merge branch '{source_branch}' into {target_branch} [Tech Lead approved]"
    ], cwd=target_cwd)

    sha_res = _run_git_command(["rev-parse", "--short", "HEAD"], cwd=target_cwd)
    merge_sha = sha_res["stdout"] if sha_res["success"] else ""

    push_res = git_push(target_branch, cwd=target_cwd)

    token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", ""))
    clean_repo = (repo or "").replace("https://github.com/", "").replace(".git", "").strip("/")
    if token and pr_number and pr_number > 0 and clean_repo and "/" in clean_repo:
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


def create_remote_repo(
    repo_name: str,
    private: bool = False,
    description: str = "",
    auto_init: bool = True,
    org: Optional[str] = None
) -> Dict[str, Any]:
    """
    Creates a new remote GitHub repository via the GitHub REST API.
    If org is specified, creates under that organization; otherwise under the authenticated user.
    If GITHUB_TOKEN is not configured, provides an offline simulated response for testing and local workflows.
    """
    token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", ""))
    clean_name = repo_name.strip("/").split("/")[-1] if "/" in repo_name else repo_name.strip()
    clean_org = org or (repo_name.split("/")[0] if "/" in repo_name else None)

    if not token:
        logger.info(f"GITHUB_TOKEN not present; simulating repository creation for '{clean_name}'")
        full_name = f"{clean_org or 'TeamFlow-Dev'}/{clean_name}"
        return {
            "success": True,
            "simulated": True,
            "repo_name": clean_name,
            "full_name": full_name,
            "html_url": f"https://github.com/{full_name}",
            "clone_url": f"https://github.com/{full_name}.git",
            "default_branch": "main",
            "message": f"Simulated repository '{full_name}' created (GITHUB_TOKEN not configured)."
        }

    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "TeamFlow-Agent-Swarm"
    }
    payload = {
        "name": clean_name,
        "description": description or "Autonomous repository managed by TeamFlow AI Specialists",
        "private": private,
        "auto_init": auto_init,
    }

    url = f"https://api.github.com/orgs/{clean_org}/repos" if clean_org else "https://api.github.com/user/repos"

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        if resp.status_code in (200, 201):
            data = resp.json()
            return {
                "success": True,
                "simulated": False,
                "repo_name": data.get("name", clean_name),
                "full_name": data.get("full_name", f"{clean_org or 'user'}/{clean_name}"),
                "html_url": data.get("html_url", f"https://github.com/{clean_org or 'user'}/{clean_name}"),
                "clone_url": data.get("clone_url", f"https://github.com/{clean_org or 'user'}/{clean_name}.git"),
                "default_branch": data.get("default_branch", "main"),
                "message": f"Successfully created repository {data.get('full_name')} on GitHub."
            }
        elif resp.status_code == 422:
            # Already exists or validation issue; query repository info
            target_repo_path = f"{clean_org}/{clean_name}" if clean_org else clean_name
            get_resp = requests.get(f"https://api.github.com/repos/{target_repo_path}", headers=headers, timeout=10)
            if get_resp.status_code == 200:
                data = get_resp.json()
                return {
                    "success": True,
                    "simulated": False,
                    "exists": True,
                    "repo_name": data.get("name", clean_name),
                    "full_name": data.get("full_name"),
                    "html_url": data.get("html_url"),
                    "clone_url": data.get("clone_url"),
                    "default_branch": data.get("default_branch", "main"),
                    "message": f"Repository {data.get('full_name')} already exists."
                }
            err_data = resp.json()
            return {
                "success": False,
                "error": err_data.get("message", "Validation error or repository already exists."),
                "status_code": resp.status_code
            }
        else:
            return {
                "success": False,
                "error": sanitize_sensitive_data(resp.text),
                "status_code": resp.status_code
            }
    except Exception as exc:
        err_str = sanitize_sensitive_data(str(exc))
        logger.error(f"GitHub API create_remote_repo failed: {err_str}")
        return {"success": False, "error": err_str}


def clone_or_pull(
    repo_url: str,
    local_dir: str,
    branch: str = "main"
) -> Dict[str, Any]:
    """
    Clones a remote repository into local_dir if not present,
    or pulls latest changes if repository already exists locally.
    Safely injects GitHub PAT credentials and sanitizes output.
    """
    token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", ""))
    
    # Construct authenticated URL if token is available
    auth_url = repo_url
    if token and "github.com" in repo_url:
        clean_url = repo_url.replace("https://", "").replace("http://", "")
        if "@" in clean_url:
            clean_url = clean_url.split("@")[-1]
        auth_url = f"https://x-access-token:{token}@{clean_url}"

    git_dir = os.path.join(local_dir, ".git")

    if not os.path.exists(git_dir):
        # Fresh clone
        parent_dir = os.path.dirname(os.path.abspath(local_dir))
        dir_name = os.path.basename(os.path.abspath(local_dir))
        os.makedirs(parent_dir, exist_ok=True)
        
        clone_res = _run_git_command(["clone", auth_url, dir_name], cwd=parent_dir)
        if not clone_res["success"]:
            # Fallback bootstrap for local/mock/offline testing
            logger.warning(f"Git clone failed, bootstrapping local repo at {local_dir}: {clone_res['stderr']}")
            bootstrap_res = bootstrap_new_project_repo(local_dir, project_name=dir_name, github_repo=repo_url)
            return {
                "success": bootstrap_res["success"],
                "action": "bootstrapped_fallback",
                "local_dir": local_dir,
                "branch": branch,
                "output": clone_res["stderr"] or "Initialized local fallback repository."
            }

        # Configure agent identity inside cloned repo
        _run_git_command(["config", "user.name", "TeamFlow AI Swarm"], cwd=local_dir)
        _run_git_command(["config", "user.email", "swarm@teamflow.dev"], cwd=local_dir)

        return {
            "success": True,
            "action": "cloned",
            "local_dir": local_dir,
            "branch": branch,
            "output": clone_res["stdout"] or f"Cloned {sanitize_sensitive_data(repo_url)} into {local_dir}"
        }
    else:
        # Existing repository: checkout and pull
        _run_git_command(["config", "user.name", "TeamFlow AI Swarm"], cwd=local_dir)
        _run_git_command(["config", "user.email", "swarm@teamflow.dev"], cwd=local_dir)

        if token and "github.com" in auth_url:
            _run_git_command(["remote", "set-url", "origin", auth_url], cwd=local_dir)

        _run_git_command(["fetch", "origin"], cwd=local_dir)
        checkout_res = git_checkout_branch(branch, create_if_missing=True, cwd=local_dir)
        pull_res = _run_git_command(["pull", "origin", branch], cwd=local_dir)

        return {
            "success": pull_res["success"] or checkout_res["success"],
            "action": "pulled",
            "local_dir": local_dir,
            "branch": branch,
            "output": pull_res["stdout"] or pull_res["stderr"] or checkout_res.get("output", "")
        }


def commit_and_push(
    local_dir: str,
    commit_message: str,
    branch: str = "main",
    author_name: str = "TeamFlow AI Swarm",
    author_email: str = "swarm@teamflow.dev",
    files: Optional[List[str]] = None,
    force: bool = False
) -> Dict[str, Any]:
    """
    Stages modified files, creates a commit with agent author identity, and pushes to remote.
    """
    if not os.path.exists(local_dir):
        return {"success": False, "error": f"Directory does not exist: {local_dir}"}

    # Ensure on correct branch
    git_checkout_branch(branch, create_if_missing=True, cwd=local_dir)

    # Commit changes
    commit_res = git_commit(
        message=commit_message,
        author_name=author_name,
        author_email=author_email,
        files=files,
        cwd=local_dir
    )

    # Push changes
    push_res = git_push(branch_name=branch, cwd=local_dir, force=force)

    return {
        "success": commit_res["success"] and push_res["success"],
        "committed": commit_res.get("committed", False),
        "sha": commit_res.get("sha", ""),
        "branch": branch,
        "pushed": push_res["success"],
        "commit_message": commit_message,
        "author": f"{author_name} <{author_email}>",
        "output": f"Commit: {commit_res.get('output', '')} | Push: {push_res.get('output', '')}".strip()
    }
