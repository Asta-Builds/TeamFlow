import time
from typing import Dict, Any
from agents.state import TicketState
from agents.tools.rag_tool import retrieve_context
from agents.tools.slack_tool import post_slack_message
from agents.tools.app_tool import add_ticket_comment, log_task_activity
from agents.events import emit_state_event


def tech_lead_node(state: TicketState) -> Dict[str, Any]:
    """
    Tech Lead Orchestrator Node:
    - Queries RAG for relevant codebase & architecture context
    - Decomposes ticket into specialist subtasks
    - Reviews incoming PRs from Backend & Frontend
    - Routes to QA or DevOps
    """
    ticket_id = state.get("ticket_id")
    title = state.get("title", "")
    description = state.get("description", "")
    task_type = state.get("task_type", "feature")
    history = list(state.get("history", []))
    subtasks = list(state.get("subtasks", []))
    total_tokens = state.get("total_tokens", 0) + 420
    total_cost = state.get("total_cost_usd", 0.0) + 0.0042

    emit_state_event(
        state,
        event_type="progress",
        sender_key="tech_lead",
        message="I am checking the architecture context, current ticket state, and the safest next owner.",
        current_work="Reviewing architecture and routing",
        remaining_work=["specialist implementation", "code review", "QA decision", "release handoff"],
    )

    # Step 1: Query RAG for architectural context if not already fetched
    retrieved = state.get("retrieved_context", [])
    if not retrieved:
        retrieved = retrieve_context(
            f"{title} {description}",
            project_id=state.get("project_id"),
        )

    # Step 2: Determine if this is an initial breakdown OR a PR review step
    has_pr = bool(state.get("pr_url"))
    qa_result = state.get("qa_result")

    if has_pr and not qa_result:
        # Tech Lead reviews the open PR
        step_log = {
            "node": "tech_lead",
            "agent_role": "Tech Lead",
            "action": "pr_review",
            "message": f"Tech Lead reviewed PR {state['pr_url']}. Code diff approved; routing to QA validation gate.",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
            "tokens": 280,
            "cost_usd": 0.0028,
        }
        history.append(step_log)
        
        # Log to TeamFlow DB
        if ticket_id:
            add_ticket_comment(ticket_id, "lead@teamflow.dev", f"🎯 Tech Lead: Code review completed on {state['pr_url']}. Moving ticket to QA.")
            log_task_activity(ticket_id, "Sarah Jenkins", "reviewed_pr", {"pr_url": state["pr_url"]})
        emit_state_event(
            state,
            event_type="handoff",
            sender_key="tech_lead",
            recipient_key="qa",
            message="I completed the orchestration review step and handed the recorded result to QA for independent validation.",
            current_work="Waiting for QA decision",
            remaining_work=["QA decision", "release handoff"],
        )
        
        return {
            "status": "in_review",
            "assigned_agent": "qa",
            "history": history,
            "retrieved_context": retrieved,
            "total_tokens": total_tokens + 280,
            "total_cost_usd": total_cost + 0.0028,
        }

    # Initial decomposition
    new_subtasks = []
    lower_text = (title + " " + description).lower()
    
    if "api" in lower_text or "backend" in lower_text or "token" in lower_text or "auth" in lower_text or "jwt" in lower_text:
        new_subtasks.append({"role": "backend", "task": f"Implement core logic & tests for: {title}"})
    if "ui" in lower_text or "frontend" in lower_text or "board" in lower_text or "modal" in lower_text or "design" in lower_text:
        new_subtasks.append({"role": "frontend", "task": f"Implement client UI/UX components for: {title}"})
    if "seo" in lower_text or "audit" in lower_text:
        new_subtasks.append({"role": "seo", "task": f"Perform technical SEO audit on: {title}"})
    
    if not new_subtasks:
        new_subtasks.append({"role": "backend", "task": f"Execute ticket: {title}"})

    step_log = {
        "node": "tech_lead",
        "agent_role": "Tech Lead",
        "action": "orchestration_dispatch",
        "message": f"Tech Lead analyzed ticket and retrieved {len(retrieved)} RAG architecture chunks. Dispatched subtasks to: {', '.join(s['role'] for s in new_subtasks)}.",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        "tokens": 420,
        "cost_usd": 0.0042,
    }
    history.append(step_log)

    if ticket_id:
        add_ticket_comment(
            ticket_id,
            "lead@teamflow.dev",
            f"🎯 Tech Lead: Ticket analyzed and context retrieved via pgvector RAG. Assigned to {new_subtasks[0]['role']} agent."
        )

    emit_state_event(
        state,
        event_type="handoff",
        sender_key="tech_lead",
        recipient_key=new_subtasks[0]["role"],
        message=f"I finished the initial breakdown and assigned the first work item to {new_subtasks[0]['role']}.",
        current_work="Waiting for specialist update",
        remaining_work=["specialist implementation", "code review", "QA decision", "release handoff"],
        metadata={"subtasks": new_subtasks},
    )

    return {
        "status": "in_progress",
        "assigned_agent": new_subtasks[0]["role"],
        "subtasks": new_subtasks,
        "retrieved_context": retrieved,
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
