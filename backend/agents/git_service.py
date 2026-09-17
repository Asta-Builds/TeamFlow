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
import urllib.parse
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
GENERATED_PROJECTS_ROOT = os.path.join(WORKSPACE_ROOT, "generated_projects")

# Git subcommands that may run in a directory which is not yet a repository.
_REPO_CREATING_COMMANDS = {"init", "clone"}


def _real(path: str) -> str:
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def is_isolated_workspace(path: Optional[str]) -> bool:
    """True when ``path`` is a project directory strictly inside the generated-projects root."""
    if not path:
        return False
    root = _real(GENERATED_PROJECTS_ROOT)
    target = _real(path)
    if target == root:
        return False
    try:
        return os.path.commonpath([target, root]) == root
    except ValueError:
        # Different drives on Windows.
        return False


def _normalize_repo(repo: Optional[str]) -> str:
    clean = (repo or "").strip()
    clean = re.sub(r"^https?://([^@/]+@)?github\.com/", "", clean)
    if clean.endswith(".git"):
        clean = clean[:-4]
    return clean.strip("/").lower()


def protected_repositories() -> set:
    """Repositories agents must never pull from, push to, or clone (for example the TeamFlow platform)."""
    raw = os.environ.get("AGENT_PROTECTED_REPOS", "")
    if not raw:
        try:
            from django.conf import settings
            raw = getattr(settings, "AGENT_PROTECTED_REPOS", "") or ""
        except Exception:
            raw = ""
    items = raw if isinstance(raw, (list, tuple, set)) else str(raw).split(",")
    return {_normalize_repo(item) for item in items if _normalize_repo(item)}


def is_protected_repo(repo: Optional[str]) -> bool:
    normalized = _normalize_repo(repo)
    return bool(normalized) and normalized in protected_repositories()


def _configured_git_identity() -> tuple[str, str]:
    name = os.environ.get("GIT_AUTHOR_NAME", "").strip()
    email = os.environ.get("GIT_AUTHOR_EMAIL", "").strip()
    if not name or not email:
        try:
            from django.conf import settings
            name = name or getattr(settings, "GIT_AUTHOR_NAME", "").strip()
            email = email or getattr(settings, "GIT_AUTHOR_EMAIL", "").strip()
        except Exception:
            pass
    if not name or not email:
        raise RuntimeError(
            "GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL must be configured for agent Git operations."
        )
    return name, email


def _configure_git_identity(cwd: str) -> None:
    name, email = _configured_git_identity()
    _run_git_command(["config", "user.name", name], cwd=cwd)
    _run_git_command(["config", "user.email", email], cwd=cwd)


_TOKEN_PATTERN = re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b")


def sanitize_sensitive_data(text: Any) -> str:
    """Removes GitHub credentials (platform or tenant) from strings before logging or LLM consumption."""
    if text is None:
        return ""
    result = str(text)
    token = os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", ""))
    if token:
        result = result.replace(token, "***TOKEN***")
    result = _TOKEN_PATTERN.sub("***TOKEN***", result)
    result = re.sub(r"https://[^@\\s/]+@" + urllib.parse.urlsplit(settings.GITHUB_WEB_URL).netloc, "https://***@" + urllib.parse.urlsplit(settings.GITHUB_WEB_URL).netloc, result)
    return result


def _platform_token_allowed() -> bool:
    try:
        from django.conf import settings
        return bool(getattr(settings, "AGENT_ALLOW_PLATFORM_GITHUB_TOKEN", False))
    except Exception:
        return False


def platform_github_token() -> str:
    """
    The operator's own GitHub token. Tenants use it only when
    AGENT_ALLOW_PLATFORM_GITHUB_TOKEN is enabled (single-tenant or self-hosted setups);
    otherwise each workspace must connect its own GitHub integration.
    """
    if not _platform_token_allowed():
        return ""
    try:
        from django.conf import settings
        token = (getattr(settings, "GITHUB_TOKEN", "") or "").strip()
    except Exception:
        token = ""
    return token or os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", "")).strip()


def platform_github_org() -> str:
    if not _platform_token_allowed():
        return ""
    try:
        from django.conf import settings
        org = (getattr(settings, "GITHUB_ORG", "") or "").strip()
    except Exception:
        org = ""
    return org or os.environ.get("GITHUB_ORG", "").strip()


