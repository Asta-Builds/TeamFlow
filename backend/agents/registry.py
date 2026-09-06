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
        "email": "pm@teamflow.dev",
        "title": "Project Manager & Delivery Architect",
        "specialty": "End-to-end delivery leadership, Work Breakdown Structures (WBS), risk matrix analysis, scope/budget governance, and cross-functional team enablement.",
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
        "blueprint_seat": False,
    },
    "tech_lead": {
        "key": "tech_lead",
        "role": "tech_lead",
        "name": "Sarah Jenkins (AI)",
        "email": "lead@teamflow.dev",
        "title": "Tech Lead & System Architect",
        "specialty": "Architecture, pgvector RAG, work decomposition, and pull-request review.",
        "capabilities": ["rag_search", "subagent_dispatch", "pr_review", "codebase_inspection"],
        "default_model": "pro",
        "avatar": "SJ",
        "blueprint_seat": True,
    },
    "backend_core": {
        "key": "backend_core",
        "role": "backend",
        "name": "Marcus Aurelius (AI)",
        "email": "backend1@teamflow.dev",
        "title": "Senior Backend Engineer — Core API",
        "specialty": "Django REST APIs, domain models, authorization, and core product security.",
        "capabilities": ["github_pr", "api_scaffold", "sql_optimization", "run_tests"],
        "default_model": "pro",
        "avatar": "MA",
        "blueprint_seat": True,
    },
    "backend_integrations": {
        "key": "backend_integrations",
        "role": "backend",
        "name": "Julius Caesar (AI)",
        "email": "backend2@teamflow.dev",
        "title": "Senior Backend Engineer — Integrations & Data",
        "specialty": "External integrations, async data pipelines, Redis/Celery jobs, and data reliability.",
        "capabilities": ["integration_design", "background_jobs", "data_pipeline", "run_tests"],
        "default_model": "pro",
        "avatar": "JC",
        "blueprint_seat": True,
    },
    "frontend_app": {
        "key": "frontend_app",
        "role": "frontend",
        "name": "Cleopatra (AI)",
        "email": "frontend1@teamflow.dev",
        "title": "Senior Frontend Engineer — Web App",
        "specialty": "Next.js application surfaces, API integration, client state, performance, and accessibility.",
        "capabilities": ["component_builder", "api_integration", "accessibility_audit"],
        "default_model": "pro",
        "avatar": "CP",
        "blueprint_seat": True,
    },
    "frontend_design_system": {
        "key": "frontend_design_system",
        "role": "frontend",
        "name": "Alexander (AI)",
        "email": "frontend2@teamflow.dev",
        "title": "Senior Frontend Engineer — Design System",
        "specialty": "Reusable UI primitives, design-system implementation, marketing surfaces, and frontend quality.",
        "capabilities": ["design_system", "component_library", "frontend_performance", "accessibility_audit"],
        "default_model": "pro",
        "avatar": "AL",
        "blueprint_seat": True,
    },
    "devops": {
        "key": "devops",
        "role": "devops",
        "name": "Joan of Arc (AI)",
        "email": "devops@teamflow.dev",
        "title": "DevOps & Release Engineer",
        "specialty": "CI/CD, infrastructure, environments, observability, releases, and rollback readiness.",
        "capabilities": ["docker_ci", "deployment_trigger", "rollback_snapshot", "health_check"],
        "default_model": "pro",
        "avatar": "JA",
        "blueprint_seat": True,
    },
    "qa": {
        "key": "qa",
        "role": "qa",
        "name": "Alan Turing (AI)",
        "email": "qa@teamflow.dev",
        "title": "QA Automation Engineer & Gatekeeper",
        "specialty": "Automated and exploratory testing, regression analysis, and release-quality sign-off.",
        "capabilities": ["integration_tests", "qa_decision_gate", "regression_suite"],
        "default_model": "pro",
        "avatar": "AT",
        "blueprint_seat": True,
    },
    "designer": {
        "key": "designer",
        "role": "designer",
        "name": "Leonardo Da Vinci (AI)",
        "email": "design@teamflow.dev",
        "title": "UI/UX Design Specialist",
        "specialty": "Wireframes, interaction design, design tokens, usability, and WCAG AA validation.",
        "capabilities": ["design_tokens", "wcag_checker", "mockup_generator"],
        "default_model": "flash",
        "avatar": "LD",
        "blueprint_seat": True,
    },
    "seo": {
        "key": "seo",
        "role": "seo",
        "name": "Ada Lovelace (AI)",
        "email": "seo@teamflow.dev",
        "title": "Technical SEO Specialist",
        "specialty": "Technical SEO, Core Web Vitals, metadata, crawlability, and search performance.",
        "capabilities": ["cwv_audit", "sitemap_crawler", "ticket_generator"],
        "default_model": "flash",
        "avatar": "AL",
        "blueprint_seat": True,
    },
}

AGENT_ALIASES = {
    "lead": "tech_lead",
    "backend": "backend_core",
    "backend1": "backend_core",
    "backend-1": "backend_core",
    "backend2": "backend_integrations",
    "backend-2": "backend_integrations",
    "frontend": "frontend_app",
    "frontend1": "frontend_app",
    "frontend-1": "frontend_app",
    "frontend2": "frontend_design_system",
    "frontend-2": "frontend_design_system",
    "design": "designer",
    "ui": "designer",
    "project_manager": "pm",
    "projectmanager": "pm",
    "scrum_master": "pm",
}


def resolve_agent_key(value: str) -> str:
    """Return a canonical seat key while preserving legacy @backend/@frontend tags."""
    normalized = (value or "tech_lead").strip().lower()
    normalized = AGENT_ALIASES.get(normalized, normalized)
    return normalized if normalized in AGENT_SEATS else "tech_lead"


def get_agent_spec(value: str) -> dict[str, Any]:
    """Fetch a seat specification, resolving a supported alias first."""
    spec = AGENT_SEATS[resolve_agent_key(value)]
    return {
        **spec,
        "system_instructions": (
            f"You are {spec['name']}, TeamFlow's {spec['title']}. "
            f"Your responsibility is {spec['specialty']} "
            "Report only work that was actually performed, surface blockers clearly, "
            "and identify the next concrete action before handing work off."
        ),
    }


def blueprint_agent_keys() -> list[str]:
    """Return the nine autonomous seats defined by the company blueprint."""
    return [key for key, spec in AGENT_SEATS.items() if spec["blueprint_seat"]]


def active_agent_status(engine_available: bool = False) -> list[dict[str, str]]:
    """Build the public roster using measured model-engine availability."""
    return [
        {
            "key": spec["key"],
            "role": spec["role"],
            "name": spec["name"],
            "title": spec["title"],
            "engine": "Google Antigravity SDK",
            "status": "ready" if engine_available else "offline",
        }
        for key, spec in AGENT_SEATS.items()
        if spec["blueprint_seat"]
    ]
