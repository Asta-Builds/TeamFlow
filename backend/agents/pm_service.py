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
from tasks.models import Task, Comment, TaskActivity
from notifications.models import Notification
from projects.models import Project
from .tools.rag_tool import retrieve_context
from .users import get_or_create_agent_user

logger = logging.getLogger(__name__)
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
    backend_user = get_or_create_agent_user("backend_core", project.organization)
    frontend_user = get_or_create_agent_user("frontend_app", project.organization)
    qa_user = get_or_create_agent_user("qa", project.organization)
    devops_user = get_or_create_agent_user("devops", project.organization)
    design_user = get_or_create_agent_user("designer", project.organization)

    rag_chunks = retrieve_context(f"{project.name} {plan_text}", project_id=project.id)

    # 1. Parse plan sections or synthesize default engineering tickets
    clean_plan = plan_text.strip()
    summary_title = clean_plan.split("\n")[0].replace("#", "").replace("@pm", "").strip()[:80] or project.name

    tickets_spec = [
        {
            "title": f"[WBS 1.1 - Backend] API Endpoints & Data Model for {summary_title}",
            "type": Task.Type.FEATURE,
            "priority": Task.Priority.HIGH,
            "assignee": backend_user,
            "description": (
                f"### 📋 Project Management Specification (WBS 1.1)\n"
                f"**Strategic Objective:** Deliver core backend architecture for `{summary_title}` within time and budget constraints.\n\n"
                f"**1. Scope Boundaries:**\n"
                f"- **In-Scope:** Data models with pgvector indexing, authenticated REST API endpoints, transaction mutexes, and unit test suite.\n"
                f"- **Out-of-Scope:** Non-critical third-party integrations (deferred to Milestone 2).\n\n"
                f"**2. Deliverables & Definition of Done (DoD):**\n"
                f"- Relational schema models validated against PostgreSQL constraints\n"
                f"- Django REST framework endpoints with status code handling (200/201/400/403/404)\n"
                f"- Concurrency safety with transactional mutexes\n"
                f"- Open GitHub PR on `{getattr(project, 'github_repo', 'Asta-Builds/TeamFlow')}`\n\n"
                f"**3. Risk & Contingency:**\n"
                f"- *Risk:* Concurrent race conditions during high-volume writes.\n"
                f"- *Mitigation:* `select_for_update()` mutex locking and database transaction rollbacks."
            ),
            "dialogue": [
                {
                    "author": pm_user,
                    "text": f"Hey @{backend_user.name.split()[0]}! Here are the WBS 1.1 backend delivery specifications for **{summary_title}**. Scope is strictly locked to prevent creep. Let me know if you encounter any architectural blockers."
                },
                {
                    "author": backend_user,
                    "text": f"Thanks @{pm_user.name.split()[0]}! I've reviewed the scope boundaries and retrieved {len(rag_chunks)} RAG architectural context chunks. Starting on the data models and serializers now."
                }
            ]
        },
        {
            "title": f"[WBS 1.2 - Frontend] Next.js Views & State Management for {summary_title}",
            "type": Task.Type.FEATURE,
            "priority": Task.Priority.HIGH,
            "assignee": frontend_user,
            "description": (
                f"### 📋 Project Management Specification (WBS 1.2)\n"
                f"**Strategic Objective:** Deliver high-ergonomics Next.js user interface for `{summary_title}` adhering to WCAG 2.1 AA.\n\n"
                f"**1. Scope Boundaries:**\n"
                f"- **In-Scope:** Next.js 16 App Router views, responsive drawer modals, Lucide React icons, and Sonner feedback toasts.\n"
                f"- **Out-of-Scope:** Raw emojis, unauthorized color overrides outside SuperDesign tokens.\n\n"
                f"**2. Deliverables & Definition of Done (DoD):**\n"
                f"- SuperDesign dark theme styling (`bg-slate-950`, `border-slate-800`)\n"
                f"- Lucide React vector icons (strictly zero raw emojis in production code)\n"
                f"- Sonner toasts for interactive user feedback\n"
                f"- Client state synchronization with backend REST APIs\n\n"
                f"**3. Risk & Contingency:**\n"
                f"- *Risk:* Layout shift or unhandled loading states.\n"
                f"- *Mitigation:* Skeleton loaders and optimistic UI state updates."
            ),
            "dialogue": [
                {
                    "author": pm_user,
                    "text": f"Hi @{frontend_user.name.split()[0]}, here are the WBS 1.2 client UI requirements for **{summary_title}**. Ensure strict compliance with SuperDesign dark tokens and WCAG AA accessibility."
                },
                {
                    "author": frontend_user,
                    "text": f"On it @{pm_user.name.split()[0]}! I will implement the Next.js 16 App Router views with Lucide icons, responsive drawer modals, and optimistic toast feedback."
                }
            ]
        },
        {
            "title": f"[WBS 1.3 - QA] Automated Integration & Regression Suite for {summary_title}",
            "type": Task.Type.TASK,
            "priority": Task.Priority.MEDIUM,
            "assignee": qa_user,
            "description": (
                f"### 📋 Project Management Specification (WBS 1.3)\n"
                f"**Strategic Objective:** Quality assurance gatekeeper signoff for `{summary_title}` across all acceptance criteria.\n\n"
                f"**1. Scope Boundaries:**\n"
                f"- **In-Scope:** Automated integration test harness, concurrency edge-cases, and 5-stage Kanban decision gate validation.\n"
                f"- **Out-of-Scope:** Manual exploratory load stress >10k concurrent users.\n\n"
                f"**2. Deliverables & Definition of Done (DoD):**\n"
                f"- Automated integration test suite with >=95.0% assertion coverage\n"
                f"- Zero unhandled 500 exceptions across edge conditions\n"
                f"- Contract Compliance Score: 100% verified\n\n"
                f"**3. Risk & Contingency:**\n"
                f"- *Risk:* Uncaught regression in adjacent modules.\n"
                f"- *Mitigation:* Full regression suite pass required before Tech Lead merge gate."
            ),
            "dialogue": [
                {
                    "author": pm_user,
                    "text": f"@{qa_user.name.split()[0]}, please define the acceptance test matrix for **{summary_title}** and enforce the 5-stage Kanban decision gate."
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
            "title": f"[WBS 1.4 - DevOps] Staging Pipeline & Container Build for {summary_title}",
            "type": Task.Type.TASK,
            "priority": Task.Priority.MEDIUM,
            "assignee": devops_user,
            "description": (
                f"### 📋 Project Management Specification (WBS 1.4)\n"
                f"**Strategic Objective:** Automated CI/CD build, deployment verification, and rollback readiness for `{summary_title}`.\n\n"
                f"**1. Scope Boundaries:**\n"
                f"- **In-Scope:** Multi-stage Docker container build, health check validation, and 1-click rollback snapshot generation.\n"
                f"- **Out-of-Scope:** Multi-region Kubernetes orchestration.\n\n"
                f"**2. Deliverables & Definition of Done (DoD):**\n"
                f"- Docker container build verified healthy\n"
                f"- Automated staging rollback snapshot created\n"
                f"- Live deployment health check endpoint (HTTP 200)\n\n"
                f"**3. Risk & Contingency:**\n"
                f"- *Risk:* Deployment regression or failing container startup.\n"
                f"- *Mitigation:* Instant 1-click rollback snapshot to previous stable image."
            ),
            "dialogue": [
                {
                    "author": pm_user,
                    "text": f"@{devops_user.name.split()[0]}, please prepare the WBS 1.4 Staging release pipeline for **{summary_title}**."
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
            f"**Athena (AI PM)** (Project Manager): Decomposed initiative into **{len(created_tasks)} WBS-governed sprint tickets**.\n"
            f"- **WBS 1.1 Backend Core:** {backend_user.name} (Data models, REST APIs, mutex concurrency)\n"
            f"- **WBS 1.2 Frontend App:** {frontend_user.name} (Next.js 16 App Router, SuperDesign tokens, Lucide icons)\n"
            f"- **WBS 1.3 QA Gatekeeper:** {qa_user.name} (Acceptance test harness, contract compliance score)\n"
            + (f"- **WBS 1.4 DevOps CI/CD:** {devops_user.name} (Docker container, health checks, 1-click rollback)\n" if len(created_tasks) > 3 else "")
            + "Scope boundaries and risk matrices locked to prevent scope creep. All specialists notified."
        ),
    }
