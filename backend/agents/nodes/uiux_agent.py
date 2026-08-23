import time
from typing import Dict, Any
from agents.state import TicketState
from agents.tools.app_tool import add_ticket_comment, log_task_activity


def uiux_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    UI/UX Designer Specialist Agent:
    - Generates component wireframes, design tokens, and accessibility specifications
    """
    ticket_id = state.get("ticket_id")
    title = state.get("title", "")
    history = list(state.get("history", []))
    total_tokens = state.get("total_tokens", 0) + 410
    total_cost = state.get("total_cost_usd", 0.0) + 0.0041

    step_log = {
        "node": "designer",
        "agent_role": "UI/UX Designer",
        "action": "design_spec_generated",
        "message": f"UI/UX Designer drafted wireframes, responsive spacing tokens, and color contrast checks for: {title}.",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        "tokens": 410,
        "cost_usd": 0.0041,
    }
    history.append(step_log)

    if ticket_id:
        add_ticket_comment(
            ticket_id,
            "design@teamflow.dev",
            f"✨ UI/UX Agent: Completed design tokens & layout specs for {title}. Handoff to Frontend engineer."
        )
        log_task_activity(ticket_id, "Leonardo DaVinci", "created_design_spec", {"title": title})

    return {
        "assigned_agent": "frontend",
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
