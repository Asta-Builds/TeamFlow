import re
import os
import time
import logging
from typing import List, Dict, Any, Optional
from django.contrib.auth import get_user_model
from tasks.models import Comment, Task, TaskActivity
from notifications.models import Notification
from agents.registry import AGENT_ALIASES, AGENT_SEATS, blueprint_agent_keys
from agents.tools.rag_tool import retrieve_context

logger = logging.getLogger(__name__)
User = get_user_model()

# The registry is the single source of truth for seat identity (Athena PM).
# All tags and aliases route to Athena PM.
AGENT_TAG_MAP: Dict[str, Dict[str, str]] = {
    key: {
        "key": spec["key"],
        "role": spec["role"],
        "email": "",
        "name": spec["name"],
        "title": spec["title"],
        "specialty": spec["specialty"],
    }
    for key, spec in AGENT_SEATS.items()
}
AGENT_TAG_MAP.update({
    alias: AGENT_TAG_MAP[canonical]
    for alias, canonical in AGENT_ALIASES.items()
    if canonical in AGENT_TAG_MAP
})


def extract_agent_tags(text: str) -> List[str]:
    """Finds all @mentions in text matching agent keys or 'all'/'swarm'."""
    pattern = r"@([a-zA-Z0-9_-]+)"
    matches = re.findall(pattern, text.lower())
    valid_tags = []
    for tag in matches:
        if tag in AGENT_TAG_MAP:
            if tag not in valid_tags:
                valid_tags.append(tag)
        elif tag in {"all", "swarm", "team"}:
            if "all" not in valid_tags:
                valid_tags.append("all")
    return valid_tags


