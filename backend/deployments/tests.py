import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from organizations.models import Organization
from projects.models import Project
from .models import Deployment
from .providers import SIGNATURE_HEADER, sign_payload


User = get_user_model()
HOOKS = {"dev": "", "staging": "https://deploy.example.invalid/staging", "production": ""}


class DeploymentWorkspaceTests(APITestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name="Workspace A")
        self.devops = User.objects.create_user(
            email="devops@workspace-a.dev",
            password="password123",
            role=User.Role.DEVOPS,
            organization=self.organization,
        )
        self.member = User.objects.create_user(
            email="member@workspace-a.dev",
            password="password123",
            role=User.Role.MEMBER,
            organization=self.organization,
        )
        self.project = Project.objects.create(name="Workspace A Project", organization=self.organization)
        self.project.members.add(self.devops, self.member)
        self.client.force_authenticate(self.devops)

    def test_deployment_rejects_a_project_from_another_workspace(self):
        other_org = Organization.objects.create(name="Workspace B")
        other_project = Project.objects.create(name="Workspace B Project", organization=other_org)

        response = self.client.post(
            "/api/deployments/",
            {"project": other_project.id, "environment": "staging"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("project", response.data)

    def test_member_cannot_trigger_deployments(self):
        self.client.force_authenticate(self.member)
        response = self.client.post("/api/deployments/", {"project": self.project.id}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_without_provider_nothing_is_recorded(self):
        response = self.client.post(
            "/api/deployments/", {"project": self.project.id, "environment": "staging"}, format="json"
        )
        self.assertEqual(response.status_code, 503)
        self.assertFalse(Deployment.objects.exists())

    @override_settings(DEPLOY_HOOK_URLS=HOOKS, DEPLOY_HOOK_SECRET="hook-secret")
    @patch("deployments.providers.requests.post")
    def test_accepted_request_is_in_progress_and_signed(self, mock_post):
        mock_post.return_value = SimpleNamespace(status_code=202, text="accepted")

        response = self.client.post(
            "/api/deployments/",
            {"project": self.project.id, "environment": "staging", "branch": "main", "commit_sha": "abc1234"},
            format="json",
        )

        self.assertEqual(response.status_code, 202, response.data)
        self.assertEqual(response.data["status"], "in_progress")
        self.assertIsNone(response.data["finished_at"])
        self.assertNotIn("HTTP 200 OK", response.data["logs"])
        _, kwargs = mock_post.call_args
        body = kwargs["data"]
        self.assertEqual(json.loads(body)["action"], "deploy")
        self.assertEqual(kwargs["headers"][SIGNATURE_HEADER], sign_payload(body))

    @override_settings(DEPLOY_HOOK_URLS=HOOKS, DEPLOY_HOOK_SECRET="hook-secret")
    @patch("deployments.providers.requests.post")
    def test_rejected_request_is_failed(self, mock_post):
        mock_post.return_value = SimpleNamespace(status_code=500, text="boom")

        response = self.client.post(
            "/api/deployments/", {"project": self.project.id, "environment": "staging"}, format="json"
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.data["status"], "failed")

    @override_settings(DEPLOY_HOOK_URLS=HOOKS, DEPLOY_HOOK_SECRET="hook-secret")
    def test_provider_callback_requires_a_valid_signature(self):
        deployment = Deployment.objects.create(
            project=self.project,
            organization=self.organization,
            environment="staging",
            status=Deployment.Status.IN_PROGRESS,
        )
        url = f"/api/deployments/{deployment.id}/provider_callback/"
        body = json.dumps({"status": "success", "logs": "released"}).encode()
        self.client.force_authenticate(None)

        bad = self.client.generic("POST", url, body, content_type="application/json", **{"HTTP_X_TEAMFLOW_SIGNATURE": "sha256=bad"})
        self.assertEqual(bad.status_code, 401)

        good = self.client.generic(
            "POST", url, body, content_type="application/json", **{"HTTP_X_TEAMFLOW_SIGNATURE": sign_payload(body)}
        )
        self.assertEqual(good.status_code, 200, good.data)
        deployment.refresh_from_db()
        self.assertEqual(deployment.status, "success")
        self.assertIsNotNone(deployment.finished_at)
        self.assertIn("released", deployment.logs)

        repeat = self.client.generic(
            "POST", url, body, content_type="application/json", **{"HTTP_X_TEAMFLOW_SIGNATURE": sign_payload(body)}
        )
        self.assertEqual(repeat.status_code, 409)

    def test_provider_callback_fails_closed_without_secret(self):
        deployment = Deployment.objects.create(project=self.project, organization=self.organization)
        body = json.dumps({"status": "success"}).encode()
        self.client.force_authenticate(None)
        response = self.client.generic(
            "POST",
            f"/api/deployments/{deployment.id}/provider_callback/",
            body,
            content_type="application/json",
            **{"HTTP_X_TEAMFLOW_SIGNATURE": sign_payload(body)},
        )
        self.assertEqual(response.status_code, 401)

    @override_settings(DEPLOY_HOOK_URLS=HOOKS, DEPLOY_HOOK_SECRET="hook-secret")
    @patch("deployments.providers.requests.post")
    def test_rollback_requests_the_recorded_release(self, mock_post):
        mock_post.return_value = SimpleNamespace(status_code=202, text="accepted")
        failed = Deployment.objects.create(
            project=self.project, organization=self.organization, status=Deployment.Status.FAILED, commit_sha="bad"
        )
        good = Deployment.objects.create(
            project=self.project, organization=self.organization, status=Deployment.Status.SUCCESS, commit_sha="abc1234"
        )

        self.assertEqual(self.client.post(f"/api/deployments/{failed.id}/rollback/").status_code, 400)

        response = self.client.post(f"/api/deployments/{good.id}/rollback/")
        self.assertEqual(response.status_code, 202, response.data)
        payload = json.loads(mock_post.call_args.kwargs["data"])
        self.assertEqual(payload["action"], "rollback")
        self.assertEqual(payload["commit_sha"], "abc1234")

    def test_deployment_records_cannot_be_edited_or_deleted(self):
        deployment = Deployment.objects.create(project=self.project, organization=self.organization)
        url = f"/api/deployments/{deployment.id}/"
        self.assertEqual(self.client.patch(url, {"status": "success"}, format="json").status_code, 405)
        self.assertEqual(self.client.delete(url).status_code, 405)
