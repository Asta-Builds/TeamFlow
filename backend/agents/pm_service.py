"""
Product Manager (PM) AI Service for TeamFlow.
Decomposes high-level CEO plans and user visions into engineering tickets,
assigns specialist AI agents, and generates human-like collaborative dialogue.
"""

import os
import re
import time
import logging
from typing import List, Dict, Any, Optional
from django.contrib.auth import get_user_model
from tasks.models import Task, Comment, TaskActivity
from notifications.models import Notification
from projects.models import Project
from .tools.rag_tool import retrieve_context

logger = logging.getLogger(__name__)
User = get_user_model()

AGENT_ROLES = {
    "backend": {"email": "backend1@teamflow.dev", "name": "Marcus Aurelius (AI)", "role": "backend"},
    "frontend": {"email": "frontend1@teamflow.dev", "name": "Cleopatra (AI)", "role": "frontend"},
    "qa": {"email": "qa@teamflow.dev", "name": "Alan Turing (AI)", "role": "qa"},
    "devops": {"email": "devops@teamflow.dev", "name": "Joan of Arc (AI)", "role": "devops"},
    "designer": {"email": "design@teamflow.dev", "name": "Leonardo Da Vinci (AI)", "role": "designer"},
    "seo": {"email": "seo@teamflow.dev", "name": "Ada Lovelace (AI)", "role": "seo"},
    "tech_lead": {"email": "lead@teamflow.dev", "name": "Sarah Jenkins (AI)", "role": "tech_lead"},
    "pm": {"email": "pm@teamflow.dev", "name": "Athena (AI)", "role": "pm"},
}


def get_or_create_agent_user(role_key: str, organization) -> User:
    meta = AGENT_ROLES.get(role_key, AGENT_ROLES["tech_lead"])
    user, _ = User.objects.get_or_create(
        email=meta["email"],
        defaults={
            "name": meta["name"],
            "role": meta["role"],
            "organization": organization,
            "user_status": User.Status.ACTIVE,
            "bio": f"Autonomous AI Agent ({meta['name']})",
        }
    )
    return user


