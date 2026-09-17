from django.test import override_settings
from rest_framework.test import APITestCase

from organizations.models import Organization


class BillingSafetyTests(APITestCase):
    """Billing never simulates payments outside explicit development mode."""

    def setUp(self):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        self.org = Organization.objects.create(name="Billing Org")
        self.ceo = User.objects.create_user(
            email="owner@billing.dev", password="pw-owner-12345", role=User.Role.CEO, organization=self.org
        )
        self.client.force_authenticate(self.ceo)

    def test_mock_confirmation_is_disabled_by_default(self):
        response = self.client.post("/api/billing/mock-confirm/", {"tier": "enterprise"}, format="json")
        self.assertEqual(response.status_code, 503)
        self.org.refresh_from_db()
        self.assertNotEqual(self.org.subscription_tier, "enterprise")

    @override_settings(STRIPE_SECRET_KEY="", MOCK_BILLING_ENABLED=False, CORS_ALLOWED_ORIGINS=["https://app.example"])
    def test_checkout_without_stripe_is_unavailable(self):
        response = self.client.post(
            "/api/billing/create-checkout-session/",
            {"tier": "growth", "success_url": "https://app.example/billing", "cancel_url": "https://app.example/billing"},
            format="json",
        )
        self.assertEqual(response.status_code, 503)

    @override_settings(STRIPE_SECRET_KEY="", MOCK_BILLING_ENABLED=True, CORS_ALLOWED_ORIGINS=["https://app.example"])
    def test_redirects_must_point_to_the_application(self):
        response = self.client.post(
            "/api/billing/create-checkout-session/",
            {"tier": "growth", "success_url": "https://evil.example/", "cancel_url": "https://app.example/billing"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        ok = self.client.post(
            "/api/billing/create-checkout-session/",
            {"tier": "growth", "success_url": "https://app.example/billing?x=1", "cancel_url": "https://app.example/billing"},
            format="json",
        )
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(ok.data["mock"])
        self.assertIn("?x=1&session_id=", ok.data["url"])


class WorkspaceMembershipTests(APITestCase):
    """People hold per-workspace seats; specialist roles belong to AI agent seats."""

    def setUp(self):
        from django.contrib.auth import get_user_model

        from organizations.membership import add_member

        self.User = get_user_model()
        self.org = Organization.objects.create(name="Acme")
        self.other_org = Organization.objects.create(name="Globex")
        self.owner = self._person("owner@acme.test", self.org, "ceo")
        self.admin = self._person("admin@acme.test", self.org, "admin")
        self.member = self._person("member@acme.test", self.org, "member")
        # Active in Globex, also a member of Acme.
        self.shared = self._person("shared@globex.test", self.other_org, "ceo")
        add_member(self.shared, self.org, "member")
        self.outsider = self._person("outsider@globex.test", self.other_org, "member")

    def _person(self, email, org, role):
        from organizations.membership import add_member

        user = self.User.objects.create_user(email=email, password="pw-12345678", organization=org, role=role)
        add_member(user, org, role)
        return user

    def test_registration_founds_a_workspace_with_an_owner_seat(self):
        from organizations.models import Membership

        response = self.client.post(
            "/api/auth/register/",
            {"email": "founder@new.test", "password": "Very-secure-pass-123", "name": "Founder", "role": "backend"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        user = self.User.objects.get(email="founder@new.test")
        self.assertEqual(user.role, "ceo")
        seat = Membership.objects.get(user=user)
        self.assertEqual((seat.organization_id, seat.role), (user.organization_id, "ceo"))

    def test_registration_rejects_agent_addresses(self):
        response = self.client.post(
            "/api/auth/register/",
            {"email": "pm+organization-1@agents.invalid", "password": "Very-secure-pass-123"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.User.objects.filter(email="pm+organization-1@agents.invalid").exists())

    def test_people_cannot_be_given_agent_roles(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/users/",
            {"email": "dev@acme.test", "name": "Dev", "role": "backend", "password": "Very-secure-pass-123"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.patch(f"/api/users/{self.member.id}/", {"role": "devops"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.member.refresh_from_db()
        self.assertEqual(self.member.role, "member")

    def test_added_people_get_a_seat(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            "/api/users/",
            {"email": "dev@acme.test", "name": "Dev", "role": "member", "password": "Very-secure-pass-123"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        dev = self.User.objects.get(email="dev@acme.test")
        self.assertTrue(dev.memberships.filter(organization=self.org, role="member").exists())

    def test_team_lists_seat_holders_with_their_role_here(self):
        self.client.force_authenticate(self.member)
        response = self.client.get("/api/users/")
        self.assertEqual(response.status_code, 200)
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        roles = {row["email"]: row["role"] for row in rows}
        self.assertEqual(roles.get("shared@globex.test"), "member")
        self.assertNotIn("outsider@globex.test", roles)

    def test_only_owners_manage_owner_and_admin_seats(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f"/api/users/{self.member.id}/", {"role": "admin"}, format="json")
        self.assertEqual(response.status_code, 403)

        self.client.force_authenticate(self.owner)
        response = self.client.patch(f"/api/users/{self.member.id}/", {"role": "admin"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.member.refresh_from_db()
        self.assertEqual(self.member.role, "admin")
        self.assertTrue(self.member.memberships.filter(organization=self.org, role="admin").exists())

    def test_a_workspace_keeps_an_owner(self):
        self.client.force_authenticate(self.owner)
        response = self.client.patch(f"/api/users/{self.owner.id}/", {"role": "member"}, format="json")
        self.assertEqual(response.status_code, 403)

        staff = self.User.objects.create_user(
            email="ops@platform.test", password="pw-12345678", organization=self.org, is_staff=True
        )
        self.client.force_authenticate(staff)
        response = self.client.patch(f"/api/users/{self.owner.id}/", {"role": "member"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.role, "ceo")

    def test_role_changes_in_one_workspace_do_not_touch_the_active_one(self):
        self.client.force_authenticate(self.owner)
        response = self.client.patch(f"/api/users/{self.shared.id}/", {"role": "admin"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["role"], "admin")
        self.shared.refresh_from_db()
        self.assertEqual(self.shared.role, "ceo")
        self.assertEqual(self.shared.organization_id, self.other_org.id)
        self.assertTrue(self.shared.memberships.filter(organization=self.org, role="admin").exists())

    def test_admins_cannot_edit_owner_accounts(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f"/api/users/{self.owner.id}/", {"bio": "changed"}, format="json")
        self.assertEqual(response.status_code, 403)
        response = self.client.patch(f"/api/users/{self.member.id}/", {"bio": "changed"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_admins_cannot_edit_profiles_that_belong_to_other_workspaces(self):
        self.client.force_authenticate(self.owner)
        response = self.client.patch(f"/api/users/{self.shared.id}/", {"bio": "changed"}, format="json")
        self.assertEqual(response.status_code, 403)
        response = self.client.patch(f"/api/users/{self.outsider.id}/", {"bio": "changed"}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_agent_seats_keep_their_role(self):
        from agents.users import get_or_create_agent_user

        agent = get_or_create_agent_user("qa", self.org)
        self.assertFalse(agent.memberships.exists())
        self.client.force_authenticate(self.owner)
        response = self.client.patch(f"/api/users/{agent.id}/", {"role": "member"}, format="json")
        self.assertEqual(response.status_code, 403)
        agent.refresh_from_db()
        self.assertEqual(agent.role, "qa")

    def test_agent_provisioning_never_takes_over_a_person(self):
        from agents.registry import get_agent_spec
        from agents.users import _scoped_email, get_or_create_agent_user

        email = _scoped_email(get_agent_spec("qa")["email_local"], self.org.id)
        person = self.User.objects.create_user(email=email, password="pw-12345678", organization=self.other_org)
        with self.assertRaises(ValueError):
            get_or_create_agent_user("qa", self.org)
        person.refresh_from_db()
        self.assertEqual((person.agent_key, person.organization_id), ("", self.other_org.id))


class MembershipBackfillTests(APITestCase):
    def test_people_get_seats_and_workspace_roles(self):
        import importlib

        from django.apps import apps
        from django.contrib.auth import get_user_model

        from organizations.models import Membership

        User = get_user_model()
        org = Organization.objects.create(name="Legacy")
        lead = User.objects.create_user(email="lead@legacy.test", password="pw-12345678", organization=org, role="tech_lead")
        dev = User.objects.create_user(email="dev@legacy.test", password="pw-12345678", organization=org, role="backend")
        agent = User.objects.create_user(
            email="qa@legacy.test", password="pw-12345678", organization=org, role="qa", agent_key="qa"
        )
        loner = User.objects.create_user(email="loner@legacy.test", password="pw-12345678", role="devops")

        migration = importlib.import_module("organizations.migrations.0003_backfill_memberships")
        migration.backfill(apps, None)
        migration.backfill(apps, None)  # idempotent

        for user in (lead, dev, agent, loner):
            user.refresh_from_db()
        self.assertEqual((lead.role, dev.role, agent.role, loner.role), ("admin", "member", "qa", "member"))
        self.assertEqual(
            set(Membership.objects.values_list("user__email", "role")),
            {("lead@legacy.test", "admin"), ("dev@legacy.test", "member")},
        )
