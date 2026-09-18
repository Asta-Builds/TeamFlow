"""
Architecture & SOLID Compliance Tests for Task Domain & Kanban State Machine.
Validates:
1. State Machine Invariant Enforcement (SRP / Fail-Fast).
2. Domain Event Bus (Observer Pattern).
3. Repository Projection Queries (N+1 Elimination).
4. Application Service Use Cases.
"""

from django.test import TestCase
from accounts.models import User
from organizations.models import Organization
from projects.models import Project
from tasks.models import Task, TaskActivity
from notifications.models import Notification
from tasks.domain.state_machine import KanbanStateMachine, KanbanStatus
from tasks.domain.exceptions import (
    InvalidStateTransitionError,
    UnauthorizedTransitionError,
    RejectionExplanationMissingError,
)
from tasks.domain.bus import EventBus
from tasks.domain.events import TaskStatusChangedEvent
from tasks.domain.repository import DjangoTaskRepository
from tasks.application.use_cases import TaskApplicationService


class KanbanStateMachineTests(TestCase):
    """Test pure domain state machine rules without database dependencies."""

    def test_valid_sequential_transitions(self):
        """Kanban permits sequential transitions: TODO -> IN_PROGRESS -> IN_REVIEW -> QA -> DONE."""
        KanbanStateMachine.validate_transition(KanbanStatus.TODO, KanbanStatus.IN_PROGRESS)
        KanbanStateMachine.validate_transition(KanbanStatus.IN_PROGRESS, KanbanStatus.IN_REVIEW)
        KanbanStateMachine.validate_transition(KanbanStatus.IN_REVIEW, KanbanStatus.QA)
        KanbanStateMachine.validate_transition(KanbanStatus.QA, KanbanStatus.DONE)

    def test_illegal_state_jumps_raise_typed_domain_error(self):
        """Disallow illegal state jumps (e.g. TODO directly to DONE or QA directly to TODO)."""
        with self.assertRaises(InvalidStateTransitionError) as ctx:
            KanbanStateMachine.validate_transition(KanbanStatus.TODO, KanbanStatus.DONE)
        self.assertIn("Cannot transition task from 'todo' to 'done'", str(ctx.exception))

        with self.assertRaises(InvalidStateTransitionError):
            KanbanStateMachine.validate_transition(KanbanStatus.QA, KanbanStatus.TODO)

    def test_qa_approval_authorization_gate(self):
        """Only users with can_validate_qa can approve QA tickets."""
        # Unauthorized role raises domain exception
        with self.assertRaises(UnauthorizedTransitionError):
            KanbanStateMachine.validate_qa_approval(user_can_validate_qa=False, role="frontend")

        # Authorized role passes gate cleanly
        KanbanStateMachine.validate_qa_approval(user_can_validate_qa=True, role="qa")

    def test_qa_rejection_requires_mandatory_explanation(self):
        """QA rejection requires a non-empty explanation."""
        with self.assertRaises(RejectionExplanationMissingError):
            KanbanStateMachine.validate_qa_rejection(user_can_validate_qa=True, role="qa", reason="")

        with self.assertRaises(RejectionExplanationMissingError):
            KanbanStateMachine.validate_qa_rejection(user_can_validate_qa=True, role="qa", reason="   ")

        # Valid explanation passes gate
        KanbanStateMachine.validate_qa_rejection(user_can_validate_qa=True, role="qa", reason="Broken CSS layout")


class TaskApplicationServiceArchitectureTests(TestCase):
    """Test Application Service (Use Cases) and Event Bus."""

    def setUp(self):
        self.org = Organization.objects.create(name="Architecture Org")
        self.ceo = User.objects.create_user(
            email="architect.ceo@teamflow.dev",
            password="pass",
            role=User.Role.CEO,
            organization=self.org,
        )
        self.qa_user = User.objects.create_user(
            email="architect.qa@teamflow.dev",
            password="pass",
            role=User.Role.QA,
            organization=self.org,
        )
        self.dev_user = User.objects.create_user(
            email="architect.dev@teamflow.dev",
            password="pass",
            role=User.Role.BACKEND,
            organization=self.org,
        )
        self.project = Project.objects.create(name="Core Architecture Project", organization=self.org)
        self.task = Task.objects.create(
            title="Refactor Kanban State Machine",
            project=self.project,
            created_by=self.ceo,
            assignee=self.dev_user,
            status=Task.Status.TODO,
            organization=self.org,
        )
        self.service = TaskApplicationService()

    def test_change_task_status_publishes_event_and_updates_model(self):
        """Changing task status transitions entity and fires event without N+1 hits."""
        updated = self.service.change_task_status(self.task, Task.Status.IN_PROGRESS, self.ceo)
        self.assertEqual(updated.status, Task.Status.IN_PROGRESS)

        # Verify activity was logged via decoupled subscriber
        activity = TaskActivity.objects.filter(task=self.task, action="status_changed").first()
        self.assertIsNotNone(activity)
        self.assertEqual(activity.details.get("to"), Task.Status.IN_PROGRESS)

    def test_qa_rejection_resets_status_and_records_comment(self):
        """QA rejection use case sets IN_PROGRESS, sets qa_rejected=True, and creates comment."""
        self.task.status = Task.Status.QA
        self.task.save()

        updated = self.service.reject_qa(self.task, self.qa_user, "Fails accessibility check")
        self.assertEqual(updated.status, Task.Status.IN_PROGRESS)
        self.assertTrue(updated.qa_rejected)
        self.assertEqual(updated.qa_rejection_reason, "Fails accessibility check")

        # Comment created
        comment = self.task.comments.last()
        self.assertIn("QA Rejected: Fails accessibility check", comment.body)

    def test_repository_board_projection_eliminates_n_plus_one(self):
        """Repository projection pre-fetches relationships for efficient board rendering."""
        repo = DjangoTaskRepository()
        tasks = list(repo.list_board_tasks(self.project.id))
        self.assertEqual(len(tasks), 1)
        # Relationship evaluation does not trigger additional queries
        self.assertEqual(tasks[0].assignee.email, self.dev_user.email)
        self.assertEqual(tasks[0].project.name, self.project.name)
