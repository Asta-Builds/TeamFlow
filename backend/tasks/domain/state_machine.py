"""
Kanban State Machine Pattern.
Encapsulates all 5-stage Kanban review gate rules and invariants:
TODO -> IN_PROGRESS -> IN_REVIEW -> QA -> DONE
Prevents illegal state jumps and enforces QA validation invariants.
"""

from typing import Dict, FrozenSet, Set
from .exceptions import (
    InvalidStateTransitionError,
    UnauthorizedTransitionError,
    RejectionExplanationMissingError,
)


class KanbanStatus:
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    IN_REVIEW = "in_review"
    QA = "qa"
    DONE = "done"

    ALL_STATUSES = {TODO, IN_PROGRESS, IN_REVIEW, QA, DONE}


class KanbanStateMachine:
    """
    Strict State Machine governing Kanban ticket transitions.
    Enforces business invariants according to Section 3 of Virtual Tech Company Workspace Guidelines.
    """

    # Permitted directional state transitions
    _VALID_TRANSITIONS: Dict[str, FrozenSet[str]] = {
        KanbanStatus.TODO: frozenset({KanbanStatus.IN_PROGRESS}),
        KanbanStatus.IN_PROGRESS: frozenset({KanbanStatus.IN_REVIEW, KanbanStatus.TODO}),
        KanbanStatus.IN_REVIEW: frozenset({KanbanStatus.QA, KanbanStatus.IN_PROGRESS}),
        KanbanStatus.QA: frozenset({KanbanStatus.DONE, KanbanStatus.IN_PROGRESS}),
        KanbanStatus.DONE: frozenset({KanbanStatus.IN_PROGRESS}),  # Reopening a closed task
    }

    @classmethod
    def can_transition(cls, from_status: str, to_status: str) -> bool:
        if from_status == to_status:
            return True
        allowed = cls._VALID_TRANSITIONS.get(from_status, frozenset())
        return to_status in allowed

    @classmethod
    def validate_transition(cls, from_status: str, to_status: str) -> None:
        """Enforce transition validity or raise typed domain error."""
        if from_status == to_status:
            return
        if not cls.can_transition(from_status, to_status):
            allowed = sorted(list(cls._VALID_TRANSITIONS.get(from_status, frozenset())))
            raise InvalidStateTransitionError(
                current_status=from_status,
                target_status=to_status,
                reason=f"Permitted next states from '{from_status}' are: {allowed}"
            )

    @classmethod
    def validate_qa_approval(cls, user_can_validate_qa: bool, role: str) -> None:
        """Gate: Only QA Engineers, Tech Leads, or CEO can validate tickets to DONE."""
        if not user_can_validate_qa:
            raise UnauthorizedTransitionError(user_role=role, gate_name="QA Validation Approval")

    @classmethod
    def validate_qa_rejection(cls, user_can_validate_qa: bool, role: str, reason: str) -> None:
        """Gate: Rejection requires proper permissions and a mandatory reason."""
        if not user_can_validate_qa:
            raise UnauthorizedTransitionError(user_role=role, gate_name="QA Rejection")
        if not reason or not reason.strip():
            raise RejectionExplanationMissingError()
