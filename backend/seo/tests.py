from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from organizations.models import Organization
from projects.models import Project
from seo.models import SEOAudit


User = get_user_model()


class SEOAuditWorkspaceTests(APITestCase):
    def test_create_task_rejects_a_project_from_another_workspace(self):
        organization = Organization.objects.create(name="Workspace A")
        seo_user = User.objects.create_user(
            email="seo@workspace-a.dev",
            password="password123",
            role=User.Role.SEO,
            organization=organization,
        )
        audit = SEOAudit.objects.create(
            organization=organization,
            url="https://workspace-a.dev",
            issues=[{"severity": "high", "message": "Missing title", "recommendation": "Add a title."}],
        )
        other_org = Organization.objects.create(name="Workspace B")
        other_project = Project.objects.create(name="Workspace B Project", organization=other_org)
        login = self.client.post(
            "/api/auth/login/", {"email": seo_user.email, "password": "password123"}, format="json"
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

        response = self.client.post(
            f"/api/seo/audits/{audit.id}/create_task/",
            {"project_id": other_project.id, "issue_index": 0},
            format="json",
        )

        self.assertEqual(response.status_code, 404)
