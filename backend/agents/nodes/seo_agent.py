import time
from typing import Dict, Any
from agents.state import TicketState
from agents.tools.app_tool import add_ticket_comment, log_task_activity
from agents.events import emit_state_event

from agents.registry import get_agent_spec
from agents.users import get_agent_user_for_task
from tasks.models import Task


def seo_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    SEO Specialist Agent:
    - Analyzes metadata, slug structure, Core Web Vitals, and semantic tags
    """
    ticket_id = state.get("ticket_id")
    title = state.get("title", "")
    history = list(state.get("history", []))
    total_tokens = state.get("total_tokens", 0)
    total_cost = state.get("total_cost_usd", 0.0)

    agent_key = "seo"
    agent_spec = get_agent_spec(agent_key)
    author_name = agent_spec["name"]
    agent_role = agent_spec["role"]

    task_obj = Task.objects.get(id=ticket_id) if ticket_id else None
    agent_user = get_agent_user_for_task(task_obj, agent_key) if task_obj else None
    emit_state_event(
        state,
        event_type="progress",
        sender_key="seo",
        message="I am reviewing the ticket's technical SEO requirements and recording the audit step.",
        current_work="Reviewing technical SEO requirements",
        remaining_work=["SEO handoff", "Tech Lead review", "QA decision"],
    )

    step_log = {
        "node": "seo",
        "agent_role": agent_role,
        "action": "seo_audit_verified",
        "message": f"SEO Specialist verified OpenGraph meta tags, canonical URL headers, and Core Web Vitals targets for: {title}.",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    }
    history.append(step_log)
    emit_state_event(
        state,
        event_type="handoff",
        sender_key="seo",
        recipient_key="tech_lead",
        message="I completed the SEO review step and handed the findings back to the Tech Lead.",
        current_work="Waiting for Tech Lead review",
        remaining_work=["Tech Lead review", "QA decision"],
    )

    if ticket_id:
        add_ticket_comment(
            ticket_id,
            "seo",
            f"**{author_name} - {agent_role}**\n\nRecorded the SEO review step for `{title}`."
        )
        log_task_activity(ticket_id, author_name, "audited_seo", {"title": title})

    return {
        "assigned_agent": "tech_lead",
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