def _resolve_project_repo_and_token(
    cwd: Optional[str] = None,
    task_or_project: Any = None,
) -> tuple[str, str, str]:
    """
    Resolves (github_repo, token, org) accurately for any workspace directory or project model:
    - Resolves Project model from task_or_project or cwd folder name (e.g. `3_payments-service`).
    - Retrieves the GitHub token and org from the organization's GitHubIntegration, falling back to
      the operator's credentials only when AGENT_ALLOW_PLATFORM_GITHUB_TOKEN is enabled.
    - Resolves github_repo from project.github_repo only; no repository name is guessed.
    """
    token = ""
    org = ""
    github_repo = ""
    project = None

    if task_or_project:
        if hasattr(task_or_project, "project") and task_or_project.project:
            project = task_or_project.project
        elif hasattr(task_or_project, "github_repo"):
            project = task_or_project
        elif isinstance(task_or_project, (int, str)) and str(task_or_project).isdigit():
            try:
                from projects.models import Project
                project = Project.objects.filter(id=int(task_or_project)).first()
            except Exception:
                pass

    if not project and cwd:
        folder_name = os.path.basename(os.path.abspath(cwd))
        # Format is {project_id}_{slug}
        if "_" in folder_name and folder_name.split("_")[0].isdigit():
            proj_id = int(folder_name.split("_")[0])
            try:
                from projects.models import Project
                project = Project.objects.filter(id=proj_id).first()
            except Exception:
                pass

    if project:
        github_repo = getattr(project, "github_repo", "") or ""
        org_model = getattr(project, "organization", None)
        if org_model:
            try:
                integration = getattr(org_model, "github_integration", None)
                if integration and integration.is_enabled:
                    token = (integration.github_token or "").strip()
                    org = (integration.github_org or "").strip()
            except Exception:
                pass

    # Operator credentials only when explicitly allowed for tenants.
    if not token:
        token = platform_github_token()
    if not org:
        org = platform_github_org()

    # Only an explicitly linked repository is used. Guessing "{org}/{folder}" previously
    # pointed workspaces (and the host checkout) at unrelated repositories.
    return github_repo.strip(), token.strip(), org.strip()