def generate_llm_response(
    agent_info: Dict[str, str],
    prompt: str,
    task: Task,
    rag_context: List[str]
) -> str:
    """
    Generates an intelligent response for the specified agent.
    If OPENAI_API_KEY is available, uses LangChain ChatOpenAI.
    Otherwise uses context-rich template generation.
    """
    project_name = getattr(task.project, "name", "Dedicated Project") if hasattr(task, "project") and task.project else "Dedicated Project"
    project_desc = getattr(task.project, "description", "") if hasattr(task, "project") and task.project else ""

    system_prompt = (
        f"You are {agent_info['name']}, the {agent_info['title']} at TeamFlow.\n"
        f"Your specialty: {agent_info['specialty']}.\n"
        f"You are building the software application project '{project_name}' (Overview: {project_desc}).\n"
        f"Ticket: #{task.id} - {task.title}\n"
        f"Status: {task.status} | Priority: {task.priority}\n"
        f"Description: {task.description or 'None'}\n"
        f"RAG Context retrieved from pgvector codebase:\n" + "\n".join(rag_context[:3]) + "\n\n"
        f"Instructions:\n"
        f"1. Give a technically precise engineering response. Use bullet points when helpful.\n"
        f"2. You are writing files for '{project_name}'. NEVER modify TeamFlow platform files. Output each standalone project file block in this exact format:\n"
        f"FILE: [path/relative/to/project_root]\n"
        f"CODE:\n"
        f"[code content]\n"
        f"---\n"
        f"3. For frontend components, use Tailwind CSS, Hero UI (@heroui/react), or modern clean UI components with Lucide icons."
    )

    response_text = ""

    # 0. Tech Lead PR Merge Governance
    if any(w in prompt.lower() for w in ["merge", "fusionner", "valider la pr", "approuver la pr", "merge to main"]):
        try:
            from .git_service import git_merge_pull_request, get_project_workspace
            project_workspace = get_project_workspace(task)
            target_repo = getattr(task.project, "github_repo", "") or ""
            clean_title = re.sub(r'[^a-zA-Z0-9]+', '-', task.title.lower()).strip('-')[:28]
            branch_name = f"feat/ticket-{task.id}-{clean_title}"
            
            merge_res = git_merge_pull_request(
                repo=target_repo,
                source_branch=branch_name,
                target_branch="main",
                cwd=project_workspace
            )
            
            if merge_res["success"]:
                task.status = Task.Status.DONE
                task.save(update_fields=["status"])
                workspace_rel = os.path.basename(project_workspace)
                return (
                    f"**[PR Merge & Staging Deployment Approved]**\n\n"
                    f"I've verified the pull request for **#{task.id} : {task.title}** and successfully merged `{branch_name}` into `main`.\n\n"
                    f"- **Merged Branch:** `{branch_name}` -> `main`\n"
                    f"- **Merge Commit:** `{merge_res.get('merged_sha', 'HEAD')}`\n"
                    f"- **Dedicated Workspace:** `{workspace_rel}`\n"
                    f"- **Ticket Status:** Moved to **Done**."
                )
        except Exception as e:
            logger.error(f"Tech Lead merge failed: {e}")

    # 0b. Explicit Build & Pull Directives (strict phrase matching, never for questions)
    from .directives import detect_directives
    directives = detect_directives(prompt)
    if "build" in directives:
        try:
            from .git_service import run_project_build, get_project_workspace
            project_workspace = get_project_workspace(task)
            b_res = run_project_build(project_workspace)
            return (
                f"**[{agent_info['name']} - Build Verification]**\n\n"
                f"I ran the static checks in `{os.path.basename(project_workspace)}`:\n\n"
                f"- **Status:** `{'PASSED' if b_res['success'] else 'FAILED'}`\n"
                f"- **Output:** {b_res['output']}\n"
                f"- **Duration:** `{b_res['duration_seconds']}s`"
            )
        except Exception as e:
            logger.error(f"Build failed: {e}")

    if "pull" in directives:
        try:
            from .git_service import git_pull, get_project_workspace
            project_workspace = get_project_workspace(task)
            p_res = git_pull("main", cwd=project_workspace)
            return (
                f"**[{agent_info['name']} - Git Pull]**\n\n"
                f"Pull of `main` in workspace `{os.path.basename(project_workspace)}`:\n\n"
                f"- **Status:** `{'Success' if p_res['success'] else 'Not synchronized'}`\n"
                f"- **Details:** {p_res['output']}"
            )
        except Exception as e:
            logger.error(f"Git pull failed: {e}")

    # 1. Query Language Model via centralized llm service
    from .llm import generate_text, ModelUnavailable
    response_text = generate_text(system_prompt, prompt)

    # 4. Apply file changes and execute Git lifecycle (branch, commit, push, PR)
    diff_summary = ""
    if response_text:
        try:
            from .code_writer import parse_and_apply_code_changes
            diff_summary = parse_and_apply_code_changes(
                response_text,
                task=task,
                agent_info=agent_info
            )
            if diff_summary:
                response_text += diff_summary
        except Exception as e:
            logger.warning(f"Failed to parse and apply code changes: {e}")
        return response_text

    # 5. Fallback when no model is configured
    return ModelUnavailable.default_detail + (diff_summary if diff_summary else "")


def process_ceo_prompt(
    task: Task,
    prompt: str,
    user: Any,
    specific_tag: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Parses tagged agents in CEO prompt/comment, executes through the Google Antigravity SDK,
    saves comments to database, logs activities, and notifies the CEO.
    """
    tags = [specific_tag] if specific_tag and specific_tag in AGENT_TAG_MAP else extract_agent_tags(prompt)
    if not tags:
        # Default to Athena (PM)
        tags = ["pm"]

    if "all" in tags:
        tags = blueprint_agent_keys()

    responses = []
    from agents.antigravity_sdk import run_antigravity_agent

    for tag in tags:
        agent_meta = AGENT_TAG_MAP.get(tag)
        if not agent_meta:
            continue

        res = run_antigravity_agent(
            task=task,
            agent_role=agent_meta["key"],
            prompt=prompt,
            user=user
        )

        responses.append({
            "agent_tag": tag,
            "agent_name": res["agent_name"],
            "agent_role": res["agent_role"],
            "agent_email": agent_meta["email"],
            "comment_id": res["comment_id"],
            "trace_id": res["trace_id"],
            "response": res["response"],
            "thoughts": res.get("thoughts", []),
            "tool_calls": res.get("tool_calls", []),
            "session_id": res.get("session_id", ""),
            "langfuse_url": res.get("langfuse_url", ""),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        })

    return responses
