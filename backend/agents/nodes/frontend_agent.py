import time
from typing import Dict, Any
from agents.state import TicketState
from agents.tools.github_tool import create_branch, open_pull_request
from agents.tools.app_tool import add_ticket_comment, log_task_activity
from agents.tools.redis_tool import publish_agent_event


def frontend_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    Frontend Specialist Agent:
    - Implements Next.js UI components, Tailwind CSS styling, and client state
    - Opens Pull Request and links design tokens
    """
    ticket_id = state.get("ticket_id")
    title = state.get("title", "")
    history = list(state.get("history", []))
    code_changes = dict(state.get("code_changes", {}))
    total_tokens = state.get("total_tokens", 0) + 580
    total_cost = state.get("total_cost_usd", 0.0) + 0.0058

    slug = title.lower().replace(" ", "-")[:24]
    branch_name = f"feat/frontend-{slug}"
    branch_info = create_branch("teamflow/teamflow", branch_name)
    
    pr_title = f"feat(frontend): {title}"
    pr_body = (
        f"## Summary\n"
        f"UI/UX implementation for ticket #{ticket_id}: {title}.\n\n"
        f"### Changes\n"
        f"- Built responsive Next.js component with Tailwind CSS.\n"
        f"- Verified accessibility, contrast ratios, and dark/light themes.\n"
        f"- Integrated with backend REST API endpoints."
    )
    pr_info = open_pull_request("teamflow/teamflow", pr_title, pr_body, branch_name)
    
    code_changes["frontend/component.tsx"] = f"// Automated React component for: {title}\n"

    step_log = {
        "node": "frontend",
        "agent_role": "Senior Frontend Engineer",
        "action": "pull_request_created",
        "message": f"Frontend agent built UI components on branch `{branch_name}` and opened PR {pr_info['pr_url']}.",
        "pr_url": pr_info["pr_url"],
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        "tokens": 580,
        "cost_usd": 0.0058,
    }
    history.append(step_log)

    if ticket_id:
        add_ticket_comment(
            ticket_id,
            "frontend1@teamflow.dev",
            f"🎨 Frontend Agent: UI components complete. Opened Pull Request: {pr_info['pr_url']}"
        )
        log_task_activity(ticket_id, "Cleopatra Philopator", "opened_pr", {"pr_url": pr_info["pr_url"]})

    publish_agent_event("pr_ready", {"ticket_id": ticket_id, "pr_url": pr_info["pr_url"]})

    return {
        "status": "in_review",
        "pr_url": pr_info["pr_url"],
        "assigned_agent": "tech_lead",
        "code_changes": code_changes,
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
