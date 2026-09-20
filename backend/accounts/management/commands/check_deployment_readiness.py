import json
import os
import uuid
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


class Command(BaseCommand):
    help = "Checks production deployment readiness across database, providers, verification, and security."

    def add_arguments(self, parser):
        parser.add_argument(
            "--json",
            action="store_true",
            help="Output readiness checks in JSON format.",
        )

    def handle(self, *args, **options):
        checks = [
            ("Database", self._check_database()),
            ("Model provider", self._check_model_provider()),
            ("Verification", self._check_verification()),
            ("Release gate", self._check_release_gate()),
            ("Deployments", self._check_deployments()),
            ("Service bridge", self._check_service_bridge()),
            ("Workspaces", self._check_workspaces()),
            ("Safety", self._check_safety()),
        ]

        all_ok = all(result["ok"] for _, result in checks)

        if options.get("json"):
            report = {
                "ok": all_ok,
                "checks": {
                    name.lower().replace(" ", "_"): result for name, result in checks
                },
            }
            self.stdout.write(json.dumps(report, indent=2))
        else:
            for name, result in checks:
                self.stdout.write(f"{name}: {result['detail']}")

        if not all_ok:
            failed = [name for name, result in checks if not result["ok"]]
            raise CommandError(f"Deployment readiness check failed: {', '.join(failed)}.")

    def _check_database(self):
        connection_ok = False
        vector_ok = True
        unapplied = []
        errors = []

        try:
            connection.ensure_connection()
            connection_ok = True
        except Exception as exc:
            return {
                "ok": False,
                "status": "FAIL",
                "detail": f"FAIL (database connection failed: {exc})",
                "connection": False,
                "vector_extension": False,
                "unapplied_migrations": [],
            }

        if connection.vendor == "postgresql":
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1 FROM pg_extension WHERE extname = %s", ["vector"])
                    vector_ok = bool(cursor.fetchone())
            except Exception as exc:
                vector_ok = False
                errors.append(f"failed to query pg_extension: {exc}")

            if not vector_ok:
                errors.append("pgvector extension is not installed")
        else:
            vector_ok = True

        try:
            executor = MigrationExecutor(connection)
            targets = executor.loader.graph.leaf_nodes()
            plan = executor.migration_plan(targets)
            if plan:
                unapplied = [f"{migration[0].app_label}.{migration[0].name}" for migration in plan]
                errors.append(f"{len(unapplied)} unapplied migration(s): {', '.join(unapplied[:3])}")
        except Exception as exc:
            errors.append(f"failed to inspect migrations: {exc}")

        is_ok = connection_ok and vector_ok and (len(unapplied) == 0) and not errors
        if is_ok:
            detail = "OK (connection healthy, pgvector installed, migrations up to date)"
            status = "OK"
        else:
            detail = f"FAIL ({'; '.join(errors)})"
            status = "FAIL"

        return {
            "ok": is_ok,
            "status": status,
            "detail": detail,
            "connection": connection_ok,
            "vector_extension": vector_ok,
            "unapplied_migrations": unapplied,
        }

    def _check_model_provider(self):
        gemini_key = getattr(settings, "GEMINI_API_KEY", "") or os.environ.get("GEMINI_API_KEY", "")
        openai_key = getattr(settings, "OPENAI_API_KEY", "") or os.environ.get("OPENAI_API_KEY", "")
        ollama_url = getattr(settings, "OLLAMA_BASE_URL", "") or os.environ.get("OLLAMA_BASE_URL", "")

        gemini_set = bool(str(gemini_key).strip())
        openai_set = bool(str(openai_key).strip())
        ollama_set = bool(str(ollama_url).strip())

        configured = []
        if gemini_set:
            configured.append("GEMINI_API_KEY")
        if openai_set:
            configured.append("OPENAI_API_KEY")
        if ollama_set:
            configured.append("OLLAMA_BASE_URL")

        is_ok = bool(configured)
        if is_ok:
            status = "OK"
            detail = f"OK (configured: {', '.join(configured)})"
        else:
            status = "FAIL"
            detail = (
                "FAIL (no model provider configured: GEMINI_API_KEY, OPENAI_API_KEY, "
                "and OLLAMA_BASE_URL are all unset; swarm cannot run)"
            )

        return {
            "ok": is_ok,
            "status": status,
            "detail": detail,
            "gemini_api_key_set": gemini_set,
            "openai_api_key_set": openai_set,
            "ollama_base_url_set": ollama_set,
        }

    def _check_verification(self):
        executor = getattr(settings, "AGENT_VERIFY_EXECUTOR", "") or os.environ.get("AGENT_VERIFY_EXECUTOR", "auto")
        executor = str(executor).strip().lower() or "auto"

        docker_reachable = False
        is_warning = False
        warning_text = ""

        if executor in ("auto", "docker"):
            try:
                from agents.verification.docker_executor import DockerExecutor
                avail, reason = DockerExecutor().available()
                docker_reachable = avail
                if not avail:
                    is_warning = True
                    warning_text = (
                        f"Docker daemon unreachable ({reason}); on Railway verification "
                        "runs through GitHub Actions and projects without a linked repository end as 'unverified'"
                    )
            except Exception as exc:
                is_warning = True
                warning_text = (
                    f"failed to check Docker daemon ({exc}); on Railway verification "
                    "runs through GitHub Actions and projects without a linked repository end as 'unverified'"
                )
        else:
            docker_reachable = None

        if is_warning:
            status = "WARN"
            detail = f"WARN (executor={executor}; {warning_text})"
        else:
            status = "OK"
            detail = f"OK (executor={executor})"

        return {
            "ok": True,
            "status": status,
            "detail": detail,
            "executor": executor,
            "docker_reachable": docker_reachable,
            "warning": warning_text if is_warning else None,
        }

    def _check_release_gate(self):
        approval_required = getattr(settings, "AGENT_REQUIRE_RELEASE_APPROVAL", True)
        if isinstance(approval_required, str):
            approval_required = approval_required.lower() in ("true", "1", "yes")

        detail = f"OK (AGENT_REQUIRE_RELEASE_APPROVAL={approval_required})"
        return {
            "ok": True,
            "status": "OK",
            "detail": detail,
            "agent_require_release_approval": bool(approval_required),
        }

    def _check_deployments(self):
        hook_urls = getattr(settings, "DEPLOY_HOOK_URLS", {})
        dev_hook = bool(str(hook_urls.get("dev") or os.environ.get("DEPLOY_HOOK_URL_DEV", "")).strip())
        staging_hook = bool(str(hook_urls.get("staging") or os.environ.get("DEPLOY_HOOK_URL_STAGING", "")).strip())
        production_hook = bool(str(hook_urls.get("production") or os.environ.get("DEPLOY_HOOK_URL_PRODUCTION", "")).strip())

        has_any_hook = dev_hook or staging_hook or production_hook
        secret_set = bool(str(getattr(settings, "DEPLOY_HOOK_SECRET", "") or os.environ.get("DEPLOY_HOOK_SECRET", "")).strip())
        callback_set = bool(str(getattr(settings, "DEPLOY_CALLBACK_BASE_URL", "") or os.environ.get("DEPLOY_CALLBACK_BASE_URL", "")).strip())

        if has_any_hook and not secret_set:
            is_ok = False
            status = "FAIL"
            detail = "FAIL (deploy hook URL is configured but DEPLOY_HOOK_SECRET is missing; callbacks would be rejected)"
        elif has_any_hook:
            is_ok = True
            status = "OK"
            hooks_list = []
            if dev_hook:
                hooks_list.append("dev")
            if staging_hook:
                hooks_list.append("staging")
            if production_hook:
                hooks_list.append("production")
            detail = (
                f"OK (configured hooks: {', '.join(hooks_list)}; secret: set; "
                f"callback_base_url: {'set' if callback_set else 'not set'})"
            )
        else:
            is_ok = True
            status = "OK"
            detail = (
                f"OK (no deploy hooks configured; secret: {'set' if secret_set else 'not set'}, "
                f"callback_base_url: {'set' if callback_set else 'not set'})"
            )

        return {
            "ok": is_ok,
            "status": status,
            "detail": detail,
            "hook_urls": {
                "dev": dev_hook,
                "staging": staging_hook,
                "production": production_hook,
            },
            "secret_set": secret_set,
            "callback_base_url_set": callback_set,
        }

    def _check_service_bridge(self):
        service_url = getattr(settings, "PYTHON_AI_SERVICE_URL", "") or os.environ.get("PYTHON_AI_SERVICE_URL", "")
        jwt_secret = getattr(settings, "PYTHON_AI_JWT_SECRET", "") or os.environ.get("PYTHON_AI_JWT_SECRET", "")

        service_url_set = bool(str(service_url).strip())
        jwt_secret_set = bool(str(jwt_secret).strip())

        if service_url_set and jwt_secret_set:
            is_ok = True
            status = "OK"
            detail = "OK (PYTHON_AI_SERVICE_URL: set, PYTHON_AI_JWT_SECRET: set)"
        else:
            is_ok = False
            status = "FAIL"
            missing = []
            if not service_url_set:
                missing.append("PYTHON_AI_SERVICE_URL is unset")
            if not jwt_secret_set:
                missing.append("PYTHON_AI_JWT_SECRET is missing")
            detail = f"FAIL ({'; '.join(missing)}; NestJS and Django must share it or every bridged call fails)"

        return {
            "ok": is_ok,
            "status": status,
            "detail": detail,
            "service_url_set": service_url_set,
            "jwt_secret_set": jwt_secret_set,
        }

    def _check_workspaces(self):
        app_role = (getattr(settings, "APP_ROLE", "") or os.environ.get("APP_ROLE", "")).strip().lower()
        is_web = (app_role == "web")

        try:
            from agents.git_service import GENERATED_PROJECTS_ROOT
            resolved_path = os.path.abspath(GENERATED_PROJECTS_ROOT)
        except Exception:
            ws = os.environ.get("WORKSPACE_ROOT", getattr(settings, "WORKSPACE_ROOT", str(settings.BASE_DIR)))
            resolved_path = os.path.abspath(os.path.join(ws, "generated_projects"))

        exists = os.path.isdir(resolved_path)
        writable = False
        if exists:
            probe_file = os.path.join(resolved_path, f".readiness_probe_{uuid.uuid4().hex}")
            try:
                with open(probe_file, "w") as f:
                    f.write("probe")
                os.remove(probe_file)
                writable = True
            except OSError:
                writable = False

        if exists and writable:
            is_ok = True
            status = "OK"
            detail = f"OK (path: {resolved_path}, exists and writable)"
        elif is_web:
            is_ok = True
            status = "INFO"
            reasons = []
            if not exists:
                reasons.append("does not exist")
            elif not writable:
                reasons.append("not writable")
            detail = (
                f"INFO (path: {resolved_path} {', '.join(reasons)}; expected on web service "
                "since only the worker mounts the volume on Railway)"
            )
        else:
            is_ok = False
            status = "FAIL"
            reasons = []
            if not exists:
                reasons.append("does not exist")
            elif not writable:
                reasons.append("not writable")
            detail = f"FAIL (path: {resolved_path} {', '.join(reasons)})"

        return {
            "ok": is_ok,
            "status": status,
            "detail": detail,
            "path": resolved_path,
            "exists": exists,
            "writable": writable,
            "app_role": app_role,
            "informational": is_web and not (exists and writable),
        }

    def _check_safety(self):
        public_domain = (getattr(settings, "RAILWAY_PUBLIC_DOMAIN", "") or os.environ.get("RAILWAY_PUBLIC_DOMAIN", "")).strip()
        is_debug = bool(getattr(settings, "DEBUG", False))
        allowed_hosts = list(getattr(settings, "ALLOWED_HOSTS", []))

        errors = []
        if public_domain and is_debug:
            errors.append(f"DEBUG is True while public domain '{public_domain}' is configured")

        if "*" in allowed_hosts:
            errors.append("ALLOWED_HOSTS contains '*' wildcard")

        if errors:
            is_ok = False
            status = "FAIL"
            detail = f"FAIL ({'; '.join(errors)})"
        else:
            is_ok = True
            status = "OK"
            detail = f"OK (DEBUG={is_debug}, ALLOWED_HOSTS valid)"

        return {
            "ok": is_ok,
            "status": status,
            "detail": detail,
            "debug": is_debug,
            "public_domain": public_domain,
            "allowed_hosts_valid": "*" not in allowed_hosts,
        }
