import os
import re
import time
from django.conf import settings
import json
from typing import Dict, Any
from agents.state import TicketState
from agents.tools.github_tool import create_branch, open_pull_request
from agents.tools.app_tool import add_ticket_comment, log_task_activity
from agents.tools.redis_tool import publish_agent_event
from agents.events import emit_state_event

from agents.llm import generate_text_detailed
from agents.code_writer import parse_file_blocks, safe_workspace_path, clean_code_content
from agents.registry import get_agent_spec
from agents.users import get_agent_user_for_task
from tasks.models import Task
from agents.git_service import (
    get_project_workspace,
    git_pull,
    git_checkout_branch,
    run_project_build,
    git_commit,
    git_push,
    git_create_pull_request,
    _resolve_project_repo_and_token,
)


def frontend_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    Frontend specialist node.

    Generates the ticket's frontend files with the configured language model,
    commits them in the project workspace and hands off to the Tech Lead. With
    no model configured it writes nothing and reports that plainly.
    """
    ticket_id = state.get("ticket_id")
    title = state.get("title", "")
    description = state.get("description", "")
    history = list(state.get("history", []))
    code_changes = dict(state.get("code_changes", {}))
    total_tokens = state.get("total_tokens", 0)
    total_cost = state.get("total_cost_usd", 0.0)
    
    agent_key = "frontend"
    agent_spec = get_agent_spec(agent_key)
    author_name = agent_spec["name"]
    agent_role = agent_spec["role"]
    
    task_obj = Task.objects.get(id=ticket_id) if ticket_id else None
    agent_user = get_agent_user_for_task(task_obj, agent_key) if task_obj else None
    author_email = agent_user.email if agent_user else getattr(settings, "GIT_AUTHOR_EMAIL", "")

    # 1. Start the implementation step
    emit_state_event(
        state,
        event_type="thought",
        sender_key="frontend_app",
        message=f"Reading ticket #{ticket_id}: '{title}'.",
        current_work="Reading the ticket",
        remaining_work=["generate files", "static checks", "commit and push", "Tech Lead review"],
    )

    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title.lower()).strip("-")[:24] if title else f"ticket-{ticket_id}"

    emit_state_event(
        state,
        event_type="progress",
        sender_key="frontend_app",
        message=f"Generating the frontend implementation for ticket #{ticket_id}.",
        current_work="Generating frontend files",
    )

    # 2. Generate the files with the configured model
    sys_prompt = (
        f"You are a {agent_role}. Generate the frontend files for the ticket. "
        f"Output only FILE: <path> and CODE: blocks."
    )
    user_prompt = (
        f"Ticket #{ticket_id}: {title}\n"
        f"Description: {description}\n"
        f"Context: {state.get('retrieved_context', [])}\n"
        f"Provide the implementation."
    )

    # 3. Resolve isolated project workspace and branch operations
    project_workspace = state.get("workspace_path") or get_project_workspace(state.get("project_id") or ticket_id)
    branch_name = f"feat/ticket-{ticket_id}-frontend-{slug}"
    repo_name = (state.get("github_repo") or "").strip()
    if not repo_name:
        resolved_repo, _, _ = _resolve_project_repo_and_token(project_workspace)
        repo_name = resolved_repo

    llm_res = generate_text_detailed(sys_prompt, user_prompt)
    llm_output = llm_res.text if llm_res else None
    if llm_res and llm_res.total_tokens is not None:
        total_tokens += llm_res.total_tokens
        
    if not llm_output:
        step_log = {
            "node": "frontend",
            "agent_role": agent_role,
            "action": "implementation_blocked",
            "message": f"{author_name} generated no code because no language model is configured.",
            "pr_url": "",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        }
        history.append(step_log)
        if ticket_id:
            add_ticket_comment(
                ticket_id,
                agent_key,
                f"**{author_name} - {agent_role}**\n\nNo language model is configured, so no code was generated.",
            )
        emit_state_event(
            state,
            event_type="blocked",
            sender_key="frontend_app",
            recipient_key="system",
            message="No code was generated.",
            current_work="Failed to generate code",
            remaining_work=["configure language model"],
            metadata={},
        )
        return {
            "status": "in_review",
            "pr_url": "",
            "assigned_agent": "tech_lead",
            "code_changes": code_changes,
            "files_modified": list(state.get("files_modified", [])),
            "workspace_path": project_workspace,
            "branch_name": state.get("branch_name", ""),
            "history": history,
            "total_tokens": total_tokens,
            "total_cost_usd": total_cost,
        }

    # 4. Pull latest main, checkout the feature branch and write the generated files
    git_pull("main", cwd=project_workspace)
    checkout_res = git_checkout_branch(branch_name, create_if_missing=True, cwd=project_workspace)

    written_files = []
    for rel_path, code in parse_file_blocks(llm_output):
        abs_path = safe_workspace_path(project_workspace, rel_path)
        if abs_path:
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            cleaned = clean_code_content(code)
            with open(abs_path, "w", encoding="utf-8") as fh:
                fh.write(cleaned)
            written_files.append(rel_path)
            code_changes[rel_path] = cleaned

    # 5. Pre-commit AST static analysis and build verification
    build_res = run_project_build(project_workspace)
    build_passed = build_res.get("success", False)

    # 6. Git commit with the agent seat identity
    commit_msg = f"feat(frontend): implement {title} [ticket #{ticket_id}]"

    commit_res = git_commit(
        message=commit_msg,
        author_name=author_name,
        author_email=author_email,
        files=written_files,
        cwd=project_workspace,
    )

    # 7. Push to the linked remote (reported truthfully when no remote is linked)
    committed = bool(checkout_res.get("success")) and bool(commit_res.get("success"))
    push_res = git_push(branch_name, cwd=project_workspace) if committed else {
        "success": False,
        "output": "Nothing was pushed because the commit step did not succeed.",
    }
    pushed = bool(push_res.get("success"))

    pr_title = f"feat(frontend): {title} [ticket #{ticket_id}]"
    pr_body = (
        f"## Scrum Sprint Increment by {author_name}\n\n"
        f"**Ticket:** #{ticket_id} - {title}\n"
        f"**Branch:** `{branch_name}`\n\n"
        f"### Files\n"
        + "".join(f"- `{path}`\n" for path in written_files)
        + f"- Static checks: {'PASSED' if build_passed else 'FAILED'} ({build_res.get('files_checked', 0)} files checked).\n"
    )

    if pushed and repo_name and "/" in repo_name:
        pr_info = git_create_pull_request(
            repo=repo_name,
            title=pr_title,
            body=pr_body,
            head_branch=branch_name,
            cwd=project_workspace,
        )
    else:
        pr_info = {"pr_url": "", "is_live_pr": False}

    build_summary = (
        f"static checks passed ({build_res.get('files_checked', 0)} files checked)"
        if build_passed
        else f"static checks reported problems: {build_res.get('output', '')}"
    )
    if not committed:
        git_summary = f"The commit on `{branch_name}` did not succeed: {commit_res.get('output') or checkout_res.get('output', '')}"
    elif pushed:
        git_summary = f"Committed `{commit_res.get('sha', '')}` and pushed `{branch_name}`."
    else:
        git_summary = f"Committed `{commit_res.get('sha', '')}` on `{branch_name}` locally; it was not pushed ({push_res.get('output', '')})."
    pr_summary = pr_info.get("pr_url") or "No pull request was opened."

    step_log = {
        "node": "frontend",
        "agent_role": agent_role,
        "action": "pull_request_created" if pr_info.get("is_live_pr") else ("branch_committed" if committed else "implementation_blocked"),
        "message": f"{author_name} generated {len(written_files)} file(s); {build_summary}. {git_summary}",
        "pr_url": pr_info.get("pr_url", ""),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    }
    history.append(step_log)

    # 8. Standup comment and handoff to the Tech Lead
    if ticket_id:
        blockers = []
        if not build_passed:
            blockers.append("static checks reported problems")
        if not committed:
            blockers.append("commit failed")
        elif not pushed:
            blockers.append("branch not pushed")
        standup_comment = (
            f"**{author_name} - {agent_role}**\n\n"
            f"**Standup and handoff to Tech Lead:**\n\n"
            f"- **Work:** Generated {len(written_files)} file(s): {', '.join(f'`{path}`' for path in written_files) or 'none'}.\n"
            f"- **Checks:** {build_summary}.\n"
            f"- **Git:** {git_summary}\n"
            f"- **Blockers:** {', '.join(blockers) if blockers else 'None'}.\n"
            f"- **PR:** {pr_summary}"
        )
        add_ticket_comment(ticket_id, agent_key, standup_comment)
        log_task_activity(ticket_id, author_name, "opened_pr", {"pr_url": pr_info.get("pr_url", ""), "branch": branch_name})

    publish_agent_event("pr_ready", {"ticket_id": ticket_id, "pr_url": pr_info.get("pr_url", "")})
    emit_state_event(
        state,
        event_type="handoff",
        sender_key="frontend_app",
        recipient_key="tech_lead",
        message=f"Frontend step finished: {build_summary}. {git_summary} Handed off to the Tech Lead.",
        current_work="Waiting for Tech Lead review",
        remaining_work=["Tech Lead review", "QA decision", "release handoff"],
        metadata={
            "pr_url": pr_info.get("pr_url", ""),
            "branch": branch_name,
            "build_passed": build_passed,
            "committed": committed,
            "pushed": pushed,
        },
    )

    files_modified = list(state.get("files_modified", []))
    for path in written_files:
        if path not in files_modified:
            files_modified.append(path)

    return {
        "status": "in_review",
        "pr_url": pr_info.get("pr_url", ""),
        "assigned_agent": "tech_lead",
        "code_changes": code_changes,
        "files_modified": files_modified,
        "workspace_path": project_workspace,
        "branch_name": branch_name if committed else state.get("branch_name", ""),
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