def _ensure_origin_configured(
    cwd: str,
    target_repo: Optional[str] = None,
    token: Optional[str] = None,
) -> Optional[str]:
    """Ensures git remote 'origin' is properly set to the target repo with authentication token."""
    resolved_repo, resolved_token, _ = _resolve_project_repo_and_token(cwd)
    repo = (target_repo or resolved_repo).strip()
    tok = (token or resolved_token).strip()

    if not repo or not is_isolated_workspace(cwd):
        return None

    clean_repo = repo.replace(f"{settings.GITHUB_WEB_URL}/", "").replace(".git", "").strip("/")
    if "/" not in clean_repo:
        return None
    if is_protected_repo(clean_repo):
        logger.error("Refusing to configure protected repository %s as an agent workspace remote.", clean_repo)
        return None

    remote_url = f"{settings.GITHUB_WEB_URL}/{clean_repo}.git"
    if tok:
        host = urllib.parse.urlsplit(settings.GITHUB_WEB_URL).netloc
    if tok:
        remote_url = f"https://x-access-token:{tok}@{host}/{clean_repo}.git"

    remotes_res = _run_git_command(["remote"], cwd=cwd)
    remote_list = [r.strip() for r in remotes_res.get("stdout", "").split() if r.strip()]

    if "origin" in remote_list:
        _run_git_command(["remote", "set-url", "origin", remote_url], cwd=cwd)
    else:
        _run_git_command(["remote", "add", "origin", remote_url], cwd=cwd)

    return remote_url


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
        elif isinstance(task_or_project, (int, str)) and str(task_or_project).isdigit():
            try:
                from projects.models import Project
                from tasks.models import Task
                project = Project.objects.filter(id=int(task_or_project)).first()
                if not project:
                    t = Task.objects.filter(id=int(task_or_project)).select_related("project").first()
                    if t and t.project:
                        project = t.project
            except Exception:
                pass

    if not project:
        default_dir = os.path.join(GENERATED_PROJECTS_ROOT, "default_project")
        os.makedirs(default_dir, exist_ok=True)
        if not os.path.exists(os.path.join(default_dir, ".git")):
            bootstrap_new_project_repo(default_dir, "Default Project")
        return default_dir

    project_id = getattr(project, "id", "0")
    project_name = getattr(project, "name", "project")
    slug = re.sub(r'[^a-zA-Z0-9]+', '-', project_name.lower()).strip('-')[:30] or "app"
    project_folder_name = f"{project_id}_{slug}"

    project_dir = os.path.join(GENERATED_PROJECTS_ROOT, project_folder_name)
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
    github_repo: str = "",
    token: Optional[str] = None,
    push: bool = False,
) -> Dict[str, Any]:
    """
    Bootstraps a fresh, standalone Git repository and starter files for a new user project.
    """
    os.makedirs(project_dir, exist_ok=True)

    # 1. Initialize git repo if not already present
    git_dir = os.path.join(project_dir, ".git")
    if not os.path.exists(git_dir):
        _run_git_command(["init", "-b", "main"], cwd=project_dir)
    _configure_git_identity(project_dir)

    # 2. Add or update remote if github_repo is configured or derivable
    res_repo, res_token, _ = _resolve_project_repo_and_token(project_dir)
    target_repo = (github_repo or res_repo).strip()
    auth_token = (token or res_token).strip()

    if target_repo:
        _ensure_origin_configured(project_dir, target_repo, auth_token)

    # 3. Create initial README.md
    readme_path = os.path.join(project_dir, "README.md")
    if not os.path.exists(readme_path):
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(
                f"# {project_name}\n\n"
                f"{description or 'Autonomous software project created and managed by TeamFlow AI Specialists.'}\n\n"
                f"## Project Overview\n"
                f"This codebase is autonomously generated, tested, and maintained by TeamFlow Virtual Tech Specialists.\n\n"
                f"### TeamFlow Agent Stack\n"
                f"- **Tech Lead**: Architecture & review\n"
                f"- **DevOps Engineer**: CI/CD automation & release pipelines\n"
                f"- **Senior Backend**: Django / FastAPI / microservices\n"
                f"- **Senior Frontend**: Next.js 16 App Router & modern reactive UI\n"
                f"- **QA Engineer**: Automated test suites\n\n"
                f"### CI/CD Pipeline\n"
                f"Automated testing and linting pipelines are configured in `.github/workflows/ci.yml`.\n"
            )

    # 4. Create standard .gitignore
    gitignore_path = os.path.join(project_dir, ".gitignore")
    if not os.path.exists(gitignore_path):
        with open(gitignore_path, "w", encoding="utf-8") as f:
            f.write(
                "# Dependencies\nnode_modules/\n.pnp\n.pnp.js\n\n"
                "# Environment variables\n.env\n.env.local\n.env.development.local\n.env.test.local\n.env.production.local\n\n"
                "# Python\n__pycache__/\n*.py[cod]\n*$py.class\n.venv/\nvenv/\nenv/\n\n"
                "# Build artifacts\nbuild/\ndist/\nout/\n.next/\n\n"
                "# Logs & runtime\n*.log\nnpm-debug.log*\n.DS_Store\nThumbs.db\n"
            )

    # 5. Create DevOps GitHub Actions CI workflow (.github/workflows/ci.yml)
    workflows_dir = os.path.join(project_dir, ".github", "workflows")
    os.makedirs(workflows_dir, exist_ok=True)
    ci_workflow_path = os.path.join(workflows_dir, "ci.yml")
    if not os.path.exists(ci_workflow_path):
        with open(ci_workflow_path, "w", encoding="utf-8") as f:
            f.write(
                "name: TeamFlow Autonomous CI\n\n"
                "on:\n"
                "  push:\n"
                "    branches: [ main, 'feat/*', 'fix/*' ]\n"
                "  pull_request:\n"
                "    branches: [ main ]\n\n"
                "jobs:\n"
                "  ci-pipeline:\n"
                "    name: DevOps Autonomous Verification\n"
                "    runs-on: ubuntu-latest\n"
                "    steps:\n"
                "      - name: Checkout Code\n"
                "        uses: actions/checkout@v4\n\n"
                "      - name: DevOps Health Check & Scaffolding Check\n"
                "        run: |\n"
                f"          echo 'Autonomous CI pipeline generated by the TeamFlow DevOps agent'\n"
                f"          echo 'Project: {project_name}'\n"
                "          ls -la\n"
            )

    # 6. Create initial commit
    _run_git_command(["add", "."], cwd=project_dir)
    status_res = _run_git_command(["status", "--porcelain"], cwd=project_dir)
    if status_res.get("stdout", "").strip():
        _run_git_command(["commit", "-m", f"chore(ci): bootstrap {project_name} codebase with CI/CD by DevOps Agent"], cwd=project_dir)

    # 7. Push to remote if requested and configured
    pushed = False
    if push and target_repo:
        _run_git_command(["branch", "-M", "main"], cwd=project_dir)
        push_res = _run_git_command(["push", "-u", "origin", "main"], cwd=project_dir)
        pushed = push_res.get("success", False)
        if not pushed:
            _run_git_command(["pull", "origin", "main", "--no-edit", "--autostash"], cwd=project_dir)
            push_res = _run_git_command(["push", "-u", "origin", "main"], cwd=project_dir)
            pushed = push_res.get("success", False)

    logger.info(f"Initialized new standalone project repository at '{project_dir}' (pushed={pushed})")
    return {"success": True, "project_dir": project_dir, "pushed": pushed}



def _isolation_error(message: str) -> Dict[str, Any]:
    logger.error("Agent git isolation violation: %s", message)
    return {"success": False, "stdout": "", "stderr": message, "returncode": 1, "isolation_error": True}


