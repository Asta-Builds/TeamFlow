from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from organizations.models import Organization


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
        from projects.models import Project
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

    def test_devops_create_repo_action(self):
        from unittest.mock import patch
        with patch("agents.git_service.create_remote_repo") as mock_remote, \
             patch("agents.git_service.bootstrap_new_project_repo") as mock_bootstrap:
            mock_remote.return_value = {
                "success": True,
                "simulated": False,
                "repo_name": "cloud-microservice",
                "full_name": "Asta-Builds/cloud-microservice",
                "html_url": "https://github.com/Asta-Builds/cloud-microservice",
                "clone_url": "https://github.com/Asta-Builds/cloud-microservice.git",
                "default_branch": "main",
            }
            mock_bootstrap.return_value = {
                "success": True,
                "project_dir": "/tmp/test",
                "pushed": True,
            }

            res = self.client.post(
                f"/api/projects/{self.project.id}/devops_create_repo/",
                {"repo_name": "cloud-microservice", "private": True, "org": "Asta-Builds"},
                format="json",
            )
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.data["ok"])
            self.assertEqual(res.data["full_name"], "Asta-Builds/cloud-microservice")
            self.project.refresh_from_db()
            self.assertEqual(self.project.github_repo, "Asta-Builds/cloud-microservice")

