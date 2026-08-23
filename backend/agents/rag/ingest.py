import os
from typing import List, Dict, Any
from django.conf import settings
from agents.models import CodebaseEmbedding
from projects.models import Project
from .embeddings import generate_embedding


SAMPLE_DOCS = [
    {
        "file_path": "docs/architecture/ADR-001-jwt-auth.md",
        "content": (
            "# ADR-001: JWT Authentication & Refresh Tokens\n"
            "Status: Accepted\n"
            "Context: The platform uses Django SimpleJWT for access/refresh token pairs.\n"
            "Decision: Endpoints /api/auth/login/, /api/auth/refresh/, /api/auth/me/. Keycloak SSO is supported on /api/auth/keycloak/."
        ),
        "metadata": {"type": "adr", "domain": "auth"},
    },
    {
        "file_path": "docs/architecture/ADR-002-kanban-qa-workflow.md",
        "content": (
            "# ADR-002: Kanban & QA Gate Workflow\n"
            "Status: Accepted\n"
            "Context: Tasks follow a 5-stage lifecycle: todo -> in_progress -> in_review -> qa -> done.\n"
            "Decision: QA validation moves ticket to done. QA rejection requires a mandatory reason, logs an activity record, and reverts status to in_progress."
        ),
        "metadata": {"type": "adr", "domain": "tasks"},
    },
    {
        "file_path": "backend/accounts/models.py",
        "content": (
            "User roles in TeamFlow: CEO, Tech Lead, Senior Backend, Senior Frontend, DevOps, QA, UI/UX Designer, SEO Specialist, Admin, Member.\n"
            "User permissions: is_privileged, can_create_project, can_deploy, can_audit_seo, can_validate_qa."
        ),
        "metadata": {"type": "code", "domain": "accounts"},
    },
    {
        "file_path": "frontend/src/lib/types.ts",
        "content": (
            "TypeScript interfaces: Task (id, title, description, status, task_type, priority, assignee, due_date, pr_url, qa_rejected, qa_rejection_reason, activities).\n"
            "Project (name, progress_percentage, task_count, done_task_count). Deployment (environment, status, branch, commit_sha, logs)."
        ),
        "metadata": {"type": "code", "domain": "frontend"},
    },
    {
        "file_path": "backend/deployments/models.py",
        "content": (
            "Deployment pipelines support staging and production environments with build logs, duration tracking, and 1-click rollback."
        ),
        "metadata": {"type": "code", "domain": "devops"},
    },
]


def ingest_sample_knowledge_base(project: Project = None) -> int:
    """Ingests baseline architectural docs, ADRs, and API patterns into pgvector."""
    count = 0
    for item in SAMPLE_DOCS:
        embedding_vec = generate_embedding(item["content"])
        CodebaseEmbedding.objects.update_or_create(
            file_path=item["file_path"],
            chunk_index=0,
            defaults={
                "project": project,
                "content": item["content"],
                "embedding": embedding_vec,
                "metadata": item.get("metadata", {}),
            }
        )
        count += 1
    return count
