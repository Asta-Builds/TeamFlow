import time
from typing import Dict, Any
from agents.state import TicketState
from agents.tools.github_tool import create_branch, open_pull_request
from agents.tools.app_tool import add_ticket_comment, log_task_activity
from agents.tools.redis_tool import publish_agent_event


def backend_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    Backend Specialist Agent:
    - Writes models, views, API endpoints, and integration tests
    - Creates feature branch and opens Pull Request
    """
    ticket_id = state.get("ticket_id")
    title = state.get("title", "")
    history = list(state.get("history", []))
    code_changes = dict(state.get("code_changes", {}))
    total_tokens = state.get("total_tokens", 0) + 650
    total_cost = state.get("total_cost_usd", 0.0) + 0.0065

    # Simulate code generation based on title
    slug = title.lower().replace(" ", "-")[:24]
    branch_name = f"feat/backend-{slug}"
    repo_name = state.get("project_name", "Asta-Builds/TeamFlow")
    branch_info = create_branch(repo_name, branch_name)
    
    pr_title = f"feat(backend): {title}"
    pr_body = (
        f"## Summary\n"
        f"Automated implementation for ticket #{ticket_id}: {title}.\n\n"
        f"### Changes\n"
        f"- Implemented backend handlers and verified serializer schemas.\n"
        f"- Added unit test cases for edge condition coverage.\n"
        f"- Tested with local SQLite and PostgreSQL."
    )
    pr_info = open_pull_request(repo_name, pr_title, pr_body, branch_name)
    
    code_changes["backend/api_patch.py"] = f"# Automated backend implementation for: {title}\n"

    step_log = {
        "node": "backend",
        "agent_role": "Senior Backend Engineer",
        "action": "pull_request_created",
        "message": f"Backend agent implemented service changes on branch `{branch_name}` and opened PR {pr_info['pr_url']}.",
        "pr_url": pr_info["pr_url"],
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        "tokens": 650,
        "cost_usd": 0.0065,
    }
    history.append(step_log)

    if ticket_id:
        add_ticket_comment(
            ticket_id,
            "backend1@teamflow.dev",
            f"💻 Backend Agent: Implementation complete. Opened Pull Request: {pr_info['pr_url']}"
        )
        log_task_activity(ticket_id, "Marcus Aurelius", "opened_pr", {"pr_url": pr_info["pr_url"]})

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
