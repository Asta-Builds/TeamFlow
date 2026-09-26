"""Release gate and human approval service for TeamFlow autonomous swarms."""

from __future__ import annotations

import logging
from django.db import transaction
from django.utils import timezone

from .events import emit_agent_event
from .release import current_branch_head
from .models import AgentExecutionTrace, ApprovalRequest
from tasks.models import Comment, Task

logger = logging.getLogger(__name__)


class ApprovalError(Exception):
    """Base exception for approval domain errors."""
    pass


class BranchResolutionError(ApprovalError):
    """Raised when the branch cannot be resolved or head SHA is empty."""
    pass


class ApprovalConflictError(ApprovalError):
    """Raised when deciding an approval that is not in pending status."""
    pass


def can_decide(user, organization) -> bool:
    """
    Check if a user may approve or reject releases.

    Allowed: humans with the 'ceo' or 'admin' role in the organization, or platform staff.
    Forbidden: AI agent seats (agent_key set), non-members, or members without ceo/admin.
    """
    if not user or not user.is_authenticated:
        return False
    if getattr(user, "agent_key", ""):
        return False
    if getattr(user, "is_ai_agent", False):
        return False
    if user.is_staff or user.is_superuser:
        return True
    if not organization:
        return False

    # Membership is the source of truth: the role cached on the user record can be stale
    # after a demotion, and must never decide who may release code.
    from organizations.models import Membership
    return Membership.objects.filter(
        user=user,
        organization=organization,
        status=Membership.Status.ACTIVE,
        role__in=[Membership.Role.OWNER, Membership.Role.ADMIN],
    ).exists()


def request_release_approval(
    task: Task,
    *,
    trace: AgentExecutionTrace | None = None,
    engine: str = "graph",
    branch: str,
    repo: str = "",
    pr_url: str = "",
) -> ApprovalRequest:
    """
    Create a release approval pinning the exact commit SHA of the branch.

    Refuses if current_branch_head cannot resolve a SHA.
    Marks prior pending approvals for this task as superseded.
    Emits the blocked confirmation event to the agent event stream.
    """
    head_sha = current_branch_head(task, branch)
    if not head_sha:
        raise BranchResolutionError(f"The branch '{branch}' could not be resolved in the workspace.")

    with transaction.atomic():
        ApprovalRequest.objects.filter(
            task=task,
            status=ApprovalRequest.Status.PENDING,
        ).update(status=ApprovalRequest.Status.SUPERSEDED)

        approval = ApprovalRequest.objects.create(
            organization=task.organization,
            task=task,
            trace=trace,
            kind=ApprovalRequest.Kind.RELEASE,
            status=ApprovalRequest.Status.PENDING,
            branch=branch,
            head_sha=head_sha,
            repo=repo or "",
            pr_url=pr_url or "",
            engine=engine,
        )

    short_sha = head_sha[:7] if head_sha else ""
    confirmation_title = f"Release #{task.id} to main"
    confirmation_description = (
        f"Merge {branch} at {short_sha} into main, then request a staging deployment."
    )
    metadata = {
        "requires_confirmation": True,
        "approval_id": approval.id,
        "tool_name": "release",
        "confirmation_title": confirmation_title,
        "confirmation_description": confirmation_description,
        "danger_level": "high",
        "requires_reason": False,
        "tool_args": {
            "branch": branch,
            "head_sha": head_sha,
            "repo": repo or "",
            "pr_url": pr_url or "",
        },
    }

    session_id = trace.session_id if trace else f"approval-task-{task.id}"
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=session_id,
        event_type="blocked",
        sender_key="devops",
        message="The release is waiting for approval by a workspace owner or admin.",
        current_work="Waiting for release approval",
        remaining_work=["human approval", "release to main", "staging deployment"],
        metadata=metadata,
    )

    return approval


def approve(approval: ApprovalRequest, user, reason: str = "") -> ApprovalRequest:
    """
    Approve an ApprovalRequest inside a transaction with select_for_update.

    Enqueues execute_release_approval on transaction commit.
    """
    with transaction.atomic():
        # Lock only the approval row: PostgreSQL cannot lock the nullable side of the trace join.
        locked = ApprovalRequest.objects.select_for_update(of=("self",)).select_related(
            "task",
            "task__project",
            "task__organization",
            "trace",
        ).get(pk=approval.id)

        if locked.status != ApprovalRequest.Status.PENDING:
            raise ApprovalConflictError(f"Approval #{locked.id} is {locked.status}, not pending.")

        locked.status = ApprovalRequest.Status.APPROVED
        locked.decided_at = timezone.now()
        locked.decided_by = user
        locked.decision_reason = reason or ""
        locked.save(update_fields=["status", "decided_at", "decided_by", "decision_reason"])

        name = user.name or user.email
        session_id = locked.trace.session_id if locked.trace else f"approval-task-{locked.task_id}"
        emit_agent_event(
            task=locked.task,
            trace=locked.trace,
            session_id=session_id,
            event_type="progress",
            sender_key="devops",
            message=f"{name} approved the release; merging now.",
            current_work="Enqueuing release execution",
            remaining_work=["execute release"],
            metadata={"approval_id": locked.id, "decision": "approved", "reason": reason or ""},
        )

        from .tasks import execute_release_approval
        transaction.on_commit(lambda: execute_release_approval.delay(locked.id))

    return locked


def reject(approval: ApprovalRequest, user, reason: str) -> ApprovalRequest:
    """
    Reject an ApprovalRequest inside a transaction with select_for_update.

    Leaves the ticket in qa, posts a comment naming the rejecter and reason.
    """
    clean_reason = (reason or "").strip()
    if not clean_reason:
        raise ValueError("A non-empty rejection reason is required.")

    with transaction.atomic():
        # Lock only the approval row: PostgreSQL cannot lock the nullable side of the trace join.
        locked = ApprovalRequest.objects.select_for_update(of=("self",)).select_related(
            "task",
            "task__project",
            "task__organization",
            "trace",
        ).get(pk=approval.id)

        if locked.status != ApprovalRequest.Status.PENDING:
            raise ApprovalConflictError(f"Approval #{locked.id} is {locked.status}, not pending.")

        locked.status = ApprovalRequest.Status.REJECTED
        locked.decided_at = timezone.now()
        locked.decided_by = user
        locked.decision_reason = clean_reason
        locked.save(update_fields=["status", "decided_at", "decided_by", "decision_reason"])

        name = user.name or user.email
        comment_body = (
            f"**Release rejected by {name}:**\n\n"
            f"{clean_reason}\n\n"
            f"The ticket remains in QA."
        )
        Comment.objects.create(task=locked.task, author=user, body=comment_body)

        session_id = locked.trace.session_id if locked.trace else f"approval-task-{locked.task_id}"
        emit_agent_event(
            task=locked.task,
            trace=locked.trace,
            session_id=session_id,
            event_type="blocked",
            sender_key="devops",
            message=f"{name} rejected the release: {clean_reason}",
            current_work="Release rejected",
            remaining_work=[],
            metadata={"approval_id": locked.id, "decision": "rejected", "reason": clean_reason},
        )

    return locked
