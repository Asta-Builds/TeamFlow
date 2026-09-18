"""
Strongly Typed Domain Events for Task Lifecycle.
Part of the Observer / Event-Driven architecture decoupling core domain
transactions from asynchronous downstream side-effects.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Sequence


@dataclass(frozen=True)
class DomainEvent:
    """Base immutable domain event timestamped in UTC."""
    occurred_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass(frozen=True)
class TaskCreatedEvent(DomainEvent):
    task_id: int = 0
    project_id: int = 0
    actor_id: int = 0
    title: str = ""
    status: str = "todo"
    assignee_id: Optional[int] = None
    organization_id: Optional[int] = None


@dataclass(frozen=True)
class TaskStatusChangedEvent(DomainEvent):
    task_id: int = 0
    project_id: int = 0
    actor_id: int = 0
    from_status: str = ""
    to_status: str = ""
    organization_id: Optional[int] = None


@dataclass(frozen=True)
class TaskAssignedEvent(DomainEvent):
    task_id: int = 0
    project_id: int = 0
    actor_id: int = 0
    assignee_id: Optional[int] = None
    old_assignee_id: Optional[int] = None
    organization_id: Optional[int] = None


@dataclass(frozen=True)
class TaskCommentAddedEvent(DomainEvent):
    task_id: int = 0
    comment_id: int = 0
    actor_id: int = 0
    body: str = ""
    organization_id: Optional[int] = None
    has_agent_prompt: bool = False


@dataclass(frozen=True)
class TaskQAValidatedEvent(DomainEvent):
    task_id: int = 0
    project_id: int = 0
    actor_id: int = 0
    contract_compliance_score: float = 100.0
    organization_id: Optional[int] = None


@dataclass(frozen=True)
class TaskQARejectedEvent(DomainEvent):
    task_id: int = 0
    project_id: int = 0
    actor_id: int = 0
    reason: str = ""
    organization_id: Optional[int] = None