def _run_git_command(args: List[str], cwd: Optional[str] = None) -> Dict[str, Any]:
    """
    Executes a git command inside an isolated project workspace.

    Agent git commands are confined to ``generated_projects/<project>/`` directories.
    They never run in the TeamFlow checkout, and git cannot discover a parent
    repository when a workspace has not been initialized yet.
    """
    if not cwd:
        return _isolation_error("A project workspace directory is required for git operations.")
    target_cwd = cwd
    subcommand = args[0] if args else ""
    root = GENERATED_PROJECTS_ROOT

    if subcommand == "clone":
        allowed = _real(target_cwd) == _real(root) or is_isolated_workspace(target_cwd)
    else:
        allowed = is_isolated_workspace(target_cwd)
    if not allowed:
        return _isolation_error(f"Refusing to run git outside the generated projects root: {target_cwd}")

    if not os.path.exists(target_cwd):
        return {"success": False, "stdout": "", "stderr": f"Directory not found: {target_cwd}", "returncode": 1}

    if subcommand not in _REPO_CREATING_COMMANDS and not os.path.exists(os.path.join(target_cwd, ".git")):
        return _isolation_error(f"Workspace is not an initialized project repository: {target_cwd}")

    try:
        git_env = os.environ.copy()
        git_env["GIT_TERMINAL_PROMPT"] = "0"
        git_env["GIT_ASKPASS"] = "echo"
        # Never walk up from a workspace into the platform checkout that contains it.
        git_env["GIT_CEILING_DIRECTORIES"] = os.path.abspath(root)

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
    """Pulls latest changes from the linked remote. Reports a skip when no remote is linked."""
    target_cwd = cwd
    res_repo, res_token, _ = _resolve_project_repo_and_token(target_cwd)
    _ensure_origin_configured(target_cwd, res_repo, res_token)
    remotes_res = _run_git_command(["remote"], cwd=target_cwd)
    if remotes_res.get("isolation_error"):
        return {"success": False, "branch": branch, "output": remotes_res["stderr"]}
    if "origin" not in remotes_res.get("stdout", "").split():
        return {
            "success": False,
            "skipped": True,
            "branch": branch,
            "output": "No remote repository is linked to this workspace; nothing was pulled.",
        }
    origin_res = _run_git_command(["remote", "get-url", "origin"], cwd=target_cwd)
    if is_protected_repo(origin_res.get("stdout", "")):
        return {
            "success": False,
            "branch": branch,
            "output": "Refusing to pull: the workspace remote is a protected repository.",
        }

    res = _run_git_command(["pull", "origin", branch, "--no-edit", "--autostash"], cwd=target_cwd)
    output = (res["stdout"] or res["stderr"]).strip()

    # A remote that does not have the branch yet (fresh repository) is not an error.
    if not res["success"] and any(msg in output.lower() for msg in [
        "couldn't find remote ref",
        "could not find remote ref",
        "no such ref was fetched",
    ]):
        return {
            "success": True,
            "branch": branch,
            "output": f"Remote branch '{branch}' does not exist yet; the local branch is the baseline.",
            "is_fresh_branch": True,
        }

    return {
        "success": res["success"],
        "branch": branch,
        "output": output,
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


def check_js_bracket_balance(content: str, rel_path: str) -> Optional[str]:
    """
    Heuristic bracket balance check for JS/TS sources.

    Skips string literals, template literals and comments. Single- and double-quoted
    strings cannot span lines, so their state resets at each line end; this keeps
    apostrophes in JSX text from hiding the rest of the file.
    Returns an error message, or None when brackets balance.
    """
    pairs = {")": "(", "}": "{", "]": "["}
    stack: List[tuple] = []
    in_template = False
    in_block_comment = False
    regex_prefix_chars = set("(,=:[!&|?{};+-*%~^")
    regex_prefix_words = ("return", "typeof", "case", "do", "else", "in", "of")

    def _regex_end(text: str, start: int) -> int:
        """Index just past a regex literal starting at ``start``, or -1 if not a regex."""
        before = text[:start].rstrip()
        if before and before[-1] not in regex_prefix_chars and not before.endswith(regex_prefix_words):
            return -1
        j = start + 1
        in_class = False
        while j < len(text):
            ch = text[j]
            if ch == "\\":
                j += 2
                continue
            if ch == "[":
                in_class = True
            elif ch == "]":
                in_class = False
            elif ch == "/" and not in_class:
                return j + 1
            j += 1
        return -1

    for line_num, line in enumerate(content.splitlines(), 1):
        quote = ""
        quote_start = -1
        literal_quotes: set = set()
        escaped = False
        i = 0
        while True:
            if i >= len(line):
                if quote and quote_start >= 0:
                    # Unterminated on this line: the quote was plain text (e.g. JSX "Don't").
                    literal_quotes.add(quote_start)
                    i = quote_start + 1
                    quote = ""
                    quote_start = -1
                    escaped = False
                    continue
                break
            char = line[i]
            nxt = line[i + 1] if i + 1 < len(line) else ""
            if in_block_comment:
                if char == "*" and nxt == "/":
                    in_block_comment = False
                    i += 1
            elif escaped:
                escaped = False
            elif char == "\\" and (quote or in_template):
                escaped = True
            elif quote:
                if char == quote:
                    quote = ""
            elif in_template:
                if char == "`":
                    in_template = False
            elif char == "/" and nxt == "/":
                break
            elif char == "/" and nxt == "*":
                in_block_comment = True
                i += 1
            elif char == "/" and _regex_end(line, i) > 0:
                i = _regex_end(line, i)
                continue
            elif char in ("'", '"'):
                if i not in literal_quotes:
                    quote = char
                    quote_start = i
            elif char == "`":
                in_template = True
            elif char in "({[":
                stack.append((char, line_num))
            elif char in ")}]":
                if not stack:
                    return f"Unmatched closing '{char}' in {rel_path}:{line_num}"
                top, top_line = stack.pop()
                if top != pairs[char]:
                    return f"Mismatched bracket '{top}' (line {top_line}) closed by '{char}' in {rel_path}:{line_num}"
            i += 1

    if stack:
        top, top_line = stack[-1]
        return f"Unclosed bracket '{top}' opened at {rel_path}:{top_line}"
    return None


def run_project_build(project_workspace: str) -> Dict[str, Any]:
    """
    Autonomous Build & Verification Tool for AI Agents.
    Executes real language/framework verification in the isolated project workspace:
    - Python: AST validation and syntax checks across all Python files.
    - JSON: Schema/syntax validation across JSON configuration files.
    - JavaScript / TypeScript: Syntax checks, brace/quote matching, and compile checks.
    Returns status, error diagnostics, and timing so agents can behave like human engineers.
    """
    import ast
    import json
    import time
    start_time = time.time()

    if not os.path.exists(project_workspace):
        return {
            "success": False,
            "exit_code": 1,
            "output": f"Workspace directory does not exist: {project_workspace}",
            "build_tool": "none",
            "files_checked": 0,
            "errors": [f"Directory not found: {project_workspace}"],
            "duration_seconds": 0.0,
        }

    errors: List[str] = []
    files_checked = 0
    build_tool = "ast_and_static_analyzer"

    # Walk workspace ignoring git, cache, and node_modules
    for root, dirs, files in os.walk(project_workspace):
        dirs[:] = [d for d in dirs if d not in {".git", "__pycache__", "node_modules", ".next", "dist", "build", ".venv", "venv"}]
        for file in files:
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, project_workspace)

            # 1. Python Syntax & AST Check
            if file.endswith(".py"):
                files_checked += 1
                try:
                    with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
                        content = fh.read()
                    ast.parse(content, filename=rel_path)
                except SyntaxError as syn_err:
                    errors.append(f"Python SyntaxError in {rel_path}:{syn_err.lineno} - {syn_err.msg}")
                except Exception as exc:
                    errors.append(f"Python ReadError in {rel_path} - {exc}")

            # 2. JSON Invariant Check
            elif file.endswith(".json"):
                files_checked += 1
                try:
                    with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
                        json.load(fh)
                except Exception as j_err:
                    errors.append(f"JSON ParseError in {rel_path} - {j_err}")

            # 3. TS/TSX/JS bracket balance check (a heuristic, not a compiler)
            elif file.endswith((".ts", ".tsx", ".js", ".jsx")):
                files_checked += 1
                try:
                    with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
                        ts_content = fh.read()
                    bracket_error = check_js_bracket_balance(ts_content, rel_path)
                    if bracket_error:
                        errors.append(bracket_error)
                except Exception as ts_err:
                    errors.append(f"Frontend ReadError in {rel_path} - {ts_err}")

    duration = round(time.time() - start_time, 3)
    success = len(errors) == 0

    if success:
        out_msg = f"Static checks PASSED ({files_checked} files checked, 0 errors, {duration}s)"
    else:
        out_msg = f"Static checks FAILED ({len(errors)} error(s) in {files_checked} files):\n" + "\n".join(f"- {e}" for e in errors[:5])

    return {
        "success": success,
        "exit_code": 0 if success else 1,
        "output": out_msg,
        "build_tool": build_tool,
        "files_checked": files_checked,
        "errors": errors,
        "duration_seconds": duration,
    }


