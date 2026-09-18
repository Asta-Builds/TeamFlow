"""
Domain Event Subscribers (Observer Pattern Implementation).
Decouples side-effects (Audit Activity Logging, Notifications, and Agent Triggers)
from primary state changes and business logic.
"""

import logging
from typing import List
from django.db import transaction

from .events import (
    TaskCreatedEvent,
    TaskStatusChangedEvent,
    TaskAssignedEvent,
    TaskCommentAddedEvent,
    TaskQAValidatedEvent,
    TaskQARejectedEvent,
)
from tasks.models import Task, TaskActivity
from notifications.models import Notification
from accounts.models import User

logger = logging.getLogger(__name__)


def handle_task_created(event: TaskCreatedEvent) -> None:
    """Log creation activity and notify assignee if specified."""
    try:
        task = Task.objects.select_related("assignee", "project", "organization").get(id=event.task_id)
        actor = User.objects.get(id=event.actor_id) if event.actor_id else None

        TaskActivity.objects.create(
            task=task,
            actor=actor,
            action="created",
            details={"title": task.title, "status": task.status},
        )

        if task.assignee and task.assignee != actor:
            Notification.objects.create(
                recipient=task.assignee,
                actor=actor,
                title=f"Ticket assigned: {task.title}",
                message=f"{(actor.name if actor else '') or 'A user'} assigned you to ticket '{task.title}'.",
                link=f"/projects/{task.project_id}",
                organization=task.organization,
            )
    except Exception as exc:
        logger.error(f"Failed handling TaskCreatedEvent for task {event.task_id}: {exc}", exc_info=True)


def handle_task_status_changed(event: TaskStatusChangedEvent) -> None:
    """Audit status changes and broadcast notifications using bulk_create (eliminating N+1 hits)."""
    try:
        task = Task.objects.select_related("project", "organization", "created_by").get(id=event.task_id)
        actor = User.objects.get(id=event.actor_id) if event.actor_id else None

        TaskActivity.objects.create(
            task=task,
            actor=actor,
            action="status_changed",
            details={"from": event.from_status, "to": event.to_status},
        )

        # Batch notifications to prevent N+1 queries across organization specialists
        notifications_to_create: List[Notification] = []

        if event.to_status == Task.Status.QA and task.organization:
            # Batch notification for all QA engineers in the organization
            qa_engineers = User.objects.filter(organization=task.organization, role=User.Role.QA).exclude(id=event.actor_id)
            for qa_user in qa_engineers:
                notifications_to_create.append(
                    Notification(
                        recipient=qa_user,
                        actor=actor,
                        title=f"Ticket ready for QA: {task.title}",
                        message=f"Ticket '{task.title}' moved to QA for review.",
                        link=f"/projects/{task.project_id}",
                        organization=task.organization,
                    )
                )

        elif event.to_status == Task.Status.DONE and task.created_by and task.created_by != actor:
            notifications_to_create.append(
                Notification(
                    recipient=task.created_by,
                    actor=actor,
                    title=f"Ticket completed: {task.title}",
                    message=f"Ticket '{task.title}' was marked as Done.",
                    link=f"/projects/{task.project_id}",
                    organization=task.organization,
                )
            )

        if notifications_to_create:
            Notification.objects.bulk_create(notifications_to_create)

    except Exception as exc:
        logger.error(f"Failed handling TaskStatusChangedEvent for task {event.task_id}: {exc}", exc_info=True)


