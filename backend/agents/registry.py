"""Canonical registry for TeamFlow's autonomous engineering seats.

The User.role field remains a domain permission (for example, ``backend``),
while a seat key identifies the individual agent responsible for a specific
area of that domain (for example, ``backend_integrations``).  Keeping those
concepts separate lets existing tasks and permissions remain compatible while
the orchestration layer routes work to the role split in the company blueprint.
"""

from typing import Any


AGENT_SEATS: dict[str, dict[str, Any]] = {
    "pm": {
        "key": "pm",
        "role": "pm",
        "name": "Athena (AI)",
        "email_local": "pm",
        "title": "Project Manager & Delivery Architect",
        "specialty": "End-to-end delivery leadership, Work Breakdown Structures (WBS), risk matrix analysis, scope/budget governance, and task delivery.",
        "capabilities": [
            "wbs_decomposition",
            "milestone_tracking",
            "risk_matrix_analysis",
            "scope_governance",
            "budget_forecasting",
            "kpi_monitoring",
            "sprint_planning",
            "post_mortem",
        ],
        "default_model": "pro",
        "avatar": "AT",
        "blueprint_seat": True,
    },
}

AGENT_ALIASES = {
    "lead": "pm",
    "tech_lead": "pm",
    "backend": "pm",
    "backend_core": "pm",
    "backend1": "pm",
    "backend-1": "pm",
    "backend2": "pm",
    "backend-2": "pm",
    "frontend": "pm",
    "frontend_app": "pm",
    "frontend1": "pm",
    "frontend-1": "pm",
    "frontend2": "pm",
    "frontend-2": "pm",
    "qa": "pm",
    "devops": "pm",
    "design": "pm",
    "designer": "pm",
    "ui": "pm",
    "seo": "pm",
    "agent": "pm",
    "ai": "pm",
    "project_manager": "pm",
    "projectmanager": "pm",
    "scrum_master": "pm",
}


def resolve_agent_key(value: str) -> str:
    """Return canonical seat key; only Athena (PM) is active."""
    return "pm"


def get_agent_spec(value: str) -> dict[str, Any]:
    """Fetch Athena PM seat specification."""
    spec = AGENT_SEATS["pm"]
    return {
        **spec,
        "system_instructions": (
            f"You are {spec['name']}, TeamFlow's {spec['title']}. "
            f"Your responsibility is {spec['specialty']}. "
            "Report only work that was actually performed, surface blockers clearly, "
            "and establish clear WBS and scope boundaries."
        ),
    }


def blueprint_agent_keys() -> list[str]:
    """Return the single autonomous seat (Athena PM)."""
    return ["pm"]


def active_agent_status(engine_available: bool = False) -> list[dict[str, str]]:
    """Build public roster with single Athena PM seat."""
    spec = AGENT_SEATS["pm"]
    return [
        {
            "key": spec["key"],
            "role": spec["role"],
            "name": spec["name"],
            "title": spec["title"],
            "engine": "Google Antigravity SDK",
            "status": "ready" if engine_available else "offline",
        }
    ]
