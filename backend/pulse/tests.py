from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from organizations.models import Organization
from projects.models import Project
from tasks.models import Task

from .models import PulseFocusSession, PulseNote

User = get_user_model()


class PulseAPITests(APITestCase):
    selected_date = "2026-08-27"

    def setUp(self):
        self.organization = Organization.objects.create(name="Pulse Organization")
        self.user = User.objects.create_user(
            email="pulse@teamflow.dev",
            password="pulse-password-123",
            role=User.Role.ADMIN,
            organization=self.organization,
        )
        self.project = Project.objects.create(
            name="Pulse Project",
            owner=self.user,
            organization=self.organization,
        )
        self.task = Task.objects.create(
            project=self.project,
            title="Ship Pulse cockpit",
            assignee=self.user,
            created_by=self.user,
            organization=self.organization,
        )
        token = self.client.post(
            "/api/auth/login/",
            {"email": self.user.email, "password": "pulse-password-123"},
            format="json",
        ).data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_daily_plan_dashboard_and_private_note_flow(self):
        created = self.client.post(
            "/api/pulse/plan-items/",
            {
                "task": self.task.id,
                "date": self.selected_date,
                "time_block": "morning",
                "position": 0,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)

        dashboard = self.client.get(f"/api/pulse/dashboard/?date={self.selected_date}")
        self.assertEqual(dashboard.status_code, 200, dashboard.content)
        self.assertEqual(dashboard.data["summary"]["planned"], 1)
        self.assertEqual(dashboard.data["plan_items"][0]["task_title"], self.task.title)

        note = self.client.put(
            f"/api/pulse/note/?date={self.selected_date}",
            {"body": "Keep the first focus block interruption-free."},
            format="json",
        )
        self.assertEqual(note.status_code, 200, note.content)
        self.assertEqual(PulseNote.objects.get(user=self.user, date=self.selected_date).body, note.data["body"])

    def test_focus_session_lifecycle_prevents_duplicates(self):
        plan_item = self.client.post(
            "/api/pulse/plan-items/",
            {"task": self.task.id, "date": self.selected_date, "time_block": "afternoon"},
            format="json",
        ).data
        started = self.client.post(
            "/api/pulse/focus-sessions/start/",
            {"plan_item": plan_item["id"]},
            format="json",
        )
        self.assertEqual(started.status_code, 201, started.content)
        self.assertEqual(started.data["status"], PulseFocusSession.Status.ACTIVE)

        duplicate = self.client.post("/api/pulse/focus-sessions/start/", format="json")
        self.assertEqual(duplicate.status_code, 409, duplicate.content)

        paused = self.client.post(f"/api/pulse/focus-sessions/{started.data['id']}/pause/", format="json")
        self.assertEqual(paused.status_code, 200, paused.content)
        self.assertEqual(paused.data["status"], PulseFocusSession.Status.PAUSED)

        resumed = self.client.post(f"/api/pulse/focus-sessions/{started.data['id']}/resume/", format="json")
        self.assertEqual(resumed.status_code, 200, resumed.content)
        completed = self.client.post(f"/api/pulse/focus-sessions/{started.data['id']}/complete/", format="json")
        self.assertEqual(completed.status_code, 200, completed.content)
        self.assertEqual(completed.data["status"], PulseFocusSession.Status.COMPLETED)

    def test_user_cannot_plan_a_foreign_workspace_task_or_read_private_note(self):
        foreign_organization = Organization.objects.create(name="Foreign Pulse Organization")
        foreign_user = User.objects.create_user(
            email="foreign@teamflow.dev",
            password="foreign-password-123",
            role=User.Role.ADMIN,
            organization=foreign_organization,
        )
        foreign_project = Project.objects.create(
            name="Foreign Project",
            owner=foreign_user,
            organization=foreign_organization,
        )
        foreign_task = Task.objects.create(
            project=foreign_project,
            title="Foreign task",
            organization=foreign_organization,
        )

        rejected = self.client.post(
            "/api/pulse/plan-items/",
            {"task": foreign_task.id, "date": self.selected_date, "time_block": "morning"},
            format="json",
        )
        self.assertEqual(rejected.status_code, 400, rejected.content)

        PulseNote.objects.create(
            user=self.user,
            organization=self.organization,
            date=self.selected_date,
            body="Only the original user may read this.",
        )
        colleague = User.objects.create_user(
            email="colleague@teamflow.dev",
            password="colleague-password-123",
            role=User.Role.MEMBER,
            organization=self.organization,
        )
        colleague_token = self.client.post(
            "/api/auth/login/",
            {"email": colleague.email, "password": "colleague-password-123"},
            format="json",
        ).data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {colleague_token}")
        note = self.client.get(f"/api/pulse/note/?date={self.selected_date}")
        self.assertEqual(note.status_code, 200, note.content)
        self.assertEqual(note.data["body"], "")
