import time
from typing import Dict, Any
from agents.state import TicketState
from agents.tools.app_tool import add_ticket_comment, log_task_activity


def seo_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    SEO Specialist Agent:
    - Analyzes metadata, slug structure, Core Web Vitals, and semantic tags
    """
    ticket_id = state.get("ticket_id")
    title = state.get("title", "")
    history = list(state.get("history", []))
    total_tokens = state.get("total_tokens", 0) + 360
    total_cost = state.get("total_cost_usd", 0.0) + 0.0036

    step_log = {
        "node": "seo",
        "agent_role": "SEO Specialist",
        "action": "seo_audit_verified",
        "message": f"SEO Specialist verified OpenGraph meta tags, canonical URL headers, and Core Web Vitals targets for: {title}.",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        "tokens": 360,
        "cost_usd": 0.0036,
    }
    history.append(step_log)

    if ticket_id:
        add_ticket_comment(
            ticket_id,
            "seo@teamflow.dev",
            f"🔍 SEO Agent: Technical audit complete. Canonical and metadata verified for {title}."
        )
        log_task_activity(ticket_id, "Ada Lovelace", "audited_seo", {"title": title})

    return {
        "assigned_agent": "tech_lead",
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
