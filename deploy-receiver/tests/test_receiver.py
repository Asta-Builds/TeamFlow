import hashlib
import hmac
import http.client
import json
import logging
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure deploy-receiver root is in sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from railway_client import RailwayClient, RailwayClientError
from receiver import Config, DeployHTTPServer, DeployReceiver, create_server, send_callback

SAMPLE_SECRET = "super_secret_deploy_hook_secret_32chars!"
SAMPLE_BASE_URL = "https://teamflow.example.com"
SAMPLE_SERVICE_MAP = {
    "1": {
        "staging": {"service_id": "srv-staging-1", "environment_id": "env-staging-1"},
        "production": {"service_id": "srv-prod-1", "environment_id": "env-prod-1"},
    }
}


def make_config(**kwargs) -> Config:
    defaults = {
        "deploy_hook_secret": SAMPLE_SECRET,
        "teamflow_callback_base_url": SAMPLE_BASE_URL,
        "railway_service_map": SAMPLE_SERVICE_MAP,
        "railway_project_token": "proj_tok_1234567890",
        "railway_api_url": "https://backboard.railway.com/graphql/v2",
        "deploy_timeout_seconds": 1200,
        "poll_interval_seconds": 0.01,
        "port": 0,
    }
    defaults.update(kwargs)
    return Config(**defaults)


