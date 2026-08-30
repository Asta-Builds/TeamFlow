from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from organizations.models import Organization
from projects.models import Project


User = get_user_model()


class DeploymentWorkspaceTests(APITestCase):
    def test_deployment_rejects_a_project_from_another_workspace(self):
        organization = Organization.objects.create(name="Workspace A")
        devops = User.objects.create_user(
            email="devops@workspace-a.dev",
            password="password123",
            role=User.Role.DEVOPS,
            organization=organization,
        )
        other_org = Organization.objects.create(name="Workspace B")
        other_project = Project.objects.create(name="Workspace B Project", organization=other_org)
        login = self.client.post(
            "/api/auth/login/", {"email": devops.email, "password": "password123"}, format="json"
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

        response = self.client.post(
            "/api/deployments/",
            {"project": other_project.id, "environment": "staging"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("project", response.data)
