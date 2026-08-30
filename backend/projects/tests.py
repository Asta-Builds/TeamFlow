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
