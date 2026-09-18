"""
Application Use Cases for Task Management.
Coordinates Domain State Machine, Repository Data Access, and Event Bus.
Decouples business orchestration from the HTTP / REST transport layer.
"""

from typing import Optional, Dict, Any
from django.db import transaction

from tasks.domain.state_machine import KanbanStateMachine, KanbanStatus
from tasks.domain.repository import TaskRepositoryInterface, DjangoTaskRepository
from tasks.domain.bus import EventBus, default_event_bus
from tasks.domain.events import (
    TaskCreatedEvent,
    TaskStatusChangedEvent,
    TaskQAValidatedEvent,
    TaskQARejectedEvent,
)
from tasks.models import Task, Comment


class TaskApplicationService:
    """
    Application Service (Use Case Orchestrator).
    Manages Unit of Work boundaries and dispatches domain events.
    """

    def __init__(
        self,
        repository: Optional[TaskRepositoryInterface] = None,
        event_bus: Optional[EventBus] = None,
    ):
        self.repository = repository or DjangoTaskRepository()
        self.event_bus = event_bus or default_event_bus

    @transaction.atomic
    def change_task_status(
        self,
        task: Task,
        target_status: str,
        actor,
    ) -> Task:
        """
        Transition task status across Kanban decision gates.
        Enforces state machine invariants and dispatches TaskStatusChangedEvent.
        """
        old_status = task.status
        if old_status == target_status:
            return task

        # Enforce state machine rules
        KanbanStateMachine.validate_transition(old_status, target_status)

        task.status = target_status
        task.save(update_fields=["status", "updated_at"])

        # Dispatch domain event (Observer pattern)
        self.event_bus.dispatch(
            TaskStatusChangedEvent(
                task_id=task.id,
                project_id=task.project_id,
                actor_id=actor.id if actor and actor.is_authenticated else 0,
                from_status=old_status,
                to_status=target_status,
                organization_id=task.organization_id,
            )
        )
        return task

    def transition_status(self, task: Task, target_status: str, actor=None) -> Task:
        """Convenience alias for change_task_status."""
        return self.change_task_status(task, target_status, actor)

    @transaction.atomic
    def validate_qa(self, task: Task, actor) -> Task:
        """
        Validate ticket in QA gate -> Transition to DONE.
        Enforces user privilege invariants and resets rejection markers.
        """
        KanbanStateMachine.validate_qa_approval(
            user_can_validate_qa=getattr(actor, "can_validate_qa", False),
            role=getattr(actor, "role", "unknown"),
        )

        task.status = Task.Status.DONE
        task.qa_rejected = False
        task.qa_rejection_reason = ""
        task.save(update_fields=["status", "qa_rejected", "qa_rejection_reason", "updated_at"])

        self.event_bus.dispatch(
            TaskQAValidatedEvent(
                task_id=task.id,
                project_id=task.project_id,
                actor_id=actor.id if actor and actor.is_authenticated else 0,
                contract_compliance_score=task.contract_compliance_score or 100.0,
                organization_id=task.organization_id,
            )
        )
        return task

    @transaction.atomic
    def reject_qa(self, task: Task, actor, reason: str) -> Task:
        """
        Reject ticket in QA gate -> Transition back to IN_PROGRESS.
        Enforces mandatory non-empty explanation and creates explanatory comment.
        """
        KanbanStateMachine.validate_qa_rejection(
            user_can_validate_qa=getattr(actor, "can_validate_qa", False),
            role=getattr(actor, "role", "unknown"),
            reason=reason,
        )

        task.status = Task.Status.IN_PROGRESS
        task.qa_rejected = True
        task.qa_rejection_reason = reason.strip()
        task.save(update_fields=["status", "qa_rejected", "qa_rejection_reason", "updated_at"])

        # Create explanatory comment record
        Comment.objects.create(
            task=task,
            author=actor if actor and actor.is_authenticated else None,
            body=f"QA Rejected: {reason.strip()}",
        )

        self.event_bus.dispatch(
            TaskQARejectedEvent(
                task_id=task.id,
                project_id=task.project_id,
                actor_id=actor.id if actor and actor.is_authenticated else 0,
                reason=reason.strip(),
                organization_id=task.organization_id,
            )
        )
        return task
