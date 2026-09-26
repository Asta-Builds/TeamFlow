import os
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

User = get_user_model()
CREDENTIALS = ("DJANGO_SUPERUSER_EMAIL", "DJANGO_SUPERUSER_PASSWORD")


class InitAdminTests(TestCase):
    def run_init_admin(self, **env):
        """Run the startup command with only the given credential variables set."""
        output = StringIO()
        with mock.patch.dict(os.environ, env):
            for name in CREDENTIALS:
                if name not in env:
                    os.environ.pop(name, None)
            call_command("init_admin", stdout=output)
        return output.getvalue()

    def test_without_credentials_no_account_is_created(self):
        output = self.run_init_admin()

        self.assertIn("Skipping admin accounts", output)
        self.assertFalse(User.objects.filter(is_superuser=True).exists())

    def test_an_email_without_a_password_is_not_enough(self):
        self.run_init_admin(DJANGO_SUPERUSER_EMAIL="owner@example.com")
        self.assertFalse(User.objects.filter(email="owner@example.com").exists())

    def test_configured_credentials_create_both_admin_accounts(self):
        self.run_init_admin(DJANGO_SUPERUSER_EMAIL="owner@example.com", DJANGO_SUPERUSER_PASSWORD="a-long-local-secret")

        for email in ("owner@example.com", "admin@teamflow.dev"):
            user = User.objects.get(email=email)
            self.assertTrue(user.is_superuser)
            self.assertTrue(user.check_password("a-long-local-secret"))

    def test_a_new_password_replaces_the_old_one_on_the_next_start(self):
        self.run_init_admin(DJANGO_SUPERUSER_EMAIL="owner@example.com", DJANGO_SUPERUSER_PASSWORD="first-secret-value")
        self.run_init_admin(DJANGO_SUPERUSER_EMAIL="owner@example.com", DJANGO_SUPERUSER_PASSWORD="second-secret-value")

        user = User.objects.get(email="owner@example.com")
        self.assertFalse(user.check_password("first-secret-value"))
        self.assertTrue(user.check_password("second-secret-value"))
