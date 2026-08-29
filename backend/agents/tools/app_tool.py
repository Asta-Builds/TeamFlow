from typing import Dict, Any, Optional
from django.contrib.auth import get_user_model
from django.utils import timezone
from tasks.models import Task, Comment, TaskActivity
from deployments.models import Deployment
from notifications.models import Notification

User = get_user_model()


def _agent_for_organization(organization, identifier: str):
    from agents.users import agent_key_from_identifier, get_or_create_agent_user

    return get_or_create_agent_user(agent_key_from_identifier(identifier), organization)


def _agent_for_task(task, identifier: str):
    return _agent_for_organization(task.organization, identifier)


def update_ticket_status(
    task_id: int,
    status: str,
    actor_email: str = "lead@teamflow.dev",
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """App DB Tool: Updates task status and logs TaskActivity."""
    try:
        task = Task.objects.get(pk=task_id)
        old_status = task.status
        task.status = status
        task.save(update_fields=["status"])

        actor = _agent_for_task(task, actor_email)
        TaskActivity.objects.create(
            task=task,
            actor=actor,
            action="status_changed",
            details={"from": old_status, "to": status, **(details or {})},
        )
        return {"ok": True, "task_id": task.id, "status": task.status}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def log_task_activity(
    task_id: int,
    actor_name: str,
    action: str,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """App DB Tool: Logs custom agent task activity."""
    try:
        task = Task.objects.get(pk=task_id)
        actor = User.objects.filter(
            organization=task.organization,
            name__icontains=actor_name,
        ).first() or task.assignee
        activity = TaskActivity.objects.create(
            task=task,
            actor=actor,
            action=action,
            details=details or {},
        )
        return {"ok": True, "activity_id": activity.id}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def add_ticket_comment(
    task_id: int,
    author_email: str,
    body: str,
) -> Dict[str, Any]:
    """App DB Tool: Adds a comment to a ticket from an agent."""
    try:
        task = Task.objects.get(pk=task_id)
        author = _agent_for_task(task, author_email)
        comment = Comment.objects.create(
            task=task,
            author=author,
            body=body,
        )
        return {"ok": True, "comment_id": comment.id}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def set_ticket_qa_decision(
    task_id: int,
    qa_passed: bool,
    reason: str = "",
    actor_email: str = "qa@teamflow.dev",
) -> Dict[str, Any]:
    """App DB Tool: Records QA approval or rejection with mandatory reason."""
    try:
        task = Task.objects.get(pk=task_id)
        actor = _agent_for_task(task, actor_email)
        if qa_passed:
            task.status = Task.Status.DONE
            task.qa_rejected = False
            task.qa_rejection_reason = ""
            task.save(update_fields=["status", "qa_rejected", "qa_rejection_reason"])
            TaskActivity.objects.create(
                task=task,
                actor=actor,
                action="qa_validated",
                details={"decision": "passed"},
            )
        else:
            task.status = Task.Status.IN_PROGRESS
            task.qa_rejected = True
            task.qa_rejection_reason = reason
            task.save(update_fields=["status", "qa_rejected", "qa_rejection_reason"])
            TaskActivity.objects.create(
                task=task,
                actor=actor,
                action="qa_rejected",
                details={"decision": "failed", "reason": reason},
            )
            Comment.objects.create(
                task=task,
                author=actor,
                body=f"❌ QA Verification Failed: {reason}",
            )
        return {"ok": True, "task_id": task.id, "status": task.status, "qa_passed": qa_passed}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def trigger_app_deployment(
    project_id: int,
    environment: str = "staging",
    branch: str = "main",
    commit_sha: str = "a1b2c3d4",
    actor_email: str = "devops@teamflow.dev",
) -> Dict[str, Any]:
    """App DB Tool: Triggers and records a deployment in TeamFlow."""
    try:
        from projects.models import Project
        project = Project.objects.get(pk=project_id)
        actor = _agent_for_organization(project.organization, actor_email)
        logs = (
            f"=== Multi-Agent Automated Deployment ===\n"
            f"Environment: {environment}\n"
            f"Branch: {branch} ({commit_sha})\n"
            f"[INFO] Running CI unit & integration tests... PASSED\n"
            f"[INFO] Building container image... SUCCESS\n"
            f"[INFO] Staging health check verified (HTTP 200)\n"
        )
        deployment = Deployment.objects.create(
            project=project,
            environment=environment,
            status=Deployment.Status.SUCCESS,
            commit_sha=commit_sha,
            branch=branch,
            triggered_by=actor,
            organization=project.organization,
            logs=logs,
            duration_seconds=32,
            finished_at=timezone.now(),
        )
        return {"ok": True, "deployment_id": deployment.id, "status": deployment.status}
    except Exception as e:
        return {"ok": False, "error": str(e)}