def sign_body(body: bytes, secret: str = SAMPLE_SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


class TestConfig(unittest.TestCase):
    def test_refuses_to_start_without_deploy_hook_secret(self):
        env = {
            "TEAMFLOW_CALLBACK_BASE_URL": SAMPLE_BASE_URL,
            "RAILWAY_PROJECT_TOKEN": "proj_tok_123",
            "RAILWAY_SERVICE_MAP": json.dumps(SAMPLE_SERVICE_MAP),
        }
        with self.assertRaises(ValueError) as ctx:
            Config.from_environ(env)
        self.assertIn("DEPLOY_HOOK_SECRET is required", str(ctx.exception))

    def test_refuses_to_start_with_short_deploy_hook_secret(self):
        env = {
            "DEPLOY_HOOK_SECRET": "short_secret",
            "TEAMFLOW_CALLBACK_BASE_URL": SAMPLE_BASE_URL,
            "RAILWAY_PROJECT_TOKEN": "proj_tok_123",
            "RAILWAY_SERVICE_MAP": json.dumps(SAMPLE_SERVICE_MAP),
        }
        with self.assertRaises(ValueError) as ctx:
            Config.from_environ(env)
        self.assertIn("at least 32 characters", str(ctx.exception))

    def test_refuses_to_start_without_callback_base_url(self):
        env = {
            "DEPLOY_HOOK_SECRET": SAMPLE_SECRET,
            "RAILWAY_PROJECT_TOKEN": "proj_tok_123",
            "RAILWAY_SERVICE_MAP": json.dumps(SAMPLE_SERVICE_MAP),
        }
        with self.assertRaises(ValueError) as ctx:
            Config.from_environ(env)
        self.assertIn("TEAMFLOW_CALLBACK_BASE_URL is required", str(ctx.exception))

    def test_refuses_to_start_without_tokens(self):
        env = {
            "DEPLOY_HOOK_SECRET": SAMPLE_SECRET,
            "TEAMFLOW_CALLBACK_BASE_URL": SAMPLE_BASE_URL,
            "RAILWAY_SERVICE_MAP": json.dumps(SAMPLE_SERVICE_MAP),
        }
        with self.assertRaises(ValueError) as ctx:
            Config.from_environ(env)
        self.assertIn("Either RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN must be set", str(ctx.exception))

    def test_refuses_to_start_without_service_map(self):
        env = {
            "DEPLOY_HOOK_SECRET": SAMPLE_SECRET,
            "TEAMFLOW_CALLBACK_BASE_URL": SAMPLE_BASE_URL,
            "RAILWAY_PROJECT_TOKEN": "proj_tok_123",
        }
        with self.assertRaises(ValueError) as ctx:
            Config.from_environ(env)
        self.assertIn("RAILWAY_SERVICE_MAP is required", str(ctx.exception))

    def test_refuses_to_start_with_invalid_json_service_map(self):
        env = {
            "DEPLOY_HOOK_SECRET": SAMPLE_SECRET,
            "TEAMFLOW_CALLBACK_BASE_URL": SAMPLE_BASE_URL,
            "RAILWAY_PROJECT_TOKEN": "proj_tok_123",
            "RAILWAY_SERVICE_MAP": "not a valid json",
        }
        with self.assertRaises(ValueError) as ctx:
            Config.from_environ(env)
        self.assertIn("valid JSON", str(ctx.exception))


class TestReceiverHTTP(unittest.TestCase):
    def setUp(self):
        self.config = make_config()
        self.mock_client = MagicMock(spec=RailwayClient)
        self.mock_callback_transport = MagicMock(return_value=MagicMock(status=200))
        self.receiver = DeployReceiver(
            config=self.config,
            railway_client=self.mock_client,
            callback_transport=self.mock_callback_transport,
        )
        self.server = create_server(self.config, receiver=self.receiver, bind_address="127.0.0.1")
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.port = self.server.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        for t in self.receiver.active_threads:
            t.join(timeout=1.0)

    def _post(self, path: str, data: bytes, headers: dict | None = None) -> tuple[int, bytes]:
        url = f"{self.base_url}{path}"
        req_headers = headers or {}
        req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()

    def test_healthz_endpoint(self):
        url = f"{self.base_url}/healthz"
        with urllib.request.urlopen(url) as resp:
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.read(), b"ok")

    def test_not_found_endpoint(self):
        url = f"{self.base_url}/unknown/path"
        req = urllib.request.Request(url)
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 404)

    def test_valid_signature_returns_202(self):
        payload = {
            "action": "deploy",
            "deployment_id": 101,
            "project_id": 1,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/101/provider_callback/",
        }
        body = json.dumps(payload).encode("utf-8")
        sig = sign_body(body)

        status_code, resp_body = self._post(
            "/hooks/deploy",
            body,
            headers={"Content-Type": "application/json", "X-TeamFlow-Signature": sig},
        )
        self.assertEqual(status_code, 202)
        resp_data = json.loads(resp_body.decode("utf-8"))
        self.assertEqual(resp_data.get("status"), "accepted")
        self.assertEqual(resp_data.get("deployment_id"), 101)

    def test_bad_or_missing_signature_returns_401_and_json_never_parsed(self):
        # Malformed JSON with bad signature
        malformed_body = b"not-a-valid-json{{"

        # 1. Missing signature header
        status_code, resp_body = self._post(
            "/hooks/deploy",
            malformed_body,
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(status_code, 401)
        self.assertIn(b"Missing signature", resp_body)

        # 2. Invalid signature header
        status_code, resp_body = self._post(
            "/hooks/deploy",
            malformed_body,
            headers={"Content-Type": "application/json", "X-TeamFlow-Signature": "sha256=wrong_signature"},
        )
        self.assertEqual(status_code, 401)
        self.assertIn(b"Invalid signature", resp_body)

    def test_oversized_body_returns_413(self):
        # 65 KB body
        large_body = b"x" * (65 * 1024)
        sig = sign_body(large_body)

        status_code, resp_body = self._post(
            "/hooks/deploy",
            large_body,
            headers={"Content-Type": "application/json", "X-TeamFlow-Signature": sig},
        )
        self.assertEqual(status_code, 413)
        self.assertIn(b"Payload Too Large", resp_body)

    def test_negative_content_length_returns_400(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.putrequest("POST", "/hooks/deploy")
        conn.putheader("Content-Length", "-1")
        conn.endheaders()
        resp = conn.getresponse()
        self.assertEqual(resp.status, 400)
        body = resp.read()
        self.assertIn(b"Invalid Content-Length", body)
        conn.close()

    def test_non_ascii_signature_returns_401_without_crashing(self):
        # Non-ASCII signature in HTTP header
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.putrequest("POST", "/hooks/deploy")
        conn.putheader("Content-Length", "10")
        conn.putheader("X-TeamFlow-Signature", "sha256=é")
        conn.endheaders(b"1234567890")
        resp = conn.getresponse()
        self.assertEqual(resp.status, 401)
        body = resp.read()
        self.assertIn(b"Invalid signature", body)
        conn.close()

        # Direct receiver call
        status_code, _, body = self.receiver.handle_deploy_hook(
            {"X-TeamFlow-Signature": "sha256=é"},
            b'{"action":"deploy"}',
        )
        self.assertEqual(status_code, 401)
        self.assertIn(b"Invalid signature", body)

    def test_socket_timeout_and_daemon_threads(self):
        from receiver import DeployHandler

        self.assertEqual(DeployHandler.timeout, 30)
        self.assertTrue(DeployHTTPServer.daemon_threads)
        self.assertTrue(self.server.daemon_threads)

    def test_unmapped_project_or_environment_returns_422(self):
        # project_id 99 is not in SAMPLE_SERVICE_MAP
        payload = {
            "action": "deploy",
            "deployment_id": 102,
            "project_id": 99,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/102/provider_callback/",
        }
        body = json.dumps(payload).encode("utf-8")
        sig = sign_body(body)

        status_code, resp_body = self._post(
            "/hooks/deploy",
            body,
            headers={"Content-Type": "application/json", "X-TeamFlow-Signature": sig},
        )
        self.assertEqual(status_code, 422)
        resp_data = json.loads(resp_body.decode("utf-8"))
        self.assertIn("no Railway service is mapped for project 99 environment staging", resp_data["detail"])

    def test_callback_url_validation_returns_400(self):
        # Host mismatch
        payload_wrong_host = {
            "action": "deploy",
            "deployment_id": 103,
            "project_id": 1,
            "environment": "staging",
            "callback_url": "https://evil.attacker.com/api/deployments/103/provider_callback/",
        }
        body = json.dumps(payload_wrong_host).encode("utf-8")
        status_code, _ = self._post(
            "/hooks/deploy",
            body,
            headers={"Content-Type": "application/json", "X-TeamFlow-Signature": sign_body(body)},
        )
        self.assertEqual(status_code, 400)

        # Path mismatch
        payload_wrong_path = {
            "action": "deploy",
            "deployment_id": 103,
            "project_id": 1,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/wrong_id/provider_callback/",
        }
        body = json.dumps(payload_wrong_path).encode("utf-8")
        status_code, _ = self._post(
            "/hooks/deploy",
            body,
            headers={"Content-Type": "application/json", "X-TeamFlow-Signature": sign_body(body)},
        )
        self.assertEqual(status_code, 400)

    def test_duplicate_in_flight_id_returns_409(self):
        with self.receiver.in_flight_lock:
            self.receiver.in_flight_ids.add(200)

        payload = {
            "action": "deploy",
            "deployment_id": 200,
            "project_id": 1,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/200/provider_callback/",
        }
        body = json.dumps(payload).encode("utf-8")
        status_code, resp_body = self._post(
            "/hooks/deploy",
            body,
            headers={"Content-Type": "application/json", "X-TeamFlow-Signature": sign_body(body)},
        )
        self.assertEqual(status_code, 409)
        resp_data = json.loads(resp_body.decode("utf-8"))
        self.assertIn("already in flight", resp_data["detail"])


class TestDeployAndRollbackJobs(unittest.TestCase):
    def setUp(self):
        self.config = make_config(poll_interval_seconds=0.01, deploy_timeout_seconds=5)
        self.mock_client = MagicMock(spec=RailwayClient)
        self.callback_requests = []

        def fake_callback_transport(req):
            self.callback_requests.append(req)
            return MagicMock(status=200)

        self.fake_callback_transport = fake_callback_transport
        self.receiver = DeployReceiver(
            config=self.config,
            railway_client=self.mock_client,
            callback_transport=fake_callback_transport,
        )

    @patch("time.sleep", return_value=None)
    def test_deploy_success_with_commit_sha_from_meta(self, _mock_sleep):
        expected_sha = "c0ffee" * 6 + "abcd"  # 40 hex chars
        self.mock_client.service_instance_deploy.return_value = True
        self.mock_client.list_deployments.return_value = [
            {"id": "railway-dep-1", "status": "BUILDING", "createdAt": datetime.now(timezone.utc).isoformat()}
        ]
        self.mock_client.get_deployment.return_value = {
            "id": "railway-dep-1",
            "status": "SUCCESS",
            "url": "https://dep-1.up.railway.app",
            "meta": {"commitHash": expected_sha},
        }
        self.mock_client.get_build_logs.return_value = [{"timestamp": "2026-09-19T20:00:01Z", "message": "Built ok"}]
        self.mock_client.get_deployment_logs.return_value = [{"timestamp": "2026-09-19T20:00:05Z", "message": "App running"}]

        payload = {
            "action": "deploy",
            "deployment_id": 301,
            "project_id": 1,
            "environment": "staging",
            "branch": "main",
            "commit_sha": expected_sha,
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/301/provider_callback/",
        }
        self.receiver.run_job(payload)

        self.assertEqual(len(self.callback_requests), 1)
        cb_req = self.callback_requests[0]
        cb_body = json.loads(cb_req.data.decode("utf-8"))

        self.assertEqual(cb_body["status"], "success")
        self.assertEqual(cb_body.get("commit_sha"), expected_sha)
        self.assertIn("Railway Deployment: railway-dep-1", cb_body["logs"])
        self.assertIn("Built ok", cb_body["logs"])
        self.assertIn("App running", cb_body["logs"])

        # Check signature verification
        cb_sig = cb_req.headers["X-teamflow-signature"]
        expected_sig = sign_body(cb_req.data)
        self.assertEqual(cb_sig, expected_sig)

    @patch("time.sleep", return_value=None)
    def test_deploy_success_commit_sha_absent_when_meta_has_no_sha(self, _mock_sleep):
        self.mock_client.service_instance_deploy.return_value = True
        self.mock_client.list_deployments.return_value = [
            {"id": "railway-dep-2", "status": "BUILDING", "createdAt": datetime.now(timezone.utc).isoformat()}
        ]
        self.mock_client.get_deployment.return_value = {
            "id": "railway-dep-2",
            "status": "SUCCESS",
            "url": "https://dep-2.up.railway.app",
            "meta": {},  # no commit hash
        }
        self.mock_client.get_build_logs.return_value = []
        self.mock_client.get_deployment_logs.return_value = []

        payload = {
            "action": "deploy",
            "deployment_id": 302,
            "project_id": 1,
            "environment": "staging",
            "branch": "main",
            "commit_sha": "requested_sha_which_must_not_be_echoed",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/302/provider_callback/",
        }
        self.receiver.run_job(payload)

        self.assertEqual(len(self.callback_requests), 1)
        cb_body = json.loads(self.callback_requests[0].data.decode("utf-8"))
        self.assertEqual(cb_body["status"], "success")
        self.assertNotIn("commit_sha", cb_body)

    @patch("time.sleep", return_value=None)
    def test_deploy_success_with_different_commit_sha_adds_log_line(self, _mock_sleep):
        requested_sha = "1" * 40
        reported_sha = "2" * 40

        self.mock_client.service_instance_deploy.return_value = True
        self.mock_client.list_deployments.return_value = [
            {"id": "railway-dep-3", "status": "SUCCESS", "createdAt": datetime.now(timezone.utc).isoformat()}
        ]
        self.mock_client.get_deployment.return_value = {
            "id": "railway-dep-3",
            "status": "SUCCESS",
            "url": "https://dep-3.up.railway.app",
            "meta": {"commitHash": reported_sha},
        }

        payload = {
            "action": "deploy",
            "deployment_id": 303,
            "project_id": 1,
            "environment": "staging",
            "branch": "main",
            "commit_sha": requested_sha,
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/303/provider_callback/",
        }
        self.receiver.run_job(payload)

        self.assertEqual(len(self.callback_requests), 1)
        cb_body = json.loads(self.callback_requests[0].data.decode("utf-8"))
        self.assertEqual(cb_body["commit_sha"], reported_sha)
        self.assertIn("differs from requested commit", cb_body["logs"])

    @patch("time.sleep", return_value=None)
    def test_deploy_railway_failed_status(self, _mock_sleep):
        self.mock_client.service_instance_deploy.return_value = True
        self.mock_client.list_deployments.return_value = [
            {"id": "railway-dep-fail", "status": "FAILED", "createdAt": datetime.now(timezone.utc).isoformat()}
        ]
        self.mock_client.get_deployment.return_value = {
            "id": "railway-dep-fail",
            "status": "FAILED",
            "url": "",
            "meta": {},
        }
        self.mock_client.get_build_logs.return_value = [{"message": "Syntax error in build"}]
        self.mock_client.get_deployment_logs.return_value = []

        payload = {
            "action": "deploy",
            "deployment_id": 304,
            "project_id": 1,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/304/provider_callback/",
        }
        self.receiver.run_job(payload)

        self.assertEqual(len(self.callback_requests), 1)
        cb_body = json.loads(self.callback_requests[0].data.decode("utf-8"))
        self.assertEqual(cb_body["status"], "failed")
        self.assertIn("Status: FAILED", cb_body["logs"])
        self.assertIn("Syntax error in build", cb_body["logs"])

    @patch("time.sleep", return_value=None)
    def test_deploy_timeout_still_building(self, _mock_sleep):
        self.config.deploy_timeout_seconds = 1  # 1 second timeout

        self.mock_client.service_instance_deploy.return_value = True
        self.mock_client.list_deployments.return_value = [
            {"id": "railway-dep-slow", "status": "BUILDING", "createdAt": datetime.now(timezone.utc).isoformat()}
        ]
        self.mock_client.get_deployment.return_value = {
            "id": "railway-dep-slow",
            "status": "BUILDING",
            "url": "",
            "meta": {},
        }

        payload = {
            "action": "deploy",
            "deployment_id": 305,
            "project_id": 1,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/305/provider_callback/",
        }

        # Mock time.time to advance past timeout
        current_time = 1000.0

        def fake_time():
            nonlocal current_time
            current_time += 2.0
            return current_time

        with patch("time.time", side_effect=fake_time):
            self.receiver.run_job(payload)

        self.assertEqual(len(self.callback_requests), 1)
        cb_body = json.loads(self.callback_requests[0].data.decode("utf-8"))
        self.assertEqual(cb_body["status"], "failed")
        self.assertIn("timed out after", cb_body["logs"])
        self.assertIn("last Railway status BUILDING", cb_body["logs"])

    @patch("time.sleep", return_value=None)
    def test_no_deployment_appears_reports_failed(self, _mock_sleep):
        self.mock_client.service_instance_deploy.return_value = True
        self.mock_client.list_deployments.return_value = []  # No deployment found

        payload = {
            "action": "deploy",
            "deployment_id": 306,
            "project_id": 1,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/306/provider_callback/",
        }

        # Advance past 120s
        current_time = 1000.0

        def fake_time():
            nonlocal current_time
            current_time += 150.0
            return current_time

        with patch("time.time", side_effect=fake_time):
            self.receiver.run_job(payload)

        self.assertEqual(len(self.callback_requests), 1)
        cb_body = json.loads(self.callback_requests[0].data.decode("utf-8"))
        self.assertEqual(cb_body["status"], "failed")
        self.assertIn("Railway did not start a deployment", cb_body["logs"])

    @patch("time.sleep", return_value=None)
    def test_graphql_errors_reports_failed_with_message(self, _mock_sleep):
        self.mock_client.service_instance_deploy.side_effect = RailwayClientError("Query failed: unauthorized")

        payload = {
            "action": "deploy",
            "deployment_id": 307,
            "project_id": 1,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/307/provider_callback/",
        }
        self.receiver.run_job(payload)

        self.assertEqual(len(self.callback_requests), 1)
        cb_body = json.loads(self.callback_requests[0].data.decode("utf-8"))
        self.assertEqual(cb_body["status"], "failed")
        self.assertIn("Query failed: unauthorized", cb_body["logs"])

    @patch("time.sleep", return_value=None)
    def test_railway_token_in_graphql_error_never_appears_in_logs_or_callback(self, _mock_sleep):
        raw_token = "railway_secret_project_token_secret999"
        self.config.railway_project_token = raw_token
        self.receiver = DeployReceiver(
            config=self.config,
            railway_client=self.mock_client,
            callback_transport=self.fake_callback_transport,
        )

        self.mock_client.service_instance_deploy.side_effect = RailwayClientError(
            f"Access denied for token {raw_token}."
        )

        payload = {
            "action": "deploy",
            "deployment_id": 308,
            "project_id": 1,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/308/provider_callback/",
        }
        self.receiver.run_job(payload)

        self.assertEqual(len(self.callback_requests), 1)
        cb_body = json.loads(self.callback_requests[0].data.decode("utf-8"))
        self.assertEqual(cb_body["status"], "failed")
        self.assertNotIn(raw_token, cb_body["logs"])
        self.assertIn("[REDACTED]", cb_body["logs"])

    @patch("time.sleep", return_value=None)
    def test_rollback_no_earlier_success_reports_failed(self, _mock_sleep):
        # Only one deployment exists
        self.mock_client.list_deployments.return_value = [
            {"id": "dep-current", "status": "FAILED", "createdAt": "2026-09-19T20:00:00Z"}
        ]

        payload = {
            "action": "rollback",
            "deployment_id": 309,
            "project_id": 1,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/309/provider_callback/",
        }
        self.receiver.run_job(payload)

        self.assertEqual(len(self.callback_requests), 1)
        cb_body = json.loads(self.callback_requests[0].data.decode("utf-8"))
        self.assertEqual(cb_body["status"], "failed")
        self.assertIn("no earlier successful deployment to roll back to", cb_body["logs"])

    @patch("time.sleep", return_value=None)
    def test_rollback_success_reports_rolled_back(self, _mock_sleep):
        # Newest deployment is dep-current (index 0); older success is dep-old-success (index 1)
        self.mock_client.list_deployments.return_value = [
            {"id": "dep-current", "status": "FAILED", "createdAt": "2026-09-19T20:00:00Z"},
            {"id": "dep-old-success", "status": "SUCCESS", "createdAt": "2026-09-19T18:00:00Z"},
        ]
        self.mock_client.deployment_redeploy.return_value = {
            "id": "dep-redeploy-456",
            "status": "QUEUED",
        }
        self.mock_client.get_deployment.return_value = {
            "id": "dep-redeploy-456",
            "status": "SUCCESS",
            "url": "https://redeploy-456.up.railway.app",
            "meta": {"commitHash": "e" * 40},
        }

        payload = {
            "action": "rollback",
            "deployment_id": 310,
            "project_id": 1,
            "environment": "staging",
            "callback_url": f"{SAMPLE_BASE_URL}/api/deployments/310/provider_callback/",
        }
        self.receiver.run_job(payload)

        self.assertEqual(len(self.callback_requests), 1)
        cb_body = json.loads(self.callback_requests[0].data.decode("utf-8"))
        self.assertEqual(cb_body["status"], "rolled_back")
        self.assertEqual(cb_body.get("commit_sha"), "e" * 40)
        self.assertIn("Railway Deployment: dep-redeploy-456", cb_body["logs"])


class TestCallbackRetries(unittest.TestCase):
    @patch("time.sleep", return_value=None)
    def test_callback_5xx_retried_up_to_3_times_then_stops(self, _mock_sleep):
        call_count = 0

        def failing_transport(req):
            nonlocal call_count
            call_count += 1
            resp = MagicMock()
            resp.status = 502
            return resp

        success = send_callback(
            callback_url=f"{SAMPLE_BASE_URL}/api/deployments/1/provider_callback/",
            payload={"status": "success", "logs": "test"},
            secret=SAMPLE_SECRET,
            transport=failing_transport,
            max_retries=3,
        )
        self.assertFalse(success)
        # Initial attempt + 3 retries = 4 attempts total
        self.assertEqual(call_count, 4)

    @patch("time.sleep", return_value=None)
    def test_callback_409_not_retried(self, _mock_sleep):
        call_count = 0

        def conflict_transport(req):
            nonlocal call_count
            call_count += 1
            resp = MagicMock()
            resp.status = 409
            return resp

        success = send_callback(
            callback_url=f"{SAMPLE_BASE_URL}/api/deployments/1/provider_callback/",
            payload={"status": "success", "logs": "test"},
            secret=SAMPLE_SECRET,
            transport=conflict_transport,
            max_retries=3,
        )
        self.assertFalse(success)
        # Should not retry 409; stops immediately
        self.assertEqual(call_count, 1)


if __name__ == "__main__":
    unittest.main()
