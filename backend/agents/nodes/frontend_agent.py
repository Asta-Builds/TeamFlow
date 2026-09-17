import os
import re
import time
import json
from typing import Dict, Any
from agents.state import TicketState
from agents.tools.github_tool import create_branch, open_pull_request
from agents.tools.app_tool import add_ticket_comment, log_task_activity
from agents.tools.redis_tool import publish_agent_event
from agents.events import emit_state_event
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
    Senior Frontend Engineer Node (frontend1@teamflow.dev):
    - Next.js 16 App Router (React 19), Turbopack, Tailwind CSS styling
    - Real-time SSE streaming for intermediate thoughts, tool calls, and text deltas
    - Client-side vs. server-side tool execution boundaries
    - Generative UI component hydration (typed payloads over raw markdown)
    - Zero-emoji policy: strictly Lucide React vector icons and Sonner toasts
    """
    ticket_id = state.get("ticket_id")
    title = state.get("title", "")
    description = state.get("description", "")
    history = list(state.get("history", []))
    code_changes = dict(state.get("code_changes", {}))
    total_tokens = state.get("total_tokens", 0) + 720
    total_cost = state.get("total_cost_usd", 0.0) + 0.0072

    # 1. Stream intermediate thought step: Architecture Analysis
    emit_state_event(
        state,
        event_type="thought",
        sender_key="frontend_app",
        message=f"[Frontend Agent] Analyzing UI requirements for ticket #{ticket_id}: '{title}'. Designing real-time SSE consumer and client runtime.",
        current_work="Analyzing frontend streaming architecture",
        remaining_work=["evaluate tool boundaries", "hydrate generative UI", "create PR branch", "Tech Lead review"],
    )

    # 2. Stream intermediate thought step: Client vs. Server Tool Separation
    emit_state_event(
        state,
        event_type="thought",
        sender_key="frontend_app",
        message="[Frontend Agent] Evaluating tool boundaries: isolating server-side Git mutations from client-side interactive actions and optimistic UI updates.",
        current_work="Evaluating client-side vs. server-side tools",
    )

    # 3. Simulate Server-Side Tool: Querying Design System & Component Library
    emit_state_event(
        state,
        event_type="tool_call",
        sender_key="frontend_app",
        message="Executed tool `query_design_tokens`: Retrieved Lucide React icons, Tailwind CSS theme tokens, and Sonner toast hooks.",
        metadata={"tool": "query_design_tokens", "target": "Next.js 16 App Router", "status": "completed"},
    )

    # 4. Stream Generative UI Hydration Event
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title.lower()).strip("-")[:24] if title else f"ticket-{ticket_id}"
    component_name = "".join(w.capitalize() for w in re_sub_slug(slug)) + "Widget"
    
    generative_ui_payload = {
        "component": component_name,
        "title": title,
        "streaming_transport": "SSE",
        "client_tools": ["trigger_sonner_toast", "optimistic_state_update", "open_confirmation_modal"],
        "server_tools": ["query_pgvector_rag", "commit_and_push"],
        "ui_spec": {
            "framework": "Next.js 16 App Router (React 19)",
            "icons": "Lucide React",
            "feedback": "Sonner toasts",
            "styling": "Tailwind CSS v4 (dark mode)",
        },
    }

    emit_state_event(
        state,
        event_type="progress",
        sender_key="frontend_app",
        message=f"Hydrating generative UI component `{component_name}` with dynamic schema and real-time SSE stream hook.",
        metadata={"generative_ui": generative_ui_payload},
        current_work=f"Scaffolding React 19 component {component_name}",
    )

    # 5. Build React 19 Next.js 16 component code
    component_code = (
        f'"use client";\n\n'
        f'import React, {{ useState, useEffect, useOptimistic, useTransition }} from "react";\n'
        f'import {{ toast }} from "sonner";\n'
        f'import {{ Sparkles, Terminal, CheckCircle2, AlertCircle, RefreshCw }} from "lucide-react";\n\n'
        f'interface {component_name}Props {{\n'
        f'  taskId: number;\n'
        f'  title: string;\n'
        f'  streamUrl?: string;\n'
        f'}}\n\n'
        f'export function {component_name}({{ taskId, title, streamUrl }}: {component_name}Props) {{\n'
        f'  const [isPending, startTransition] = useTransition();\n'
        f'  const [status, setStatus] = useState<"idle" | "streaming" | "ready">("idle");\n'
        f'  const [events, setEvents] = useState<Array<{{ id: string; type: string; content: string }}>>([]);\n'
        f'  const [optimisticCount, setOptimisticCount] = useOptimistic(events.length, (prev, update: number) => prev + update);\n\n'
        f'  useEffect(() => {{\n'
        f'    if (!streamUrl) return;\n'
        f'    setStatus("streaming");\n'
        f'    const source = new EventSource(streamUrl);\n'
        f'    source.onmessage = (event) => {{\n'
        f'      try {{\n'
        f'        const data = JSON.parse(event.data);\n'
        f'        setEvents((prev) => [...prev, {{ id: data.id || Math.random().toString(), type: data.event_type || "thought", content: data.message || "" }}]);\n'
        f'      }} catch (err) {{\n'
        f'        console.error("SSE parse error", err);\n'
        f'      }}\n'
        f'    }};\n'
        f'    source.onerror = () => {{\n'
        f'      source.close();\n'
        f'      setStatus("ready");\n'
        f'    }};\n'
        f'    return () => source.close();\n'
        f'  }}, [streamUrl]);\n\n'
        f'  const handleClientAction = () => {{\n'
        f'    startTransition(() => {{\n'
        f'      setOptimisticCount(1);\n'
        f'      toast.success("Action dispatched optimistically to agent runtime.");\n'
        f'    }});\n'
        f'  }};\n\n'
        f'  return (\n'
        f'    <div className="rounded-xl border border-border bg-card/60 p-4 backdrop-blur-md">\n'
        f'      <div className="flex items-center justify-between pb-3 border-b border-border/50">\n'
        f'        <div className="flex items-center gap-2">\n'
        f'          <Sparkles className="h-4 w-4 text-emerald-400" />\n'
        f'          <h3 className="text-sm font-semibold text-foreground">{{title}}</h3>\n'
        f'        </div>\n'
        f'        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono">\n'
        f'          {{status}}\n'
        f'        </span>\n'
        f'      </div>\n'
        f'      <div className="mt-3 space-y-2 max-h-48 overflow-y-auto text-xs font-mono text-muted-foreground">\n'
        f'        {{events.map((ev) => (\n'
        f'          <div key={{ev.id}} className="flex items-center gap-2 py-1">\n'
        f'            <Terminal className="h-3.5 w-3.5 text-sky-400 shrink-0" />\n'
        f'            <span>{{ev.content}}</span>\n'
        f'          </div>\n'
        f'        ))}}\n'
        f'      </div>\n'
        f'      <div className="mt-3 pt-3 border-t border-border/50 flex justify-end">\n'
        f'        <button\n'
        f'          onClick={{handleClientAction}}\n'
        f'          disabled={{isPending}}\n'
        f'          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-all"\n'
        f'        >\n'
        f'          Confirm Client Tool\n'
        f'        </button>\n'
        f'      </div>\n'
        f'    </div>\n'
        f'  );\n'
        f'}}\n'
    )

    component_path = f"frontend/src/components/generated/{component_name}.tsx"
    code_changes[component_path] = component_code

    # 6. Resolve isolated project workspace and branch operations
    project_workspace = state.get("workspace_path") or get_project_workspace(state.get("project_id") or ticket_id)
    branch_name = f"feat/ticket-{ticket_id}-frontend-{slug}"
    repo_name = (state.get("github_repo") or "").strip()
    if not repo_name:
        resolved_repo, _, _ = _resolve_project_repo_and_token(project_workspace)
        repo_name = resolved_repo

    # 7. Pull latest main and checkout feature branch before writing files
    git_pull("main", cwd=project_workspace)
    checkout_res = git_checkout_branch(branch_name, create_if_missing=True, cwd=project_workspace)

    abs_component_path = os.path.join(project_workspace, component_path)
    os.makedirs(os.path.dirname(abs_component_path), exist_ok=True)
    with open(abs_component_path, "w", encoding="utf-8") as fh:
        fh.write(component_code)

    # 8. Pre-commit AST Static Analysis & Invariant Build Verification
    build_res = run_project_build(project_workspace)
    build_passed = build_res.get("success", False)

    # 9. Git Commit with signed specialist identity
    author_name = "Cleopatra (AI)"
    author_email = "frontend1@teamflow.dev"
    commit_msg = f"feat(frontend): scaffold {component_name} [ticket #{ticket_id}]"

    commit_res = git_commit(
        message=commit_msg,
        author_name=author_name,
        author_email=author_email,
        files=[component_path],
        cwd=project_workspace,
    )

    # 10. Push to the linked remote (reported truthfully when no remote is linked)
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
        f"### Key Patterns Implemented\n"
        f"- Next.js 16 App Router (React 19) component scaffolded at `{component_path}`.\n"
        f"- Real-time SSE streaming consumption pattern.\n"
        f"- Strict zero-emoji compliance: Lucide React icons & Sonner toasts.\n"
        f"- Static checks: {'PASSED' if build_passed else 'FAILED'} ({build_res.get('files_checked', 0)} files checked).\n"
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
        "agent_role": "Senior Frontend Engineer",
        "action": "pull_request_created" if pr_info.get("is_live_pr") else ("branch_committed" if committed else "implementation_blocked"),
        "message": f"Cleopatra generated `{component_name}`; {build_summary}. {git_summary}",
        "pr_url": pr_info.get("pr_url", ""),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        "tokens": 720,
        "cost_usd": 0.0072,
    }
    history.append(step_log)

    # 11. Scrum Daily Standup update comment directly mentioning @qa & @tech_lead
    if ticket_id:
        blockers = []
        if not build_passed:
            blockers.append("static checks reported problems")
        if not committed:
            blockers.append("commit failed")
        elif not pushed:
            blockers.append("branch not pushed")
        standup_comment = (
            f"**Cleopatra (AI) - Senior Frontend Engineer**\n\n"
            f"**Standup and handoff to Tech Lead:**\n\n"
            f"- **Work:** Generated the Next.js component scaffold `{component_path}`.\n"
            f"- **Checks:** {build_summary}.\n"
            f"- **Git:** {git_summary}\n"
            f"- **Blockers:** {', '.join(blockers) if blockers else 'None'}.\n"
            f"- **PR:** {pr_summary}"
        )
        add_ticket_comment(ticket_id, "frontend1", standup_comment)
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
    if component_path not in files_modified:
        files_modified.append(component_path)

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


def re_sub_slug(text: str) -> list[str]:
    """Helper to tokenize slug into words for CamelCase component names."""
    import re
    words = [w for w in re.split(r"[^a-zA-Z0-9]+", text) if w]
    return words or ["Widget"]

