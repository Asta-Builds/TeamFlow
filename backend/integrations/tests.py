import hashlib
import hmac
import time

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from .models import SlackIntegration
from organizations.models import Organization


User = get_user_model()


class SlackIntegrationSecurityTests(APITestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name="Workspace")
        self.admin = User.objects.create_user(
            email="admin@workspace.dev",
            password="password123",
            role=User.Role.ADMIN,
            organization=self.organization,
        )
        self.member = User.objects.create_user(
            email="member@workspace.dev",
            password="password123",
            role=User.Role.MEMBER,
            organization=self.organization,
        )
        self.integration = SlackIntegration.objects.create(
            organization=self.organization,
            webhook_url="https://hooks.slack.com/services/T000/B000/secret",
            bot_token="xoxb-secret-token",
        )

    def authenticate(self, user):
        response = self.client.post(
            "/api/auth/login/", {"email": user.email, "password": "password123"}, format="json"
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")

    def test_only_workspace_admins_can_manage_slack_and_secrets_are_redacted(self):
        self.authenticate(self.member)
        self.assertEqual(self.client.get("/api/integrations/slack/").status_code, 403)

        self.authenticate(self.admin)
        response = self.client.get("/api/integrations/slack/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("webhook_url", response.data)
        self.assertNotIn("bot_token", response.data)
        self.assertTrue(response.data["webhook_configured"])
        self.assertTrue(response.data["bot_token_configured"])

    def test_slack_webhook_must_use_the_official_https_host(self):
        self.authenticate(self.admin)
        response = self.client.post(
            "/api/integrations/slack/connect/",
            {"webhook_url": "http://example.com/webhook"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("webhook_url", response.data)

    @override_settings(SLACK_SIGNING_SECRET="signing-secret")
    def test_slack_events_require_a_valid_timestamped_signature(self):
        body = b'{"type":"url_verification","challenge":"challenge-code"}'
        timestamp = str(int(time.time()))
        signature = "v0=" + hmac.new(
            b"signing-secret", b"v0:" + timestamp.encode("utf-8") + b":" + body, hashlib.sha256
        ).hexdigest()

        response = self.client.post(
            "/api/integrations/slack/events/",
            body,
            content_type="application/json",
            HTTP_X_SLACK_REQUEST_TIMESTAMP=timestamp,
            HTTP_X_SLACK_SIGNATURE=signature,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["challenge"], "challenge-code")

        invalid = self.client.post(
            "/api/integrations/slack/events/",
            body,
            content_type="application/json",
            HTTP_X_SLACK_REQUEST_TIMESTAMP=timestamp,
            HTTP_X_SLACK_SIGNATURE="v0=invalid",
        )
        self.assertEqual(invalid.status_code, 403)
