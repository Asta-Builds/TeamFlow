"""
Autonomous Agent Code Writer and Git Lifecycle Engine.
Parses file changes from local LLM generation and writes them STRICTLY inside the
project's dedicated workspace (`generated_projects/{project_id}_{slug}/`).
The main TeamFlow platform repository is NEVER touched or modified.
"""

import os
import re
import difflib
import logging
from typing import Dict, Any, Optional

from .git_service import (
    get_project_workspace,
    git_pull,
    git_checkout_branch,
    run_project_build,
    git_commit,
    git_push,
    git_create_pull_request,
)

logger = logging.getLogger(__name__)


def clean_code_content(code_str: str) -> str:
    """Strips leading/trailing markdown code block ticks cleanly."""
    cleaned = code_str.strip()
    cleaned = cleaned.replace("\r\n", "\n")
    cleaned = re.sub(r'^```[a-zA-Z0-9+-]*\n', '', cleaned)
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].strip()
    return cleaned


def safe_workspace_path(project_workspace: str, rel_path: str) -> Optional[str]:
    """
    Resolve a model-supplied file path inside the project workspace.

    Returns None for absolute paths, parent-directory segments, anything inside a
    ``.git`` directory (hooks would run on the next commit), or paths that resolve
    outside the workspace through symlinks.
    """
    candidate = (rel_path or "").strip().replace("\\", "/")
    if not candidate or candidate.startswith("/") or re.match(r"^[A-Za-z]:", candidate):
        return None
    parts = [p for p in candidate.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts) or any(p.lower() == ".git" for p in parts):
        return None
    root = os.path.realpath(project_workspace)
    resolved = os.path.realpath(os.path.join(root, *parts))
    try:
        if os.path.commonpath([resolved, root]) != root or resolved == root:
            return None
    except ValueError:
        return None
    return resolved


