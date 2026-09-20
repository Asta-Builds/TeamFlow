import io
import json
import os
import shutil
import tempfile
from unittest.mock import patch

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from teamflow.settings import configure_railway_hosts


class RailwaySettingsTest(TestCase):
    def test_configure_railway_hosts_with_public_and_private_domains(self):
        initial_hosts = ["localhost", "127.0.0.1"]
        initial_origins = ["http://localhost:3000"]
        public_domain = "teamflow-production.up.railway.app"
        private_domain = "teamflow-backend.railway.internal"

        hosts, origins = configure_railway_hosts(
            initial_hosts,
            initial_origins,
            public_domain=public_domain,
            private_domain=private_domain,
        )

        # Preserves operator entries
        self.assertIn("localhost", hosts)
        self.assertIn("127.0.0.1", hosts)
        self.assertIn("http://localhost:3000", origins)

        # Appends Railway domains
        self.assertIn(public_domain, hosts)
        self.assertIn(private_domain, hosts)
        self.assertIn(f"https://{public_domain}", origins)

    def test_configure_railway_hosts_with_absent_domains(self):
        initial_hosts = ["localhost", "teamflow.example.com"]
        initial_origins = ["https://teamflow.example.com"]

        hosts, origins = configure_railway_hosts(
            initial_hosts,
            initial_origins,
            public_domain="",
            private_domain="",
        )

        self.assertEqual(hosts, initial_hosts)
        self.assertEqual(origins, initial_origins)

    def test_configure_railway_hosts_strips_protocol_and_slashes(self):
        initial_hosts = ["teamflow.com"]
        initial_origins = []
        public_domain = "https://app.up.railway.app/"
        private_domain = "http://internal.railway.internal/"

        hosts, origins = configure_railway_hosts(
            initial_hosts,
            initial_origins,
            public_domain=public_domain,
            private_domain=private_domain,
        )

        self.assertIn("app.up.railway.app", hosts)
        self.assertIn("internal.railway.internal", hosts)
        self.assertIn("https://app.up.railway.app", origins)
        self.assertNotIn("https://app.up.railway.app/", hosts)

    def test_configure_railway_hosts_avoids_duplicates(self):
        initial_hosts = ["app.up.railway.app"]
        initial_origins = ["https://app.up.railway.app"]

        hosts, origins = configure_railway_hosts(
            initial_hosts,
            initial_origins,
            public_domain="app.up.railway.app",
        )

        self.assertEqual(hosts.count("app.up.railway.app"), 1)
        self.assertEqual(origins.count("https://app.up.railway.app"), 1)