def handle_task_qa_validated(event: TaskQAValidatedEvent) -> None:
    """Audit QA validation and notify assignee."""
    try:
        task = Task.objects.select_related("assignee", "project", "organization").get(id=event.task_id)
        actor = User.objects.get(id=event.actor_id) if event.actor_id else None

        TaskActivity.objects.create(
            task=task,
            actor=actor,
            action="qa_validated",
            details={"note": "QA passed and ticket closed", "contract_compliance_score": event.contract_compliance_score},
        )

        if task.assignee and task.assignee != actor:
            Notification.objects.create(
                recipient=task.assignee,
                actor=actor,
                title=f"QA Approved: {task.title}",
                message=f"QA verified ticket '{task.title}'. Ticket is now Done.",
                link=f"/projects/{task.project_id}",
                organization=task.organization,
            )
    except Exception as exc:
        logger.error(f"Failed handling TaskQAValidatedEvent for task {event.task_id}: {exc}", exc_info=True)


def handle_task_qa_rejected(event: TaskQARejectedEvent) -> None:
    """Audit QA rejection and notify assignee."""
    try:
        task = Task.objects.select_related("assignee", "project", "organization").get(id=event.task_id)
        actor = User.objects.get(id=event.actor_id) if event.actor_id else None

        TaskActivity.objects.create(
            task=task,
            actor=actor,
            action="qa_rejected",
            details={"reason": event.reason},
        )

        if task.assignee and task.assignee != actor:
            Notification.objects.create(
                recipient=task.assignee,
                actor=actor,
                title=f"QA Rejected: {task.title}",
                message=f"Ticket '{task.title}' failed QA review: {event.reason}",
                link=f"/projects/{task.project_id}",
                organization=task.organization,
            )
    except Exception as exc:
        logger.error(f"Failed handling TaskQARejectedEvent for task {event.task_id}: {exc}", exc_info=True)


def handle_domain_event_outbox(event) -> None:
    """
    Transactional Outbox Subscriber:
    Serializes and persists domain events into OutboxMessage within the active transaction.
    This guarantees at-least-once message broker delivery without dual-write hazards.
    """
    try:
        from queues.service import RabbitMQService
        from dataclasses import asdict

        event_name = type(event).__name__
        # Map event classes to AMQP routing keys
        routing_key_map = {
            "TaskCreatedEvent": "task.created",
            "TaskStatusChangedEvent": "task.status.changed",
            "TaskAssignedEvent": "task.assigned",
            "TaskCommentAddedEvent": "task.comment.added",
            "TaskQAValidatedEvent": "task.qa.validated",
            "TaskQARejectedEvent": "task.qa.rejected",
        }
        routing_key = routing_key_map.get(event_name, "task.event")

        raw_payload = asdict(event) if hasattr(event, "__dataclass_fields__") else vars(event)
        from datetime import datetime, date
        import uuid

        clean_payload = {}
        for k, v in raw_payload.items():
            if isinstance(v, (datetime, date)):
                clean_payload[k] = v.isoformat()
            elif isinstance(v, uuid.UUID):
                clean_payload[k] = str(v)
            else:
                clean_payload[k] = v

        RabbitMQService.record_outbox_message(
            event_type=event_name,
            payload=clean_payload,
            routing_key=routing_key,
            exchange="teamflow.events",
            headers={"event_class": event_name},
        )
    except Exception as exc:
        logger.error(f"Failed writing domain event {type(event).__name__} to OutboxMessage: {exc}", exc_info=True)


def register_domain_subscribers(bus) -> None:
    """Register all domain subscribers to the given EventBus instance."""
    bus.subscribe(TaskCreatedEvent, handle_task_created)
    bus.subscribe(TaskStatusChangedEvent, handle_task_status_changed)
    bus.subscribe(TaskQAValidatedEvent, handle_task_qa_validated)
    bus.subscribe(TaskQARejectedEvent, handle_task_qa_rejected)

    # Register Transactional Outbox subscriber for all core domain events
    bus.subscribe(TaskCreatedEvent, handle_domain_event_outbox)
    bus.subscribe(TaskStatusChangedEvent, handle_domain_event_outbox)
    bus.subscribe(TaskQAValidatedEvent, handle_domain_event_outbox)
    bus.subscribe(TaskQARejectedEvent, handle_domain_event_outbox)