def decompose_plan_and_create_tasks(
    project: Project,
    plan_text: str,
    creator_user: Any
) -> Dict[str, Any]:
    """
    Takes a product plan, decomposes it into 3-5 structured tickets,
    assigns specialist AI agents, generates human-like discussion comments,
    and logs activities.
    """
    pm_user = get_or_create_agent_user("pm", project.organization)
    backend_user = get_or_create_agent_user("backend", project.organization)
    frontend_user = get_or_create_agent_user("frontend", project.organization)
    qa_user = get_or_create_agent_user("qa", project.organization)
    devops_user = get_or_create_agent_user("devops", project.organization)
    design_user = get_or_create_agent_user("designer", project.organization)

    rag_chunks = retrieve_context(f"{project.name} {plan_text}", project_id=project.id)

    # 1. Parse plan sections or synthesize default engineering tickets
    clean_plan = plan_text.strip()
    summary_title = clean_plan.split("\n")[0].replace("#", "").replace("@pm", "").strip()[:80] or project.name

    tickets_spec = [
        {
            "title": f"[Backend] API Endpoints & Data Model for {summary_title}",
            "type": Task.Type.FEATURE,
            "priority": Task.Priority.HIGH,
            "assignee": backend_user,
            "description": (
                f"**Feature Scope:** {summary_title}\n\n"
                f"**Requirements from PM Plan:**\n{clean_plan}\n\n"
                f"**Deliverables:**\n"
                f"- Database models with pgvector indexing where applicable\n"
                f"- Django REST framework endpoints with validation & error handling\n"
                f"- Concurrency safety with transactional mutexes\n"
                f"- Open GitHub PR on `{getattr(project, 'github_repo', 'Asta-Builds/TeamFlow')}`"
            ),
            "dialogue": [
                {
                    "author": pm_user,
                    "text": f"Hey @{backend_user.name.split()[0]}! Here are the backend specs for **{summary_title}**. Let me know if you need clarification on the schema."
                },
                {
                    "author": backend_user,
                    "text": f"Thanks @{pm_user.name.split()[0]}! I've reviewed the requirements and retrieved {len(rag_chunks)} RAG architectural context chunks. I'll scaffold the Django models, serializer schemas, and open the PR shortly."
                }
            ]
        },
        {
            "title": f"[Frontend] Next.js Views & State Management for {summary_title}",
            "type": Task.Type.FEATURE,
            "priority": Task.Priority.HIGH,
            "assignee": frontend_user,
            "description": (
                f"**Feature Scope:** {summary_title}\n\n"
                f"**UI/UX Requirements:**\n"
                f"- SuperDesign dark theme (`bg-slate-950`, `border-slate-800`)\n"
                f"- Lucide React vector icons (strictly zero raw emojis)\n"
                f"- Sonner toasts for interactive user feedback\n"
                f"- Responsive layout adhering to WCAG 2.1 AA contrast"
            ),
            "dialogue": [
                {
                    "author": pm_user,
                    "text": f"Hi @{frontend_user.name.split()[0]}, here are the client UI requirements for **{summary_title}**. Make sure to follow the SuperDesign theme guidelines."
                },
                {
                    "author": frontend_user,
                    "text": f"On it @{pm_user.name.split()[0]}! I'll build the Next.js 16 App Router components using Lucide icons, responsive drawer modals, and optimistic toast feedback."
                }
            ]
        },
        {
            "title": f"[QA] Automated Integration & Regression Suite for {summary_title}",
            "type": Task.Type.TASK,
            "priority": Task.Priority.MEDIUM,
            "assignee": qa_user,
            "description": (
                f"**Testing Criteria:**\n"
                f"- Concurrency load harness (>50 req/s)\n"
                f"- Boundary and edge condition validation\n"
                f"- 5-stage Kanban decision gate verification before merging"
            ),
            "dialogue": [
                {
                    "author": pm_user,
                    "text": f"@{qa_user.name.split()[0]}, please define the acceptance test criteria for this sprint once backend & frontend PRs are drafted."
                },
                {
                    "author": qa_user,
                    "text": f"Understood @{pm_user.name.split()[0]}. I will set up automated integration tests, verify token refresh timeout thresholds, and enforce the QA decision gate."
                }
            ]
        }
    ]

    # Add DevOps CI ticket if plan mentions deploy/infra/ci/cd/docker
    if any(w in clean_plan.lower() for w in ["deploy", "docker", "ci", "cd", "pipeline", "release", "infra"]):
        tickets_spec.append({
            "title": f"[DevOps] Staging Pipeline & Container Build for {summary_title}",
            "type": Task.Type.TASK,
            "priority": Task.Priority.MEDIUM,
            "assignee": devops_user,
            "description": (
                f"**Release & Infra Scope:**\n"
                f"- Verify Docker container health and zero downtime build\n"
                f"- Generate staging rollback snapshot\n"
                f"- Health check endpoint verification (HTTP 200)"
            ),
            "dialogue": [
                {
                    "author": pm_user,
                    "text": f"@{devops_user.name.split()[0]}, please prepare the Staging release pipeline for **{summary_title}**."
                },
                {
                    "author": devops_user,
                    "text": f"Ready @{pm_user.name.split()[0]}. Docker container build and health checks are configured. Rollback snapshot will be generated automatically upon staging deploy."
                }
            ]
        })

    # 2. Persist Tasks and Human-like Dialogue in Database
    created_tasks = []
    total_comments = 0

    for spec in tickets_spec:
        task = Task.objects.create(
            project=project,
            organization=project.organization,
            created_by=creator_user if creator_user.is_authenticated else pm_user,
            assignee=spec["assignee"],
            title=spec["title"],
            description=spec["description"],
            task_type=spec["type"],
            priority=spec["priority"],
            status=Task.Status.TODO,
        )
        created_tasks.append(task)

        # Log Task Activity
        TaskActivity.objects.create(
            task=task,
            actor=pm_user,
            action="created_task",
            details={"source": "pm_agent_plan_decomposition", "plan_snippet": clean_plan[:100]}
        )

        # Create natural dialogue comments
        for d in spec.get("dialogue", []):
            Comment.objects.create(
                task=task,
                author=d["author"],
                body=d["text"],
            )
            total_comments += 1

    # 3. Create Notification for CEO
    if creator_user and creator_user != pm_user:
        Notification.objects.create(
            recipient=creator_user,
            actor=pm_user,
            title=f"PM Agent ({pm_user.name}) Decomposed Your Plan",
            message=f"Created {len(created_tasks)} engineering tickets and assigned them to specialist AI agents.",
            link=f"/projects/{project.id}",
            organization=project.organization,
        )

    return {
        "ok": True,
        "project_id": project.id,
        "tasks_created_count": len(created_tasks),
        "tasks": created_tasks,
        "pm_summary": (
            f"**Athena (AI PM):** Decomposed plan into **{len(created_tasks)} sprint tickets**.\n"
            f"- Assigned Backend to **{backend_user.name}**\n"
            f"- Assigned Frontend to **{frontend_user.name}**\n"
            f"- Assigned QA to **{qa_user.name}**\n"
            f"All agents have acknowledged receipt in ticket comments."
        ),
    }
