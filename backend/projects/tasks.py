from __future__ import annotations

import logging
from typing import Any, Optional

from celery import shared_task
from django.contrib.auth import get_user_model

from notifications.models import Notification
from projects.models import Project

logger = logging.getLogger(__name__)
User = get_user_model()


@shared_task(name="projects.tasks.provision_project_repository")
def provision_project_repository(
    project_id: int,
    user_id: Optional[int] = None,
    repo_name: Optional[str] = None,
    private: bool = False,
    org: Optional[str] = None,
    description: Optional[str] = None,
) -> dict[str, Any]:
    """
    Background Celery task to provision and bootstrap a remote GitHub repository
    for a project so that agent workspaces are written strictly by the worker.
    """
    try:
        project = Project.objects.select_related("organization", "owner").get(pk=project_id)
    except Project.DoesNotExist:
        logger.error("Cannot provision repository: Project #%s not found.", project_id)
        return {"ok": False, "error": f"Project #{project_id} not found."}

    user = None
    if user_id:
        user = User.objects.filter(pk=user_id).first()

    devops_user = None
    if project.organization:
        try:
            from agents.users import get_or_create_agent_user

            devops_user = get_or_create_agent_user("devops", project.organization)
        except Exception as exc:
            logger.warning("Could not get or create DevOps agent user: %s", exc)

    from agents.git_service import devops_create_project_repo

    try:
        result = devops_create_project_repo(
            project=project,
            user=user,
            repo_name=repo_name,
            private=private,
            org=org,
            description=description,
        )
    except Exception as exc:
        logger.exception("Exception during repository provisioning for Project #%s: %s", project.id, exc)
        result = {
            "ok": False,
            "error": str(exc),
            "status_code": 500,
        }

    recipient = user or project.owner
    first_task = project.tasks.first() if getattr(project, "tasks", None) else None

    if result.get("ok"):
        repo_full_name = result.get("full_name") or result.get("repo_name") or project.name
        if first_task:
            try:
                from tasks.models import TaskActivity

                TaskActivity.objects.create(
                    task=first_task,
                    actor=devops_user or user,
                    action="repo_provisioned",
                    details=result,
                )
            except Exception as exc:
                logger.warning("Could not create TaskActivity for repo provisioning: %s", exc)

        if recipient:
            try:
                Notification.objects.create(
                    recipient=recipient,
                    actor=devops_user or user,
                    title="GitHub repository provisioned",
                    message=f"Repository {repo_full_name} was provisioned and linked to {project.name}.",
                    link=f"/projects/{project.id}",
                    organization=project.organization,
                )
            except Exception as exc:
                logger.warning("Could not create Notification for repo provisioning: %s", exc)
    else:
        error_msg = result.get("error", "Failed to create remote repository on GitHub.")
        logger.error("Repository provisioning failed for Project #%s: %s", project.id, error_msg)

        if first_task:
            try:
                from tasks.models import TaskActivity

                TaskActivity.objects.create(
                    task=first_task,
                    actor=devops_user or user,
                    action="repo_provision_failed",
                    details=result,
                )
            except Exception as exc:
                logger.warning("Could not create TaskActivity for repo failure: %s", exc)

            try:
                from agents.events import emit_agent_event

                emit_agent_event(
                    task=first_task,
                    session_id=f"devops-repo-{project.id}",
                    sender_key="devops",
                    event_type="failed",
                    message=f"DevOps agent failed to provision GitHub repository: {error_msg}",
                    metadata={"error": error_msg},
                )
            except Exception as exc:
                logger.warning("Could not emit agent event for repo failure: %s", exc)

        if recipient:
            try:
                Notification.objects.create(
                    recipient=recipient,
                    actor=devops_user or user,
                    title="GitHub repository provisioning failed",
                    message=f"Failed to provision repository for {project.name}: {error_msg}",
                    link=f"/projects/{project.id}",
                    organization=project.organization,
                )
            except Exception as exc:
                logger.warning("Could not create failure Notification: %s", exc)

    return result
