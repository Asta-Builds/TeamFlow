"""
Typed Domain Exceptions for Tasks & Kanban Lifecycle.
Adheres to Fail-Fast resilience principles with explicit domain context.
"""

from typing import Optional


class TaskDomainError(Exception):
    """Base exception for all Task domain rule violations."""
    def __init__(self, message: str, code: str = "task_domain_error"):
        super().__init__(message)
        self.message = message
        self.code = code


class InvalidStateTransitionError(TaskDomainError):
    """Raised when an illegal Kanban status transition is attempted."""
    def __init__(self, current_status: str, target_status: str, reason: Optional[str] = None):
        detail = f"Cannot transition task from '{current_status}' to '{target_status}'."
        if reason:
            detail += f" Reason: {reason}"
        super().__init__(detail, code="invalid_state_transition")
        self.current_status = current_status
        self.target_status = target_status


class UnauthorizedTransitionError(TaskDomainError):
    """Raised when a user lacks privileges for a restricted state gate."""
    def __init__(self, user_role: str, gate_name: str):
        super().__init__(
            f"Role '{user_role}' is not authorized to execute gate '{gate_name}'.",
            code="unauthorized_transition"
        )
        self.user_role = user_role
        self.gate_name = gate_name


class RejectionExplanationMissingError(TaskDomainError):
    """Raised when a QA rejection is attempted without a mandatory explanation."""
    def __init__(self):
        super().__init__(
            "A non-empty rejection explanation is mandatory when rejecting QA.",
            code="rejection_explanation_missing"
        )
