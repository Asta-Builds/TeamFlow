from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, override_settings
from jwt.exceptions import InvalidSignatureError
from rest_framework.test import APITestCase

from organizations.models import Organization
from .keycloak import KeycloakTokenError, verify_keycloak_token

User = get_user_model()


@override_settings(
    KEYCLOAK_JWKS_URL="https://identity.example.test/certs",
    KEYCLOAK_HTTP_TIMEOUT_SECONDS=3,
    KEYCLOAK_CLIENT_ID="teamflow-app",
    KEYCLOAK_ISSUER_URL="https://identity.example.test/realms/teamflow",
)
class KeycloakTokenVerifierTests(SimpleTestCase):
    @patch("accounts.keycloak.jwt.decode")
    @patch("accounts.keycloak.PyJWKClient")
    def test_verifier_requires_signature_issuer_audience_and_time_claims(self, jwk_client, decode):
        signing_key = object()
        jwk_client.return_value.get_signing_key_from_jwt.return_value = SimpleNamespace(key=signing_key)
        decode.return_value = {
            "sub": "verified-user",
            "email": "verified@example.com",
            "exp": 1,
            "iat": 1,
            "iss": "https://identity.example.test/realms/teamflow",
        }

        claims = verify_keycloak_token("signed-token")

        self.assertEqual(claims["email"], "verified@example.com")
        jwk_client.assert_called_once_with("https://identity.example.test/certs", timeout=3)
        decode.assert_called_once_with(
            "signed-token",
            signing_key,
            algorithms=["RS256"],
            audience="teamflow-app",
            issuer="https://identity.example.test/realms/teamflow",
            options={"require": ["exp", "iat", "iss", "sub"]},
        )

    @patch("accounts.keycloak.jwt.decode", side_effect=InvalidSignatureError)
    @patch("accounts.keycloak.PyJWKClient")
    def test_verifier_rejects_an_invalid_signature(self, jwk_client, _decode):
        jwk_client.return_value.get_signing_key_from_jwt.return_value = SimpleNamespace(key=object())
        with self.assertRaises(KeycloakTokenError):
            verify_keycloak_token("forged-token")


class AuthenticationSecurityTests(APITestCase):
    def test_keycloak_email_fallback_is_rejected(self):
        response = self.client.post(
            "/api/auth/keycloak/",
            {"email": "attacker@example.com", "role": "ceo"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertFalse(User.objects.filter(email="attacker@example.com").exists())

    @patch("accounts.views.verify_keycloak_token")
    def test_verified_keycloak_claims_create_user_without_request_role_escalation(self, verify):
        verify.return_value = {
            "sub": "keycloak-user-1",
            "email": "verified@example.com",
            "name": "Verified User",
            "realm_access": {"roles": ["member"]},
        }
        response = self.client.post(
            "/api/auth/keycloak/",
            {"token": "signed-token", "role": "ceo"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        user = User.objects.get(email="verified@example.com")
        self.assertEqual(user.role, User.Role.MEMBER)

    def test_profile_update_cannot_change_role_or_status(self):
        organization = Organization.objects.create(name="Secure Org")
        user = User.objects.create_user(
            email="member@example.com",
            password="safe-password-123",
            organization=organization,
            role=User.Role.MEMBER,
        )
        self.client.force_authenticate(user=user)
        response = self.client.patch(
            "/api/auth/me/",
            {"name": "Updated", "role": "ceo", "user_status": "disabled"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        user.refresh_from_db()
        self.assertEqual(user.name, "Updated")
        self.assertEqual(user.role, User.Role.MEMBER)
        self.assertEqual(user.user_status, User.Status.ACTIVE)

    def test_member_management_denial_returns_403(self):
        organization = Organization.objects.create(name="Secure Org")
        member = User.objects.create_user(
            email="member@example.com",
            password="safe-password-123",
            organization=organization,
            role=User.Role.MEMBER,
        )
        self.client.force_authenticate(user=member)
        response = self.client.post(
            "/api/users/",
            {"email": "new@example.com", "name": "New User", "role": "member"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_member_cannot_update_another_member_through_the_users_api(self):
        organization = Organization.objects.create(name="Secure Org")
        member = User.objects.create_user(
            email="member@example.com",
            password="safe-password-123",
            organization=organization,
            role=User.Role.MEMBER,
        )
        other_member = User.objects.create_user(
            email="other@example.com",
            password="safe-password-123",
            organization=organization,
            role=User.Role.MEMBER,
            bio="Original bio",
        )
        self.client.force_authenticate(user=member)
        response = self.client.patch(f"/api/users/{other_member.id}/", {"bio": "Changed"}, format="json")
        self.assertEqual(response.status_code, 403)
        other_member.refresh_from_db()
        self.assertEqual(other_member.bio, "Original bio")
