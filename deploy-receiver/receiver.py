"""Deployment receiver service for TeamFlow on Railway."""

from __future__ import annotations

import hashlib
import hmac
import http.server
import json
import logging
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from railway_client import (
    DEFAULT_API_URL,
    RailwayClient,
    RailwayClientError,
    extract_commit_hash,
    sanitize_text,
)

logger = logging.getLogger(__name__)

MAX_BODY_SIZE = 64 * 1024  # 64 KB
MAX_LOG_CHARS = 15000


class Config:
    """Receiver runtime configuration parsed from environment variables."""

    def __init__(
        self,
        deploy_hook_secret: str,
        teamflow_callback_base_url: str,
        railway_service_map: dict[str, dict[str, dict[str, str]]],
        railway_project_token: str | None = None,
        railway_api_token: str | None = None,
        railway_api_url: str = DEFAULT_API_URL,
        deploy_timeout_seconds: int = 1200,
        poll_interval_seconds: float = 10.0,
        port: int = 8080,
    ) -> None:
        self.deploy_hook_secret = deploy_hook_secret
        self.teamflow_callback_base_url = teamflow_callback_base_url.rstrip("/")
        self.railway_service_map = railway_service_map
        self.railway_project_token = railway_project_token
        self.railway_api_token = railway_api_token
        self.railway_api_url = railway_api_url
        self.deploy_timeout_seconds = deploy_timeout_seconds
        self.poll_interval_seconds = poll_interval_seconds
        self.port = port

    @classmethod
    def from_environ(cls, env: dict[str, str] | None = None) -> Config:
        if env is None:
            env = os.environ  # type: ignore[assignment]

        secret = (env.get("DEPLOY_HOOK_SECRET") or "").strip()
        if not secret:
            raise ValueError("DEPLOY_HOOK_SECRET is required.")
        if len(secret) < 32:
            raise ValueError("DEPLOY_HOOK_SECRET must be at least 32 characters long.")

        callback_base = (env.get("TEAMFLOW_CALLBACK_BASE_URL") or "").strip()
        if not callback_base:
            raise ValueError("TEAMFLOW_CALLBACK_BASE_URL is required.")
        parsed_base = urllib.parse.urlparse(callback_base)
        if not parsed_base.scheme or not parsed_base.netloc:
            raise ValueError(
                f"TEAMFLOW_CALLBACK_BASE_URL must be a valid absolute URL with scheme and host: {callback_base}"
            )

        project_token = (env.get("RAILWAY_PROJECT_TOKEN") or "").strip() or None
        api_token = (env.get("RAILWAY_API_TOKEN") or "").strip() or None
        if not project_token and not api_token:
            raise ValueError("Either RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN must be set.")

        service_map_raw = (env.get("RAILWAY_SERVICE_MAP") or "").strip()
        if not service_map_raw:
            raise ValueError("RAILWAY_SERVICE_MAP is required.")
        try:
            service_map = json.loads(service_map_raw)
            if not isinstance(service_map, dict):
                raise ValueError("RAILWAY_SERVICE_MAP must be a JSON object.")
        except json.JSONDecodeError as exc:
            raise ValueError(f"RAILWAY_SERVICE_MAP must be valid JSON: {exc}") from exc

        api_url = (env.get("RAILWAY_API_URL") or DEFAULT_API_URL).strip()

        try:
            deploy_timeout = int(env.get("DEPLOY_TIMEOUT_SECONDS", "1200"))
        except ValueError:
            deploy_timeout = 1200

        try:
            poll_interval = float(env.get("POLL_INTERVAL_SECONDS", "10.0"))
        except ValueError:
            poll_interval = 10.0

        try:
            port = int(env.get("PORT", "8080"))
        except ValueError:
            port = 8080

        return cls(
            deploy_hook_secret=secret,
            teamflow_callback_base_url=callback_base,
            railway_service_map=service_map,
            railway_project_token=project_token,
            railway_api_token=api_token,
            railway_api_url=api_url,
            deploy_timeout_seconds=deploy_timeout,
            poll_interval_seconds=poll_interval,
            port=port,
        )


