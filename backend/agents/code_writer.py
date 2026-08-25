"""
Autonomous Agent Code Writer and Git Lifecycle Engine.
Parses file changes from local LLM generation, applies them directly to the workspace,
performs git branch checkout, git add/commit with agent author metadata, git push,
and creates GitHub Pull Requests automatically.
"""

import os
import re
import difflib
import logging
from typing import Dict, Any, Optional

from .git_service import (
    git_checkout_branch,
    git_commit,
    git_push,
    git_create_pull_request,
)

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = os.environ.get("WORKSPACE_ROOT", "/workspace")


def clean_code_content(code_str: str) -> str:
    """Strips leading/trailing markdown code block ticks cleanly."""
    cleaned = code_str.strip()
    # Normalize carriage returns to make regex platform-independent
    cleaned = cleaned.replace("\r\n", "\n")
    # Remove leading ```languages
    cleaned = re.sub(r'^```[a-zA-Z0-9+-]*\n', '', cleaned)
    # Remove trailing ```
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].strip()
    return cleaned


def parse_and_apply_code_changes(
    llm_output: str,
    task: Any = None,
    agent_info: Optional[Dict[str, Any]] = None,
    repo_name: Optional[str] = None
) -> str:
    """
    Parses LLM output for FILE: and CODE: blocks or direct markdown blocks, writes them to the workspace,
    and executes full human-like Git workflow (branching, committing, pushing, PR creation).
    """
    if not os.path.exists(WORKSPACE_ROOT):
        logger.warning(f"Workspace root '{WORKSPACE_ROOT}' not found. Skipping file writes.")
        return "\n\n*(Note: Le montage de l'espace de travail est inactif. Les fichiers ont été simulés.)*"

    # Robust line-by-line parsing supporting multiple formats
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
    agent_email = agent_info.get("email", "agent@teamflow.dev") if agent_info else "agent@teamflow.dev"
    agent_role = agent_info.get("role", "developer") if agent_info else "developer"
    
    target_repo = repo_name
    if not target_repo and task and hasattr(task, "project"):
        target_repo = getattr(task.project, "github_repo", "Asta-Builds/TeamFlow")
    target_repo = target_repo or "Asta-Builds/TeamFlow"

    # Step 1: Autonomous Git Branching
    task_id = getattr(task, "id", "dev") if task else "dev"
    task_title = getattr(task, "title", "code updates") if task else "code updates"
    clean_title = re.sub(r'[^a-zA-Z0-9]+', '-', task_title.lower()).strip('-')[:28]
    branch_name = f"feat/ticket-{task_id}-{clean_title}"

    git_checkout_branch(branch_name, create_if_missing=True)

    summary_parts = []
    summary_parts.append("\n\n### 🛠️ Modifications Appliquées en Direct")

    written_files = []

    for rel_path, code in file_blocks:
        rel_path = rel_path.strip().replace("..", "").strip("/")
        abs_path = os.path.join(WORKSPACE_ROOT, rel_path)

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
                summary_parts.append(f"\n📂 **Fichier modifié :** `{rel_path}`")
                summary_parts.append("```diff\n" + diff_text[:800] + ("\n... (diff tronqué)" if len(diff_text) > 800 else "") + "\n```")
            else:
                summary_parts.append(f"\n🆕 **Fichier créé :** `{rel_path}`")
                summary_parts.append("```tsx\n" + code_cleaned[:300] + ("\n... (code tronqué)" if len(code_cleaned) > 300 else "") + "\n```")

        except Exception as e:
            logger.error(f"Failed to write file {abs_path}: {e}")
            summary_parts.append(f"\n❌ **Erreur sur `{rel_path}` :** {e}")

    # Step 2: Autonomous Git Commit
    commit_msg = f"feat({agent_role}): {task_title} [ticket #{task_id}]"
    commit_res = git_commit(
        message=commit_msg,
        author_name=agent_name,
        author_email=agent_email,
        files=written_files
    )

    # Step 3: Autonomous Git Push
    push_res = git_push(branch_name)

    # Step 4: Autonomous Pull Request Creation
    pr_body = (
        f"## 🤖 Automated PR by {agent_name} ({agent_role})\n\n"
        f"**Ticket :** #{task_id} — {task_title}\n\n"
        f"### 📂 Modified Files\n" +
        "\n".join(f"- `{f}`" for f in written_files) +
        f"\n\n### 🛡️ Code Review Guidelines\n"
        f"- Tested on local workspace\n"
        f"- Follows TeamFlow virtual company guidelines\n"
    )
    pr_res = git_create_pull_request(
        repo=target_repo,
        title=f"feat({agent_role}): {task_title} (#{task_id})",
        body=pr_body,
        head_branch=branch_name
    )

    # Step 5: Format Git Activity Summary
    summary_parts.append("\n\n### 🌿 Cycle Git & GitHub Autonome")
    summary_parts.append(f"- 🎋 **Branche :** [`{branch_name}`](https://github.com/{target_repo}/tree/{branch_name})")
    if commit_res.get("sha"):
        summary_parts.append(f"- 💾 **Commit SHA :** `{commit_res['sha']}` *(Auteur : {agent_name} `<{agent_email}>`)*")
    
    pr_url = pr_res.get("pr_url", "")
    if pr_url:
        pr_title_display = f"#{pr_res.get('pr_number', 'PR')} — feat({agent_role}): {task_title}"
        summary_parts.append(f"- 🚀 **Pull Request :** [{pr_title_display}]({pr_url})")

    return "\n".join(summary_parts)
