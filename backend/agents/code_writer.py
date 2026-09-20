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
from dataclasses import dataclass
from typing import Dict, Any, Optional, List

from .untrusted_text import neutralize_untrusted_markdown
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


@dataclass
class CodeChangeOutcome:
    written_files: List[str]   # workspace-relative POSIX paths actually written
    report: str                # the same prose report the comment uses today


def apply_code_changes(
    llm_output: str,
    workspace: str,
    task: Any = None,
    agent_info: Optional[Dict[str, Any]] = None,
    repo_name: Optional[str] = None,
) -> CodeChangeOutcome:
    """
    Parses LLM output for FILE: and CODE: blocks and writes valid files into workspace.
    Returns CodeChangeOutcome with written workspace-relative POSIX paths and prose report.
    Executes Git lifecycle and build verification in workspace.
    """
    if not os.path.exists(workspace):
        os.makedirs(workspace, exist_ok=True)

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
        return CodeChangeOutcome(written_files=[], report="")

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

    task_id = getattr(task, "id", "dev") if task else "dev"
    task_title = getattr(task, "title", "code updates") if task else "code updates"
    clean_title = re.sub(r'[^a-zA-Z0-9]+', '-', task_title.lower()).strip('-')[:28]
    branch_name = f"feat/ticket-{task_id}-{clean_title}"

    pull_res = git_pull("main", cwd=workspace)
    git_checkout_branch(branch_name, create_if_missing=True, cwd=workspace)

    workspace_rel_display = os.path.relpath(workspace, os.environ.get("WORKSPACE_ROOT", "/workspace"))
    if workspace_rel_display.startswith("."):
        workspace_rel_display = os.path.basename(workspace)

    summary_parts = []
    summary_parts.append(f"\n\n### Project Modifications: `{project_name}`")
    summary_parts.append(f"- Dedicated Workspace: `{workspace_rel_display}/`")

    written_files = []

    for rel_path, code in file_blocks:
        abs_path = safe_workspace_path(workspace, rel_path)
        if abs_path is None:
            safe_display = neutralize_untrusted_markdown(rel_path.strip())
            summary_parts.append(f"\n- Skipped unsafe path: `{safe_display}`")
            continue
        clean_rel = os.path.relpath(abs_path, os.path.realpath(workspace)).replace(os.sep, "/")

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

            written_files.append(clean_rel)
            new_lines = [line + '\n' for line in code_cleaned.split('\n')]

            diff = list(difflib.unified_diff(
                old_lines, new_lines,
                fromfile=f"a/{clean_rel}", tofile=f"b/{clean_rel}"
            ))
            diff_text = "".join(diff)

            safe_rel = neutralize_untrusted_markdown(clean_rel)
            if diff_text:
                safe_diff = neutralize_untrusted_markdown(diff_text[:800])
                summary_parts.append(f"\n- File Modified: `{safe_rel}`")
                summary_parts.append("```diff\n" + safe_diff + ("\n... (diff truncated)" if len(diff_text) > 800 else "") + "\n```")
            else:
                safe_snippet = neutralize_untrusted_markdown(code_cleaned[:300])
                summary_parts.append(f"\n- File Created: `{safe_rel}`")
                summary_parts.append("```tsx\n" + safe_snippet + ("\n... (code truncated)" if len(code_cleaned) > 300 else "") + "\n```")

        except Exception as e:
            safe_rel = neutralize_untrusted_markdown(clean_rel)
            logger.error(f"Failed to write file {abs_path}: {e}")
            summary_parts.append(f"\n- Error on `{safe_rel}`: {e}")

    build_res = run_project_build(workspace)
    build_passed = build_res.get("success", False)

    summary_parts.append("\n\n### Build & Static Analysis Verification")
    if build_passed:
        summary_parts.append(f"- Build Result: {build_res.get('output', 'Success')}")
        summary_parts.append(f"- Analysis Duration: `{build_res.get('duration_seconds', 0)}s` ({build_res.get('files_checked', len(written_files))} files audited)")
    else:
        summary_parts.append(f"- Build Warning: {build_res.get('output', 'Build error')}")

    commit_msg = f"feat({agent_role}): {task_title} [ticket #{task_id}]"
    if not build_passed:
        commit_msg = f"wip({agent_role}): {task_title} [ticket #{task_id}] (build warnings)"

    commit_res = git_commit(
        message=commit_msg,
        author_name=agent_name,
        author_email=agent_email,
        files=written_files,
        cwd=workspace
    )

    committed = bool(commit_res.get("success"))
    push_res = git_push(branch_name, cwd=workspace) if committed else {
        "success": False,
        "output": "Not pushed because the commit did not succeed.",
    }

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
            cwd=workspace,
        )
        pr_url = pr_res.get("pr_url", "")

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

    report_str = "\n".join(summary_parts)
    return CodeChangeOutcome(written_files=written_files, report=report_str)


def parse_and_apply_code_changes(
    llm_output: str,
    task: Any = None,
    agent_info: Optional[Dict[str, Any]] = None,
    repo_name: Optional[str] = None
) -> str:
    """
    Parses LLM output for FILE: and CODE: blocks or direct markdown blocks,
    writes them to the ISOLATED project repository, and executes full human-like Git workflow.
    Thin wrapper delegating file writing to apply_code_changes.
    """
    project_workspace = get_project_workspace(task)
    outcome = apply_code_changes(
        llm_output=llm_output,
        workspace=project_workspace,
        task=task,
        agent_info=agent_info,
        repo_name=repo_name,
    )
    return outcome.report



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