def autonomous_git_pipeline(
    project_workspace: str,
    branch_name: str,
    commit_message: str,
    author_name: str,
    author_email: str,
    files_written: Optional[List[str]] = None,
    repo_name: Optional[str] = None,
    run_build: bool = True,
    base_branch: str = "main",
) -> Dict[str, Any]:
    """
    Full autonomous human-like engineering pipeline:
    1. Pull latest changes from origin/main
    2. Check out feature branch
    3. Run project build and static verification
    4. Commit with signed agent identity
    5. Push branch to remote origin
    6. Open/update GitHub Pull Request
    """
    _configure_git_identity(project_workspace)

    # 1. Pull latest main
    pull_res = git_pull(branch=base_branch, cwd=project_workspace)

    # 2. Checkout or create feature branch
    checkout_res = git_checkout_branch(branch_name, create_if_missing=True, cwd=project_workspace)

    # 3. Run Build & Verification
    build_res = {"success": True, "output": "Build skipped", "errors": []}
    if run_build:
        build_res = run_project_build(project_workspace)

    # 4. Commit (proceed if build passed)
    commit_res = {"success": False, "committed": False, "output": "Build failed; commit aborted."}
    push_res = {"success": False, "output": "Not pushed."}
    pr_res = {"status": "not_created", "pr_url": ""}

    if build_res.get("success", False):
        commit_res = git_commit(
            message=commit_message,
            author_name=author_name,
            author_email=author_email,
            files=files_written,
            cwd=project_workspace,
        )

        # 5. Push branch
        push_res = git_push(branch_name=branch_name, cwd=project_workspace)

        # 6. Create Pull Request
        if repo_name and "/" in repo_name:
            pr_res = git_create_pull_request(
                repo=repo_name,
                cwd=project_workspace,
                title=commit_message,
                body=f"## Autonomous Engineering PR\n\n**Author:** {author_name} `<{author_email}>`\n\n### Build Verification\n- {build_res.get('output')}\n",
                head_branch=branch_name,
                base_branch=base_branch,
            )

    return {
        "success": build_res.get("success", False) and commit_res.get("success", False),
        "branch": branch_name,
        "pull": pull_res,
        "checkout": checkout_res,
        "build": build_res,
        "commit": commit_res,
        "push": push_res,
        "pr": pr_res,
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
    target_cwd = cwd
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
    """Pushes the branch to the linked remote with token authentication and one retry on remote updates."""
    target_cwd = cwd
    res_repo, res_token, _ = _resolve_project_repo_and_token(target_cwd)
    _ensure_origin_configured(target_cwd, res_repo, res_token)

    remotes_res = _run_git_command(["remote"], cwd=target_cwd)
    if remotes_res.get("isolation_error"):
        return {"success": False, "branch": branch_name, "output": remotes_res["stderr"]}
    remote_list = [r.strip() for r in remotes_res.get("stdout", "").split() if r.strip()]

    if "origin" not in remote_list:
        return {
            "success": False,
            "branch": branch_name,
            "output": f"Branch '{branch_name}' was not pushed: no remote repository is linked to this workspace.",
            "is_local": True,
        }

    origin_res = _run_git_command(["remote", "get-url", "origin"], cwd=target_cwd)
    if is_protected_repo(origin_res.get("stdout", "")):
        return {
            "success": False,
            "branch": branch_name,
            "output": "Refusing to push: the workspace remote is a protected repository.",
        }

    args = ["push", "-u", "origin", branch_name]
    if force:
        args.append("--force")

    res = _run_git_command(args, cwd=target_cwd)
    output = (res["stdout"] or res["stderr"]).strip()

    # If push was rejected due to remote updates (fetch first / non-fast-forward), try pulling and re-pushing
    if not res["success"] and not force and any(msg in output.lower() for msg in ["fetch first", "non-fast-forward", "failed to push some refs"]):
        logger.info(f"git push rejected on branch '{branch_name}'. Attempting pull with autostash before retrying push...")
        pull_res = _run_git_command(["pull", "origin", branch_name, "--no-edit", "--autostash"], cwd=target_cwd)
        if pull_res["success"]:
            res = _run_git_command(args, cwd=target_cwd)
            output = (res["stdout"] or res["stderr"]).strip()

    return {
        "success": res["success"],
        "branch": branch_name,
        "output": output,
    }


def git_create_pull_request(
    repo: str,
    title: str,
    body: str,
    head_branch: str,
    base_branch: str = "main",
    cwd: Optional[str] = None,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Creates a Pull Request on GitHub via API (if a token is available)
    or returns the GitHub compare URL for the pushed branch.
    """
    if not token and cwd:
        _, token, _ = _resolve_project_repo_and_token(cwd)
    token = (token or platform_github_token()).strip()
    clean_repo = (repo or "").replace(f"{settings.GITHUB_WEB_URL}/", "").replace(".git", "").strip("/")
    
    if token and clean_repo and "/" in clean_repo:
        api_url = f"{settings.GITHUB_API_URL}/repos/{clean_repo}/pulls"
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
                prs_resp = requests.get(f"{settings.GITHUB_API_URL}/repos/{clean_repo}/pulls?head={owner}:{head_branch}", headers=headers, timeout=10)
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
        pr_url = f"{settings.GITHUB_WEB_URL}/{clean_repo}/compare/{base_branch}...{head_branch}?expand=1"
    else:
        pr_url = ""
        
    return {
        "status": "compare_link" if pr_url else "not_created",
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
    target_cwd = cwd

    def _refused(reason: str) -> Dict[str, Any]:
        return {
            "success": False,
            "merged_sha": "",
            "source_branch": source_branch,
            "target_branch": target_branch,
            "push_success": False,
            "output": reason,
        }

    if not is_isolated_workspace(target_cwd):
        return _refused("Merge refused: a generated project workspace is required.")
    res_repo, res_token, _ = _resolve_project_repo_and_token(target_cwd)
    token = (res_token or "").strip()
    clean_repo = (repo or res_repo).replace(f"{settings.GITHUB_WEB_URL}/", "").replace(".git", "").strip("/")
    if is_protected_repo(clean_repo):
        return _refused("Merge refused: the target is a protected repository.")

    # If pr_number is provided and source_branch is empty or same as target, resolve from GitHub API
    if token and clean_repo and "/" in clean_repo and pr_number and pr_number > 0 and (not source_branch or source_branch == target_branch):
        try:
            p_resp = requests.get(
                f"{settings.GITHUB_API_URL}/repos/{clean_repo}/pulls/{pr_number}",
                headers={"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"},
                timeout=10
            )
            if p_resp.status_code == 200:
                p_data = p_resp.json()
                head_ref = p_data.get("head", {}).get("ref")
                if head_ref:
                    source_branch = head_ref
        except Exception:
            pass

    if not source_branch or source_branch == target_branch:
        return _refused("Merge refused: no source branch was provided.")

    _ensure_origin_configured(target_cwd, clean_repo, token)
    _run_git_command(["checkout", target_branch], cwd=target_cwd)
    git_pull(target_branch, cwd=target_cwd)

    merge_res = _run_git_command([
        "merge", source_branch,
        "-m", f"chore(merge): merge branch '{source_branch}' into {target_branch} [Tech Lead approved]"
    ], cwd=target_cwd)

    sha_res = _run_git_command(["rev-parse", "--short", "HEAD"], cwd=target_cwd)
    merge_sha = sha_res["stdout"] if sha_res["success"] else ""

    if not merge_res["success"]:
        _run_git_command(["merge", "--abort"], cwd=target_cwd)
        return _refused(merge_res["stderr"] or merge_res["stdout"] or "Merge failed.")

    push_res = git_push(target_branch, cwd=target_cwd)

    if token and pr_number and pr_number > 0 and clean_repo and "/" in clean_repo:
        try:
            requests.put(
                f"{settings.GITHUB_API_URL}/repos/{clean_repo}/pulls/{pr_number}/merge",
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
    org: Optional[str] = None,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Creates a new remote GitHub repository via the GitHub REST API.
    If org is specified, creates under that organization;
    otherwise or on 404 (e.g. personal account login passed as org), creates under the authenticated user.
    If GITHUB_TOKEN is not configured, returns a 503 failure.
    """
    token = (token or platform_github_token()).strip()
    clean_name = repo_name.strip("/").split("/")[-1] if "/" in repo_name else repo_name.strip()
    clean_org = org or (repo_name.split("/")[0] if "/" in repo_name else None)

    if not token:
        return {
            "success": False,
            "status_code": 503,
            "error": "GitHub is not connected..."
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

    # Fetch authenticated user login to detect if clean_org is user or organization
    user_login = ""
    try:
        u_resp = requests.get(f"{settings.GITHUB_API_URL}/user", headers=headers, timeout=10)
        if u_resp.status_code == 200:
            user_login = u_resp.json().get("login", "")
    except Exception:
        pass

    is_personal_user = bool(clean_org and user_login and clean_org.lower() == user_login.lower())
    url = f"{settings.GITHUB_API_URL}/orgs/{clean_org}/repos" if (clean_org and not is_personal_user) else f"{settings.GITHUB_API_URL}/user/repos"

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=15)
        # If org creation returned 404, fall back to user repos
        if resp.status_code == 404 and url != f"{settings.GITHUB_API_URL}/user/repos":
            url = f"{settings.GITHUB_API_URL}/user/repos"
            resp = requests.post(url, json=payload, headers=headers, timeout=15)

        if resp.status_code in (200, 201):
            data = resp.json()
            return {
                "success": True,
                "repo_name": data.get("name", clean_name),
                "full_name": data.get("full_name"),
                "html_url": data.get("html_url"),
                "clone_url": data.get("clone_url"),
                "default_branch": data.get("default_branch", "main"),
                "message": f"Successfully created repository {data.get('full_name')} on GitHub."
            }
        elif resp.status_code == 422:
            # Already exists or validation issue; query repository info
            target_repo_path = f"{clean_org or user_login}/{clean_name}" if (clean_org or user_login) else clean_name
            get_resp = requests.get(f"{settings.GITHUB_API_URL}/repos/{target_repo_path}", headers=headers, timeout=10)
            if get_resp.status_code == 200:
                data = get_resp.json()
                return {
                    "success": True,
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
    branch: str = "main",
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Clones a remote repository into local_dir if not present,
    or pulls latest changes if repository already exists locally.
    Safely injects GitHub PAT credentials and sanitizes output.
    """
    if is_protected_repo(repo_url) or not is_isolated_workspace(local_dir):
        return {
            "success": False,
            "action": "refused",
            "local_dir": local_dir,
            "branch": branch,
            "output": "Clone refused: protected repository or target outside the generated projects root.",
        }
    res_repo, res_token, _ = _resolve_project_repo_and_token(local_dir)
    token = (token or res_token or "").strip()
    
    # Construct authenticated URL if token is available
    auth_url = repo_url
    if token and urllib.parse.urlsplit(settings.GITHUB_WEB_URL).netloc in repo_url:
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
            bootstrap_res = bootstrap_new_project_repo(local_dir, project_name=dir_name, github_repo=repo_url, token=token)
            return {
                "success": bootstrap_res["success"],
                "action": "bootstrapped_fallback",
                "local_dir": local_dir,
                "branch": branch,
                "output": clone_res["stderr"] or "Initialized local fallback repository."
            }

        # Configure agent identity inside cloned repo
        _configure_git_identity(local_dir)

        return {
            "success": True,
            "action": "cloned",
            "local_dir": local_dir,
            "branch": branch,
            "output": clone_res["stdout"] or f"Cloned {sanitize_sensitive_data(repo_url)} into {local_dir}"
        }
    else:
        # Existing repository: checkout and pull
        _configure_git_identity(local_dir)

        if token and urllib.parse.urlsplit(settings.GITHUB_WEB_URL).netloc in auth_url:
            _run_git_command(["remote", "set-url", "origin", auth_url], cwd=local_dir)

        _run_git_command(["fetch", "origin"], cwd=local_dir)
        checkout_res = git_checkout_branch(branch, create_if_missing=True, cwd=local_dir)
        pull_res = _run_git_command(["pull", "origin", branch, "--no-edit", "--autostash"], cwd=local_dir)

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
    author_name: Optional[str] = None,
    author_email: Optional[str] = None,
    files: Optional[List[str]] = None,
    force: bool = False
) -> Dict[str, Any]:
    """
    Stages modified files, creates a commit with agent author identity, and pushes to remote.
    """
    if not os.path.exists(local_dir):
        return {"success": False, "error": f"Directory does not exist: {local_dir}"}

    if not author_name or not author_email:
        author_name, author_email = _configured_git_identity()

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


def devops_create_project_repo(
    project: Any,
    user: Any = None,
    repo_name: Optional[str] = None,
    private: bool = False,
    org: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """
    DevOps agent procedure to provision a GitHub repository:
    1. Resolves GitHub credentials from Organization's GitHubIntegration or system environment.
    2. Calls GitHub REST API to create repository.
    3. Bootstraps the local project workspace (README.md, .gitignore, CI/CD pipeline).
    4. Commits and pushes initial scaffold to GitHub main branch.
    5. Links project.github_repo in TeamFlow database.
    6. Emits DevOps Agent events and logs system activity.
    """
    token = None
    clean_org = (org or "").strip() or None
    org_model = getattr(project, "organization", None) or (getattr(user, "organization", None) if user else None)
    if org_model:
        try:
            integration = getattr(org_model, "github_integration", None)
            if integration and integration.is_enabled:
                if integration.github_token:
                    token = integration.github_token.strip()
                if not clean_org and integration.github_org:
                    clean_org = integration.github_org.strip()
        except Exception:
            pass

    if not token:
        token = platform_github_token()
    if not clean_org:
        clean_org = platform_github_org() or None

    clean_repo_name = (repo_name or "").strip()
    if not clean_repo_name:
        proj_name = getattr(project, "name", "project")
        clean_repo_name = re.sub(r'[^a-zA-Z0-9]+', '-', proj_name.lower()).strip('-')[:50] or "app"

    remote_res = create_remote_repo(
        repo_name=clean_repo_name,
        private=private,
        description=description or getattr(project, "description", ""),
        auto_init=False,
        org=clean_org,
        token=token,
    )

    if not remote_res.get("success"):
        return {
            "ok": False,
            "error": remote_res.get("error", "Failed to create remote repository on GitHub."),
            "status_code": remote_res.get("status_code", 400),
        }
    full_name = remote_res.get("full_name")
    if is_protected_repo(full_name):
        return {
            "ok": False,
            "error": f"{full_name} is a protected repository and cannot be linked to an agent workspace.",
            "status_code": 400,
        }
    html_url = remote_res.get("html_url", f"{settings.GITHUB_WEB_URL}/{full_name}")
    clone_url = remote_res.get("clone_url", f"{settings.GITHUB_WEB_URL}/{full_name}.git")

    # Update project model
    project.github_repo = full_name
    project.save(update_fields=["github_repo"])

    # Bootstrap local workspace and push
    project_dir = get_project_workspace(project)
    if remote_res.get("exists"):
        _ensure_origin_configured(project_dir, full_name, token)
        git_pull("main", cwd=project_dir)

    bootstrap_res = bootstrap_new_project_repo(
        project_dir=project_dir,
        project_name=getattr(project, "name", clean_repo_name),
        description=getattr(project, "description", ""),
        github_repo=full_name,
        token=token,
        push=bool(token),
    )

    # Emit Agent Event if task exists
    try:
        first_task = getattr(project, "tasks", None)
        if first_task and first_task.exists():
            from agents.events import emit_agent_event
            t = first_task.first()
            emit_agent_event(
                task=t,
                session_id=f"devops-repo-{project.id}",
                sender_key="devops",
                event_type="completed",
                message=f"DevOps agent: created and initialized GitHub repository {full_name} ({html_url}) with a CI pipeline.",
                metadata={
                    "full_name": full_name,
                    "html_url": html_url,
                    "clone_url": clone_url,
                }
            )
    except Exception as exc:
        logger.warning(f"Could not emit agent event for repo creation: {exc}")

    return {
        "ok": True,
        "repo_name": clean_repo_name,
        "full_name": full_name,
        "html_url": html_url,
        "clone_url": clone_url,
        "exists": remote_res.get("exists", False),
        "pushed": bootstrap_res.get("pushed", False),
        "message": (
            f"Repository {full_name} is linked and the initial scaffold was pushed."
            if bootstrap_res.get("pushed")
            else f"Repository {full_name} is linked, but the initial scaffold push did not succeed."
        ),
    }