def parse_iso_datetime(dt_str: str) -> datetime | None:
    """Parse an ISO-8601 datetime string into a timezone-aware UTC datetime."""
    if not dt_str:
        return None
    try:
        clean = dt_str.strip()
        if clean.endswith("Z"):
            clean = clean[:-1] + "+00:00"
        dt = datetime.fromisoformat(clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def send_callback(
    callback_url: str,
    payload: dict,
    secret: str,
    transport: Callable[[urllib.request.Request], Any] | None = None,
    max_retries: int = 3,
    initial_backoff: float = 1.0,
) -> bool:
    """Send signed callback to TeamFlow with retries on 5xx/network errors, stopping on 4xx."""
    body_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    sig = "sha256=" + hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-TeamFlow-Signature": sig,
        "User-Agent": "TeamFlow-DeployReceiver/1.0",
    }
    req = urllib.request.Request(callback_url, data=body_bytes, headers=headers, method="POST")

    attempt = 0
    backoff = initial_backoff
    while attempt <= max_retries:
        try:
            if transport is not None:
                res = transport(req)
                status_code = getattr(res, "status", getattr(res, "status_code", 200))
            else:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    status_code = resp.status

            if 200 <= status_code < 300:
                logger.info("Callback to %s succeeded with HTTP %d", callback_url, status_code)
                return True
            if 400 <= status_code < 500:
                logger.warning(
                    "Callback to %s returned 4xx client error HTTP %d; not retrying.",
                    callback_url,
                    status_code,
                )
                return False
            logger.warning(
                "Callback to %s returned HTTP %d on attempt %d/%d",
                callback_url,
                status_code,
                attempt + 1,
                max_retries + 1,
            )
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500:
                logger.warning(
                    "Callback to %s returned 4xx client error HTTP %d; not retrying.",
                    callback_url,
                    exc.code,
                )
                return False
            logger.warning(
                "Callback HTTP error %d on attempt %d/%d",
                exc.code,
                attempt + 1,
                max_retries + 1,
            )
        except Exception as exc:
            logger.warning(
                "Callback network error %s on attempt %d/%d",
                exc,
                attempt + 1,
                max_retries + 1,
            )

        attempt += 1
        if attempt <= max_retries:
            time.sleep(backoff)
            backoff *= 2.0

    logger.error("Callback to %s failed after %d attempts", callback_url, max_retries + 1)
    return False