def parse_and_apply_code_changes(
    llm_output: str,
    task: Any = None,
    agent_info: Optional[Dict[str, Any]] = None,
    repo_name: Optional[str] = None
) -> str:
    """
    Parses LLM output for FILE: and CODE: blocks or direct markdown blocks,
    writes them to the ISOLATED project repository, and executes full human-like Git workflow.
    """
    # 1. Resolve dedicated project workspace (NEVER modifies TeamFlow platform)
    project_workspace = get_project_workspace(task)
    if not os.path.exists(project_workspace):
        os.makedirs(project_workspace, exist_ok=True)

    # 2. Robust line-by-line parsing supporting multiple formats
    lines = llm_output.split("\n")
    file_blocks = []
    
    current_file = None
    current_code = []
    in_code_block = False
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Check for FILE header (e.g. FILE: path, ### FILE: path, File: path, **FILE: path**)
        file_match = re.search(r'(?:FILE|Fichier|File):\s*`?\*?([^`\n\s#*]+)\*?`?', line, re.IGNORECASE)
        if file_match:
            if current_file and current_code:
                file_blocks.append((current_file, "\n".join(current_code)))
            
            path_val = file_match.group(1).strip().rstrip(":").rstrip("*").rstrip("`")
            current_file = path_val
            current_code = []
            in_code_block = False
            i += 1
            continue
            
        if current_file:
            if not in_code_block:
                if "CODE:" in line.upper() or line.strip().startswith("```"):
                    in_code_block = True
                    i += 1
                    continue
            else:
                if line.strip() == "---" or (line.strip() == "```" and len(current_code) > 0):
                    file_blocks.append((current_file, "\n".join(current_code)))
                    current_file = None
                    current_code = []
                    in_code_block = False
                else:
                    current_code.append(line)
        i += 1
        
    if current_file and current_code:
        file_blocks.append((current_file, "\n".join(current_code)))

    if not file_blocks:
        return ""

    # Agent and Repo Metadata
    agent_name = agent_info.get("name", "TeamFlow Agent") if agent_info else "TeamFlow Agent"
    agent_email = (
        agent_info.get("email", "") if agent_info else ""
    ) or getattr(getattr(task, "assignee", None), "email", "")
    agent_role = agent_info.get("role", "developer") if agent_info else "developer"
    
    target_repo = repo_name
    project_name = "Project Codebase"
    if task and hasattr(task, "project") and task.project:
        target_repo = getattr(task.project, "github_repo", "")
        project_name = getattr(task.project, "name", "Project Codebase")
    
    # 3. Autonomous Git Lifecycle: Pull latest main first
    task_id = getattr(task, "id", "dev") if task else "dev"
    task_title = getattr(task, "title", "code updates") if task else "code updates"
    clean_title = re.sub(r'[^a-zA-Z0-9]+', '-', task_title.lower()).strip('-')[:28]
    branch_name = f"feat/ticket-{task_id}-{clean_title}"

    # Synchronize with main before feature branching
    pull_res = git_pull("main", cwd=project_workspace)
    git_checkout_branch(branch_name, create_if_missing=True, cwd=project_workspace)

    # Relative display path for UI
    workspace_rel_display = os.path.relpath(project_workspace, os.environ.get("WORKSPACE_ROOT", "/workspace"))
    if workspace_rel_display.startswith("."):
        workspace_rel_display = os.path.basename(project_workspace)

    summary_parts = []
    summary_parts.append(f"\n\n### Project Modifications: `{project_name}`")
    summary_parts.append(f"- Dedicated Workspace: `{workspace_rel_display}/`")

    written_files = []

    for rel_path, code in file_blocks:
        abs_path = safe_workspace_path(project_workspace, rel_path)
        if abs_path is None:
            summary_parts.append(f"\n- Skipped unsafe path: `{rel_path.strip()}`")
            continue
        rel_path = os.path.relpath(abs_path, os.path.realpath(project_workspace)).replace(os.sep, "/")

        old_lines = []
        if os.path.exists(abs_path):
            try:
                with open(abs_path, 'r', encoding='utf-8') as f:
                    old_lines = f.readlines()
            except Exception as e:
                logger.warning(f"Could not read existing file {abs_path}: {e}")

        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        code_cleaned = clean_code_content(code)

        try:
            with open(abs_path, 'w', encoding='utf-8') as f:
                f.write(code_cleaned)

            written_files.append(rel_path)
            new_lines = [line + '\n' for line in code_cleaned.split('\n')]
            
            diff = list(difflib.unified_diff(
                old_lines, new_lines,
                fromfile=f"a/{rel_path}", tofile=f"b/{rel_path}"
            ))
            diff_text = "".join(diff)

            if diff_text:
                summary_parts.append(f"\n- File Modified: `{rel_path}`")
                summary_parts.append("```diff\n" + diff_text[:800] + ("\n... (diff truncated)" if len(diff_text) > 800 else "") + "\n```")
            else:
                summary_parts.append(f"\n- File Created: `{rel_path}`")
                summary_parts.append("```tsx\n" + code_cleaned[:300] + ("\n... (code truncated)" if len(code_cleaned) > 300 else "") + "\n```")

        except Exception as e:
            logger.error(f"Failed to write file {abs_path}: {e}")
            summary_parts.append(f"\n- Error on `{rel_path}`: {e}")

    # 4. Autonomous Project Build & Static Analysis Verification
    build_res = run_project_build(project_workspace)
    build_passed = build_res.get("success", False)

    summary_parts.append("\n\n### Build & Static Analysis Verification")
    if build_passed:
        summary_parts.append(f"- Build Result: {build_res.get('output', 'Success')}")
        summary_parts.append(f"- Analysis Duration: `{build_res.get('duration_seconds', 0)}s` ({build_res.get('files_checked', len(written_files))} files audited)")
    else:
        summary_parts.append(f"- Build Warning: {build_res.get('output', 'Build error')}")

    # 5. Autonomous Git Commit in the project repository
    commit_msg = f"feat({agent_role}): {task_title} [ticket #{task_id}]"
    if not build_passed:
        commit_msg = f"wip({agent_role}): {task_title} [ticket #{task_id}] (build warnings)"

    commit_res = git_commit(
        message=commit_msg,
        author_name=agent_name,
        author_email=agent_email,
        files=written_files,
        cwd=project_workspace
    )

    # 6. Push only a successful commit
    committed = bool(commit_res.get("success"))
    push_res = git_push(branch_name, cwd=project_workspace) if committed else {
        "success": False,
        "output": "Not pushed because the commit did not succeed.",
    }

    # 7. Pull Request Creation (only for a pushed branch on a linked repository)
    pr_url = ""
    if push_res.get("success") and target_repo and "/" in target_repo:
        pr_body = (
            f"## Autonomous Engineering PR by {agent_name} ({agent_role})\n\n"
            f"**Project:** {project_name}\n"
            f"**Ticket:** #{task_id} - {task_title}\n\n"
            f"### Modified Files\n" +
            "\n".join(f"- `{f}`" for f in written_files) +
            f"\n\n### Build & Verification\n"
            f"- Build Status: {'PASSED' if build_passed else 'FAILED'}\n"
            f"- Output: {build_res.get('output', '')}\n\n"
            f"### Code Review Guidelines\n"
            f"- Built inside dedicated project workspace `{workspace_rel_display}`\n"
            f"- Pull latest main: {pull_res.get('output', '')}\n"
            f"- Follows TeamFlow virtual company guidelines\n"
        )
        pr_res = git_create_pull_request(
            repo=target_repo,
            title=f"feat({agent_role}): {task_title} (#{task_id})",
            body=pr_body,
            head_branch=branch_name,
            cwd=project_workspace,
        )
        pr_url = pr_res.get("pr_url", "")

    # 8. Format Git Activity Summary
    summary_parts.append("\n\n### Autonomous Git Lifecycle")
    summary_parts.append(f"- Git Pull (main): {pull_res.get('output', 'not run')}")
    summary_parts.append(f"- Branch: `{branch_name}`")
    if committed and commit_res.get("committed"):
        summary_parts.append(f"- Commit SHA: `{commit_res.get('sha', '')}` (Author: {agent_name} `<{agent_email}>`)")
    elif committed:
        summary_parts.append("- Commit: no new changes to commit")
    else:
        summary_parts.append(f"- Commit failed: {commit_res.get('output', '')}")
    if push_res.get("success"):
        summary_parts.append(f"- Git Push: branch `{branch_name}` pushed to the linked remote")
    else:
        summary_parts.append(f"- Git Push: not pushed ({push_res.get('output', '')})")
    if pr_url:
        summary_parts.append(f"- Pull Request: [#{task_id} - feat({agent_role}): {task_title}]({pr_url})")
    else:
        summary_parts.append("- Pull Request: none opened")

    return "\n".join(summary_parts)


def parse_file_blocks(llm_output: str) -> list:
    import re
    lines = llm_output.split("\n")
    file_blocks = []
    current_file = None
    current_code = []
    in_code_block = False
    i = 0
    while i < len(lines):
        line = lines[i]
        path_match = re.match(r'^(?:FILE|CODE):\s*(.+)$', line.strip(), re.IGNORECASE)
        if path_match and not in_code_block:
            path_val = path_match.group(1).strip().strip('`').strip()
            if current_file and current_code:
                file_blocks.append((current_file, "\n".join(current_code)))
            current_file = path_val
            current_code = []
            in_code_block = False
            i += 1
            continue
            
        if current_file:
            if not in_code_block:
                if "CODE:" in line.upper() or line.strip().startswith("```"):
                    in_code_block = True
                    i += 1
                    continue
            else:
                if line.strip() == "---" or (line.strip() == "```" and len(current_code) > 0):
                    file_blocks.append((current_file, "\n".join(current_code)))
                    current_file = None
                    current_code = []
                    in_code_block = False
                else:
                    current_code.append(line)
        i += 1
        
    if current_file and current_code:
        file_blocks.append((current_file, "\n".join(current_code)))

    return file_blocks

