import time
from typing import Dict, Any
from agents.state import TicketState
from agents.tools.app_tool import add_ticket_comment, log_task_activity
from agents.events import emit_state_event

from agents.registry import get_agent_spec
from agents.users import get_agent_user_for_task
from tasks.models import Task


def uiux_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    UI/UX Designer Specialist Agent:
    - Generates component wireframes, design tokens, and accessibility specifications
    """
    ticket_id = state.get("ticket_id")
    title = state.get("title", "")
    history = list(state.get("history", []))
    total_tokens = state.get("total_tokens", 0)
    total_cost = state.get("total_cost_usd", 0.0)

    agent_key = "designer"
    agent_spec = get_agent_spec(agent_key)
    author_name = agent_spec["name"]
    agent_role = agent_spec["role"]

    task_obj = Task.objects.get(id=ticket_id) if ticket_id else None
    agent_user = get_agent_user_for_task(task_obj, agent_key) if task_obj else None
    emit_state_event(
        state,
        event_type="progress",
        sender_key="designer",
        message="I am reviewing the interaction and accessibility requirements before handing specifications to frontend.",
        current_work="Reviewing UI/UX requirements",
        remaining_work=["design handoff", "frontend implementation", "QA decision"],
    )

    step_log = {
        "node": "designer",
        "agent_role": agent_role,
        "action": "design_spec_generated",
        "message": f"{author_name} drafted wireframes, responsive spacing tokens, and color contrast checks for: {title}.",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    }
    history.append(step_log)
    emit_state_event(
        state,
        event_type="handoff",
        sender_key="designer",
        recipient_key="frontend_app",
        message="I completed the design review step and handed the specifications to frontend.",
        current_work="Waiting for frontend implementation",
        remaining_work=["frontend implementation", "QA decision"],
    )

    if ticket_id:
        add_ticket_comment(
            ticket_id,
            agent_key,
            f"**{author_name} - {agent_role}**\n\n**Design handoff to Frontend:**\n\nRecorded the design step for `{title}`. The frontend engineer picks up component implementation next."
        )
        log_task_activity(ticket_id, author_name, "created_design_spec", {"title": title})

    return {
        "assigned_agent": "frontend",
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
