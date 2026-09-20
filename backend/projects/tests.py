from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from agents.models import AgentEvent
from notifications.models import Notification
from organizations.models import Organization
from projects.models import Project
from projects.tasks import provision_project_repository
from tasks.models import Task, TaskActivity

User = get_user_model()


class ProjectWorkspaceValidationTests(APITestCase):
    def test_project_rejects_an_owner_from_another_workspace(self):
        organization = Organization.objects.create(name="Workspace A")
        admin = User.objects.create_user(
            email="admin@workspace-a.dev",
            password="password123",
            role=User.Role.ADMIN,
            organization=organization,
        )
        other_org = Organization.objects.create(name="Workspace B")
        outsider = User.objects.create_user(
            email="outsider@workspace-b.dev",
            password="password123",
            organization=other_org,
        )
        login = self.client.post(
            "/api/auth/login/", {"email": admin.email, "password": "password123"}, format="json"
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

        response = self.client.post(
            "/api/projects/", {"name": "Invalid owner", "owner": outsider.id}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("owner", response.data)


class ProjectDevOpsRepoCreationTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="DevOps Test Org")
        self.ceo = User.objects.create_user(
            email="ceo@devops.dev",
            password="password123",
            role=User.Role.CEO,
            organization=self.org,
        )
        self.project = Project.objects.create(
            name="Cloud Microservice",
            description="Autonomous cloud service",
            organization=self.org,
            owner=self.ceo,
        )
        login = self.client.post(
            "/api/auth/login/", {"email": self.ceo.email, "password": "password123"}, format="json"
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

    @patch("agents.git_service.devops_create_project_repo")
    @patch("projects.tasks.provision_project_repository.delay")
    @patch("agents.queue.is_worker_available", return_value=True)
    def test_devops_create_repo_enqueues_and_returns_202(self, _mock_worker, mock_delay, mock_git_create):
        res = self.client.post(
            f"/api/projects/{self.project.id}/devops_create_repo/",
            {
                "repo_name": "cloud-microservice",
                "private": True,
                "org": "Asta-Builds",
                "description": "Autonomous cloud service",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 202)
        self.assertTrue(res.data.get("ok"))
        self.assertEqual(res.data.get("status"), "queued")
        self.assertEqual(res.data.get("project_id"), self.project.id)

        mock_delay.assert_called_once_with(
            self.project.id,
            self.ceo.id,
            repo_name="cloud-microservice",
            private=True,
            org="Asta-Builds",
            description="Autonomous cloud service",
        )
        mock_git_create.assert_not_called()

    @patch("projects.tasks.provision_project_repository.delay")
    @patch("agents.queue.is_worker_available", return_value=True)
    def test_devops_create_repo_organization_scoping_and_authorization(self, _mock_worker, mock_delay):
        other_org = Organization.objects.create(name="Other Workspace")
        other_user = User.objects.create_user(
            email="other@other.dev",
            password="password123",
            role=User.Role.CEO,
            organization=other_org,
        )
        login = self.client.post(
            "/api/auth/login/", {"email": other_user.email, "password": "password123"}, format="json"
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

        res = self.client.post(
            f"/api/projects/{self.project.id}/devops_create_repo/",
            {"repo_name": "cloud-microservice"},
            format="json",
        )
        self.assertEqual(res.status_code, 404)
        mock_delay.assert_not_called()

        self.client.credentials()
        res_unauth = self.client.post(
            f"/api/projects/{self.project.id}/devops_create_repo/",
            {"repo_name": "cloud-microservice"},
            format="json",
        )
        self.assertEqual(res_unauth.status_code, 401)
        mock_delay.assert_not_called()

    @patch("projects.tasks.provision_project_repository.delay")
    @patch("agents.queue.is_worker_available", return_value=False)
    def test_devops_create_repo_fails_when_no_worker_available(self, _mock_worker, mock_delay):
        res = self.client.post(
            f"/api/projects/{self.project.id}/devops_create_repo/",
            {"repo_name": "cloud-microservice"},
            format="json",
        )
        self.assertEqual(res.status_code, 503)
        self.assertFalse(res.data.get("ok", True))
        self.assertIn("worker queue is unavailable", res.data.get("error", "") or res.data.get("detail", ""))
        mock_delay.assert_not_called()

    @patch("agents.git_service.devops_create_project_repo")
    def test_provision_project_repository_task_success_records_outcome(self, mock_git_create):
        task = Task.objects.create(
            title="Initial ticket",
            project=self.project,
            organization=self.org,
        )
        mock_git_create.return_value = {
            "ok": True,
            "repo_name": "cloud-microservice",
            "full_name": "Asta-Builds/cloud-microservice",
            "html_url": "https://github.com/Asta-Builds/cloud-microservice",
            "clone_url": "https://github.com/Asta-Builds/cloud-microservice.git",
            "exists": False,
            "pushed": True,
            "message": "Repository created and scaffold pushed.",
        }

        result = provision_project_repository(
            self.project.id,
            self.ceo.id,
            repo_name="cloud-microservice",
            private=True,
            org="Asta-Builds",
            description="Autonomous cloud service",
        )

        self.assertTrue(result["ok"])
        mock_git_create.assert_called_once_with(
            project=self.project,
            user=self.ceo,
            repo_name="cloud-microservice",
            private=True,
            org="Asta-Builds",
            description="Autonomous cloud service",
        )

        notification = Notification.objects.filter(recipient=self.ceo, organization=self.org).first()
        self.assertIsNotNone(notification)
        self.assertEqual(notification.title, "GitHub repository provisioned")
        self.assertIn("Asta-Builds/cloud-microservice", notification.message)

        activity = TaskActivity.objects.filter(task=task, action="repo_provisioned").first()
        self.assertIsNotNone(activity)

    @patch("agents.git_service.devops_create_project_repo")
    def test_provision_project_repository_task_failure_records_outcome(self, mock_git_create):
        task = Task.objects.create(
            title="Initial ticket",
            project=self.project,
            organization=self.org,
        )
        mock_git_create.return_value = {
            "ok": False,
            "error": "Failed to create remote repository on GitHub.",
            "status_code": 400,
        }

        result = provision_project_repository(
            self.project.id,
            self.ceo.id,
            repo_name="cloud-microservice",
            private=True,
            org="Asta-Builds",
            description="Autonomous cloud service",
        )

        self.assertFalse(result["ok"])
        mock_git_create.assert_called_once()

        notification = Notification.objects.filter(
            recipient=self.ceo,
            organization=self.org,
            title__icontains="failed",
        ).first()
        self.assertIsNotNone(notification)
        self.assertIn("Failed to create remote repository on GitHub.", notification.message)

        activity = TaskActivity.objects.filter(task=task, action="repo_provision_failed").first()
        self.assertIsNotNone(activity)

        event = AgentEvent.objects.filter(task=task, event_type="failed").first()
        self.assertIsNotNone(event)
        self.assertIn("Failed to create remote repository on GitHub.", event.message)

    @patch("agents.git_service.devops_create_project_repo", side_effect=RuntimeError("GitHub API network error"))
    def test_provision_project_repository_task_exception_records_outcome(self, mock_git_create):
        result = provision_project_repository(
            self.project.id,
            self.ceo.id,
            repo_name="cloud-microservice",
        )

        self.assertFalse(result["ok"])
        self.assertIn("GitHub API network error", result["error"])

        notification = Notification.objects.filter(
            recipient=self.ceo,
            organization=self.org,
            title__icontains="failed",
        ).first()
        self.assertIsNotNone(notification)
        self.assertIn("GitHub API network error", notification.message)