class DeploymentReadinessCommandTest(TestCase):
    def setUp(self):
        self.temp_workspace = tempfile.mkdtemp(prefix="teamflow-test-readiness-")
        self.temp_projects = os.path.join(self.temp_workspace, "generated_projects")
        os.makedirs(self.temp_projects, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.temp_workspace, ignore_errors=True)

    def _call_readiness(self, *args, **kwargs):
        stdout = io.StringIO()
        stderr = io.StringIO()
        kwargs["stdout"] = stdout
        kwargs["stderr"] = stderr
        try:
            call_command("check_deployment_readiness", *args, **kwargs)
            error = None
        except CommandError as exc:
            error = exc
        return stdout.getvalue(), stderr.getvalue(), error

    def test_passes_on_healthy_environment(self):
        with patch.object(settings, "GEMINI_API_KEY", "fake-gemini-key"), \
             patch.object(settings, "PYTHON_AI_SERVICE_URL", "http://backend:8000"), \
             patch.object(settings, "PYTHON_AI_JWT_SECRET", "super-secret-jwt-key-32-chars-long"), \
             patch.object(settings, "DEBUG", False), \
             patch.object(settings, "ALLOWED_HOSTS", ["localhost", "teamflow.example.com"]), \
             patch.object(settings, "DEPLOY_HOOK_URLS", {}), \
             patch("agents.git_service.GENERATED_PROJECTS_ROOT", self.temp_projects):
            stdout, stderr, error = self._call_readiness()
            self.assertIsNone(error)
            self.assertIn("Database: OK", stdout)
            self.assertIn("Model provider: OK", stdout)
            self.assertIn("Service bridge: OK", stdout)
            self.assertIn("Workspaces: OK", stdout)
            self.assertIn("Safety: OK", stdout)

    def test_fails_when_no_model_provider_configured(self):
        with patch.object(settings, "GEMINI_API_KEY", ""), \
             patch.object(settings, "OPENAI_API_KEY", ""), \
             patch.object(settings, "OLLAMA_BASE_URL", ""), \
             patch.dict(os.environ, {"GEMINI_API_KEY": "", "OPENAI_API_KEY": "", "OLLAMA_BASE_URL": ""}), \
             patch.object(settings, "PYTHON_AI_SERVICE_URL", "http://backend:8000"), \
             patch.object(settings, "PYTHON_AI_JWT_SECRET", "super-secret-jwt-key-32-chars-long"), \
             patch("agents.git_service.GENERATED_PROJECTS_ROOT", self.temp_projects):
            stdout, stderr, error = self._call_readiness()
            self.assertIsNotNone(error)
            self.assertIn("Model provider", str(error))
            self.assertIn("Model provider: FAIL", stdout)
            self.assertIn("no model provider configured", stdout)

    def test_fails_when_deploy_hook_configured_without_secret(self):
        with patch.object(settings, "GEMINI_API_KEY", "fake-gemini-key"), \
             patch.object(settings, "PYTHON_AI_SERVICE_URL", "http://backend:8000"), \
             patch.object(settings, "PYTHON_AI_JWT_SECRET", "super-secret-jwt-key-32-chars-long"), \
             patch.object(settings, "DEPLOY_HOOK_URLS", {"dev": "https://deploy.example.com/hook", "staging": "", "production": ""}), \
             patch.object(settings, "DEPLOY_HOOK_SECRET", ""), \
             patch.dict(os.environ, {"DEPLOY_HOOK_SECRET": ""}), \
             patch("agents.git_service.GENERATED_PROJECTS_ROOT", self.temp_projects):
            stdout, stderr, error = self._call_readiness()
            self.assertIsNotNone(error)
            self.assertIn("Deployments", str(error))
            self.assertIn("DEPLOY_HOOK_SECRET is missing", stdout)

    def test_never_prints_secret_value(self):
        fake_gemini_secret = "secret-gemini-key-not-to-be-leaked-12345"
        fake_deploy_secret = "secret-deploy-hook-token-do-not-print-67890"
        fake_jwt_secret = "secret-jwt-bridge-key-must-be-hidden-abcde"

        with patch.object(settings, "GEMINI_API_KEY", fake_gemini_secret), \
             patch.object(settings, "DEPLOY_HOOK_URLS", {"production": "https://deploy.example.com"}), \
             patch.object(settings, "DEPLOY_HOOK_SECRET", fake_deploy_secret), \
             patch.object(settings, "PYTHON_AI_SERVICE_URL", "http://backend:8000"), \
             patch.object(settings, "PYTHON_AI_JWT_SECRET", fake_jwt_secret), \
             patch("agents.git_service.GENERATED_PROJECTS_ROOT", self.temp_projects):
            # Test plaintext output
            stdout, stderr, _ = self._call_readiness()
            self.assertNotIn(fake_gemini_secret, stdout)
            self.assertNotIn(fake_gemini_secret, stderr)
            self.assertNotIn(fake_deploy_secret, stdout)
            self.assertNotIn(fake_deploy_secret, stderr)
            self.assertNotIn(fake_jwt_secret, stdout)
            self.assertNotIn(fake_jwt_secret, stderr)

            # Test JSON output
            json_stdout, json_stderr, _ = self._call_readiness("--json")
            self.assertNotIn(fake_gemini_secret, json_stdout)
            self.assertNotIn(fake_gemini_secret, json_stderr)
            self.assertNotIn(fake_deploy_secret, json_stdout)
            self.assertNotIn(fake_deploy_secret, json_stderr)
            self.assertNotIn(fake_jwt_secret, json_stdout)
            self.assertNotIn(fake_jwt_secret, json_stderr)

    def test_json_output_parses(self):
        with patch.object(settings, "GEMINI_API_KEY", "fake-gemini-key"), \
             patch.object(settings, "PYTHON_AI_SERVICE_URL", "http://backend:8000"), \
             patch.object(settings, "PYTHON_AI_JWT_SECRET", "super-secret-jwt-key-32-chars-long"), \
             patch.object(settings, "DEBUG", False), \
             patch.object(settings, "ALLOWED_HOSTS", ["localhost", "teamflow.example.com"]), \
             patch("agents.git_service.GENERATED_PROJECTS_ROOT", self.temp_projects):
            stdout, stderr, error = self._call_readiness("--json")
            self.assertIsNone(error)
            parsed = json.loads(stdout)
            self.assertTrue(parsed["ok"])
            checks = parsed["checks"]
            self.assertIn("database", checks)
            self.assertIn("model_provider", checks)
            self.assertIn("verification", checks)
            self.assertIn("release_gate", checks)
            self.assertIn("deployments", checks)
            self.assertIn("service_bridge", checks)
            self.assertIn("workspaces", checks)
            self.assertIn("safety", checks)

    def test_json_output_parses_on_failure(self):
        with patch.object(settings, "GEMINI_API_KEY", ""), \
             patch.object(settings, "OPENAI_API_KEY", ""), \
             patch.object(settings, "OLLAMA_BASE_URL", ""), \
             patch.dict(os.environ, {"GEMINI_API_KEY": "", "OPENAI_API_KEY": "", "OLLAMA_BASE_URL": ""}):
            stdout, stderr, error = self._call_readiness("--json")
            self.assertIsNotNone(error)
            parsed = json.loads(stdout)
            self.assertFalse(parsed["ok"])
            self.assertFalse(parsed["checks"]["model_provider"]["ok"])

    def test_workspaces_informational_on_web_role(self):
        non_existent_path = os.path.join(self.temp_workspace, "does_not_exist")
        with patch.object(settings, "APP_ROLE", "web"), \
             patch.dict(os.environ, {"APP_ROLE": "web"}), \
             patch.object(settings, "GEMINI_API_KEY", "fake-gemini-key"), \
             patch.object(settings, "PYTHON_AI_SERVICE_URL", "http://backend:8000"), \
             patch.object(settings, "PYTHON_AI_JWT_SECRET", "super-secret-jwt-key-32-chars-long"), \
             patch("agents.git_service.GENERATED_PROJECTS_ROOT", non_existent_path):
            stdout, stderr, error = self._call_readiness()
            self.assertIsNone(error)
            self.assertIn("Workspaces: INFO", stdout)

    def test_safety_fails_with_debug_and_public_domain(self):
        with patch.object(settings, "RAILWAY_PUBLIC_DOMAIN", "teamflow-production.up.railway.app"), \
             patch.dict(os.environ, {"RAILWAY_PUBLIC_DOMAIN": "teamflow-production.up.railway.app"}), \
             patch.object(settings, "DEBUG", True), \
             patch.object(settings, "GEMINI_API_KEY", "fake-gemini-key"), \
             patch.object(settings, "PYTHON_AI_SERVICE_URL", "http://backend:8000"), \
             patch.object(settings, "PYTHON_AI_JWT_SECRET", "super-secret-jwt-key-32-chars-long"), \
             patch("agents.git_service.GENERATED_PROJECTS_ROOT", self.temp_projects):
            stdout, stderr, error = self._call_readiness()
            self.assertIsNotNone(error)
            self.assertIn("Safety", str(error))
            self.assertIn("DEBUG is True while public domain", stdout)

    def test_safety_fails_with_wildcard_allowed_hosts(self):
        with patch.object(settings, "ALLOWED_HOSTS", ["*"]), \
             patch.object(settings, "GEMINI_API_KEY", "fake-gemini-key"), \
             patch.object(settings, "PYTHON_AI_SERVICE_URL", "http://backend:8000"), \
             patch.object(settings, "PYTHON_AI_JWT_SECRET", "super-secret-jwt-key-32-chars-long"), \
             patch("agents.git_service.GENERATED_PROJECTS_ROOT", self.temp_projects):
            stdout, stderr, error = self._call_readiness()
            self.assertIsNotNone(error)
            self.assertIn("Safety", str(error))
            self.assertIn("ALLOWED_HOSTS contains '*' wildcard", stdout)