class DeployReceiver:
    """Core logic for verifying requests, orchestrating Railway deploys, and sending callbacks."""

    def __init__(
        self,
        config: Config,
        railway_client: RailwayClient | None = None,
        callback_transport: Callable[[urllib.request.Request], Any] | None = None,
    ) -> None:
        self.config = config
        self.callback_transport = callback_transport
        self.in_flight_ids: set[int] = set()
        self.in_flight_lock = threading.Lock()
        self.active_threads: list[threading.Thread] = []

        if railway_client is not None:
            self.railway_client = railway_client
        else:
            self.railway_client = RailwayClient(
                api_url=config.railway_api_url,
                project_token=config.railway_project_token,
                api_token=config.railway_api_token,
            )

        self._secrets: list[str] = [
            s
            for s in (
                config.deploy_hook_secret,
                config.railway_project_token,
                config.railway_api_token,
            )
            if s
        ]

    def _sanitize(self, text: str) -> str:
        return sanitize_text(text, self._secrets)

    def handle_healthz(self) -> tuple[int, dict[str, str], bytes]:
        return 200, {"Content-Type": "text/plain; charset=utf-8"}, b"ok"

    def handle_deploy_hook(
        self, headers: Any, raw_body: bytes
    ) -> tuple[int, dict[str, str], bytes]:
        """Validate signature, payload, mapping, and launch background job."""
        sig_header = headers.get("X-TeamFlow-Signature", "")
        if not sig_header:
            return 401, {"Content-Type": "application/json"}, b'{"detail":"Missing signature"}'

        expected_sig = "sha256=" + hmac.new(
            self.config.deploy_hook_secret.encode("utf-8"),
            raw_body,
            hashlib.sha256,
        ).hexdigest()

        sig_header_bytes = sig_header.strip().encode("latin-1", errors="replace")
        expected_sig_bytes = expected_sig.encode("ascii")

        if not hmac.compare_digest(sig_header_bytes, expected_sig_bytes):
            return 401, {"Content-Type": "application/json"}, b'{"detail":"Invalid signature"}'

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except Exception:
            return 400, {"Content-Type": "application/json"}, b'{"detail":"Invalid JSON body"}'

        if not isinstance(payload, dict):
            return 400, {"Content-Type": "application/json"}, b'{"detail":"Payload must be an object"}'

        action = payload.get("action")
        if action not in ("deploy", "rollback"):
            return (
                400,
                {"Content-Type": "application/json"},
                b'{"detail":"Invalid action: must be deploy or rollback"}',
            )

        deployment_id = payload.get("deployment_id")
        project_id = payload.get("project_id")
        if (
            not isinstance(deployment_id, int)
            or isinstance(deployment_id, bool)
            or not isinstance(project_id, int)
            or isinstance(project_id, bool)
        ):
            return (
                400,
                {"Content-Type": "application/json"},
                b'{"detail":"deployment_id and project_id must be integers"}',
            )

        environment = payload.get("environment")
        proj_entry = self.config.railway_service_map.get(
            str(project_id)
        ) or self.config.railway_service_map.get(project_id)  # type: ignore[arg-type]
        if not isinstance(proj_entry, dict) or environment not in proj_entry:
            msg = f"no Railway service is mapped for project {project_id} environment {environment}"
            return 422, {"Content-Type": "application/json"}, json.dumps({"detail": msg}).encode("utf-8")

        env_entry = proj_entry[environment]
        if (
            not isinstance(env_entry, dict)
            or not env_entry.get("service_id")
            or not env_entry.get("environment_id")
        ):
            msg = f"no Railway service is mapped for project {project_id} environment {environment}"
            return 422, {"Content-Type": "application/json"}, json.dumps({"detail": msg}).encode("utf-8")

        callback_url = payload.get("callback_url")
        if not isinstance(callback_url, str):
            return 400, {"Content-Type": "application/json"}, b'{"detail":"callback_url must be a string"}'

        cb_parsed = urllib.parse.urlparse(callback_url)
        base_parsed = urllib.parse.urlparse(self.config.teamflow_callback_base_url)
        expected_path = f"/api/deployments/{deployment_id}/provider_callback/"

        if (
            cb_parsed.scheme != base_parsed.scheme
            or cb_parsed.netloc != base_parsed.netloc
            or cb_parsed.path != expected_path
        ):
            return (
                400,
                {"Content-Type": "application/json"},
                b'{"detail":"callback_url does not match configured host, scheme, or deployment path"}',
            )

        with self.in_flight_lock:
            if deployment_id in self.in_flight_ids:
                msg = f"Deployment {deployment_id} is already in flight."
                return 409, {"Content-Type": "application/json"}, json.dumps({"detail": msg}).encode("utf-8")
            self.in_flight_ids.add(deployment_id)

        thread = threading.Thread(
            target=self.run_job,
            args=(payload,),
            daemon=True,
            name=f"deploy-job-{deployment_id}",
        )
        self.active_threads.append(thread)
        thread.start()

        resp_body = json.dumps({"status": "accepted", "deployment_id": deployment_id}).encode("utf-8")
        return 202, {"Content-Type": "application/json"}, resp_body

    def run_job(self, payload: dict) -> None:
        """Run the deploy or rollback job in a background thread and report status via callback."""
        deployment_id = payload["deployment_id"]
        callback_url = payload["callback_url"]
        try:
            action = payload["action"]
            project_id = payload["project_id"]
            environment = payload["environment"]
            proj_entry = self.config.railway_service_map.get(
                str(project_id)
            ) or self.config.railway_service_map.get(project_id)  # type: ignore[arg-type]
            env_entry = proj_entry[environment]  # type: ignore[index]
            service_id = env_entry["service_id"]
            environment_id = env_entry["environment_id"]
            requested_sha = payload.get("commit_sha", "")

            if action == "deploy":
                self._execute_deploy(
                    deployment_id=deployment_id,
                    service_id=service_id,
                    environment_id=environment_id,
                    callback_url=callback_url,
                    requested_sha=requested_sha,
                )
            elif action == "rollback":
                self._execute_rollback(
                    deployment_id=deployment_id,
                    service_id=service_id,
                    environment_id=environment_id,
                    callback_url=callback_url,
                    requested_sha=requested_sha,
                )
        except Exception as exc:
            sanitized_err = self._sanitize(str(exc))
            logger.error("Job error for deployment %s: %s", deployment_id, sanitized_err)
            self._send_callback(
                callback_url,
                {
                    "status": "failed",
                    "logs": f"Deployment job encountered error: {sanitized_err}",
                },
            )
        finally:
            with self.in_flight_lock:
                self.in_flight_ids.discard(deployment_id)

    def _execute_deploy(
        self,
        deployment_id: int,
        service_id: str,
        environment_id: str,
        callback_url: str,
        requested_sha: str,
    ) -> None:
        trigger_time = datetime.now(timezone.utc)
        self.railway_client.service_instance_deploy(service_id, environment_id)

        earliest_created_at = trigger_time - timedelta(seconds=30)
        find_start = time.time()
        railway_dep_id = None
        poll_interval = self.config.poll_interval_seconds

        while time.time() - find_start < 120:
            deployments = self.railway_client.list_deployments(service_id, environment_id, first=10)
            for d in deployments:
                created_at_str = d.get("createdAt")
                if created_at_str:
                    dt = parse_iso_datetime(created_at_str)
                    if dt and dt >= earliest_created_at:
                        railway_dep_id = d.get("id")
                        break
            if railway_dep_id:
                break
            time.sleep(poll_interval)

        if not railway_dep_id:
            logs = "Railway did not start a deployment within 120s."
            self._send_callback(callback_url, {"status": "failed", "logs": logs})
            return

        self._track_and_report(
            deployment_id=deployment_id,
            railway_dep_id=railway_dep_id,
            callback_url=callback_url,
            requested_sha=requested_sha,
            success_status="success",
        )

    def _execute_rollback(
        self,
        deployment_id: int,
        service_id: str,
        environment_id: str,
        callback_url: str,
        requested_sha: str,
    ) -> None:
        deployments = self.railway_client.list_deployments(service_id, environment_id, first=50)

        target_dep_id = None
        if len(deployments) >= 2:
            for d in deployments[1:]:
                if d.get("status") == "SUCCESS":
                    target_dep_id = d.get("id")
                    break

        if not target_dep_id:
            logs = "no earlier successful deployment to roll back to"
            self._send_callback(callback_url, {"status": "failed", "logs": logs})
            return

        redeploy_res = self.railway_client.deployment_redeploy(target_dep_id)
        redeploy_id = redeploy_res.get("id") or target_dep_id

        self._track_and_report(
            deployment_id=deployment_id,
            railway_dep_id=redeploy_id,
            callback_url=callback_url,
            requested_sha=requested_sha,
            success_status="rolled_back",
        )

    def _track_and_report(
        self,
        deployment_id: int,
        railway_dep_id: str,
        callback_url: str,
        requested_sha: str,
        success_status: str,
    ) -> None:
        track_start = time.time()
        deploy_timeout = self.config.deploy_timeout_seconds
        poll_interval = self.config.poll_interval_seconds

        terminal_status = None
        last_status = "UNKNOWN"
        last_dep_data: dict = {}
        timeout_message = None

        while True:
            dep_data = self.railway_client.get_deployment(railway_dep_id)
            last_dep_data = dep_data
            status = dep_data.get("status", "UNKNOWN")
            last_status = status

            if status in ("SUCCESS", "SLEEPING"):
                terminal_status = success_status
                break
            if status in ("FAILED", "CRASHED", "REMOVED", "SKIPPED"):
                terminal_status = "failed"
                break

            elapsed = time.time() - track_start
            if elapsed >= deploy_timeout:
                terminal_status = "failed"
                timeout_message = f"timed out after {int(elapsed)} s; last Railway status {status}"
                break

            time.sleep(poll_interval)

        build_logs: list[dict] = []
        deploy_logs: list[dict] = []
        try:
            build_logs = self.railway_client.get_build_logs(railway_dep_id, limit=200)
        except Exception as exc:
            logger.warning("Failed to fetch build logs: %s", self._sanitize(str(exc)))
        try:
            deploy_logs = self.railway_client.get_deployment_logs(railway_dep_id, limit=200)
        except Exception as exc:
            logger.warning("Failed to fetch deployment logs: %s", self._sanitize(str(exc)))

        reported_sha = extract_commit_hash(last_dep_data.get("meta"))
        commit_mismatch_log = None
        if reported_sha:
            if requested_sha and requested_sha.strip().lower() != reported_sha.lower():
                commit_mismatch_log = (
                    f"Railway deployed commit {reported_sha}, which differs from requested commit {requested_sha}."
                )

        url = last_dep_data.get("url") or ""
        formatted_logs = self._format_logs(
            railway_dep_id=railway_dep_id,
            status=last_status,
            url=url,
            timeout_message=timeout_message,
            commit_mismatch_log=commit_mismatch_log,
            build_logs=build_logs,
            deploy_logs=deploy_logs,
        )

        payload: dict[str, Any] = {
            "status": terminal_status,
            "logs": formatted_logs,
        }
        if reported_sha:
            payload["commit_sha"] = reported_sha

        self._send_callback(callback_url, payload)

    def _format_logs(
        self,
        railway_dep_id: str,
        status: str,
        url: str,
        timeout_message: str | None,
        commit_mismatch_log: str | None,
        build_logs: list[dict],
        deploy_logs: list[dict],
    ) -> str:
        lines = [
            f"Railway Deployment: {railway_dep_id}",
            f"Status: {status}",
        ]
        if url:
            lines.append(f"URL: {url}")
        if timeout_message:
            lines.append(f"Error: {timeout_message}")
        if commit_mismatch_log:
            lines.append(commit_mismatch_log)
        lines.append("")

        if build_logs:
            lines.append("--- Build Logs ---")
            for item in build_logs:
                ts = item.get("timestamp", "")
                msg = item.get("message", "")
                lines.append(f"[{ts}] {msg}" if ts else str(msg))
            lines.append("")

        if deploy_logs:
            lines.append("--- Deployment Logs ---")
            for item in deploy_logs:
                ts = item.get("timestamp", "")
                msg = item.get("message", "")
                lines.append(f"[{ts}] {msg}" if ts else str(msg))

        full_text = "\n".join(lines).strip()
        if len(full_text) > MAX_LOG_CHARS:
            tail_text = full_text[-MAX_LOG_CHARS:]
        else:
            tail_text = full_text

        return self._sanitize(tail_text)

    def _send_callback(self, callback_url: str, payload: dict) -> bool:
        return send_callback(
            callback_url=callback_url,
            payload=payload,
            secret=self.config.deploy_hook_secret,
            transport=self.callback_transport,
        )


class DeployHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for the deployment receiver."""

    server: DeployHTTPServer  # type: ignore[assignment]
    timeout = 30

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _write_response(self, status_code: int, headers: dict[str, str], body: bytes) -> None:
        self.send_response(status_code)
        for key, val in headers.items():
            self.send_header(key, val)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/healthz":
            status_code, headers, body = self.server.receiver.handle_healthz()
            self._write_response(status_code, headers, body)
        else:
            self._write_response(
                404,
                {"Content-Type": "application/json"},
                b'{"detail":"Not Found"}',
            )

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/hooks/deploy":
            content_length_str = self.headers.get("Content-Length")
            if not content_length_str:
                self._write_response(
                    411,
                    {"Content-Type": "application/json"},
                    b'{"detail":"Missing Content-Length"}',
                )
                return

            try:
                content_length = int(content_length_str)
            except ValueError:
                self._write_response(
                    400,
                    {"Content-Type": "application/json"},
                    b'{"detail":"Invalid Content-Length"}',
                )
                return

            if content_length < 0:
                self._write_response(
                    400,
                    {"Content-Type": "application/json"},
                    b'{"detail":"Invalid Content-Length"}',
                )
                return

            # Reject bodies over 64 KB before reading them fully
            if content_length > MAX_BODY_SIZE:
                self._write_response(
                    413,
                    {"Content-Type": "application/json"},
                    b'{"detail":"Payload Too Large"}',
                )
                return

            raw_body = self.rfile.read(content_length)
            status_code, headers, body = self.server.receiver.handle_deploy_hook(
                self.headers, raw_body
            )
            self._write_response(status_code, headers, body)
        else:
            self._write_response(
                404,
                {"Content-Type": "application/json"},
                b'{"detail":"Not Found"}',
            )


class DeployHTTPServer(http.server.ThreadingHTTPServer):
    """Threading HTTPServer with a reference to DeployReceiver."""

    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        RequestHandlerClass: type[http.server.BaseHTTPRequestHandler],
        receiver: DeployReceiver,
    ) -> None:
        super().__init__(server_address, RequestHandlerClass)
        self.receiver = receiver


def create_server(
    config: Config,
    receiver: DeployReceiver | None = None,
    bind_address: str = "0.0.0.0",
) -> DeployHTTPServer:
    """Create and return a ThreadingHTTPServer configured with DeployReceiver."""
    if receiver is None:
        receiver = DeployReceiver(config)
    return DeployHTTPServer((bind_address, config.port), DeployHandler, receiver)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    try:
        config = Config.from_environ()
    except Exception as exc:
        sys.stderr.write(f"Configuration error: {exc}\n")
        sys.exit(1)

    server = create_server(config)
    logger.info("Starting deploy receiver on port %d...", config.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down deploy receiver...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
