import json
import os
import sys
import unittest
import urllib.error
import urllib.request
from pathlib import Path

# Ensure deploy-receiver root is in sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from railway_client import (
    RailwayClient,
    RailwayClientError,
    extract_commit_hash,
    sanitize_text,
)


class TestRailwayClient(unittest.TestCase):
    def test_client_headers_with_project_token(self):
        captured_headers = {}

        def fake_transport(req):
            nonlocal captured_headers
            captured_headers = dict(req.headers)
            return {"data": {"test": True}}

        client = RailwayClient(
            api_url="https://fake.railway.internal/graphql",
            project_token="proj_token_1234567890",
            transport=fake_transport,
        )
        res = client.execute("query { test }")
        self.assertEqual(res, {"test": True})
        self.assertEqual(captured_headers.get("Project-access-token"), "proj_token_1234567890")
        self.assertNotIn("Authorization", captured_headers)

    def test_client_headers_with_api_token(self):
        captured_headers = {}

        def fake_transport(req):
            nonlocal captured_headers
            captured_headers = dict(req.headers)
            return {"data": {"test": True}}

        client = RailwayClient(
            api_url="https://fake.railway.internal/graphql",
            api_token="api_token_1234567890",
            transport=fake_transport,
        )
        res = client.execute("query { test }")
        self.assertEqual(res, {"test": True})
        self.assertEqual(captured_headers.get("Authorization"), "Bearer api_token_1234567890")
        self.assertNotIn("Project-access-token", captured_headers)

    def test_project_token_preferred_over_api_token(self):
        captured_headers = {}

        def fake_transport(req):
            nonlocal captured_headers
            captured_headers = dict(req.headers)
            return {"data": {"test": True}}

        client = RailwayClient(
            project_token="proj_token_preferred",
            api_token="api_token_ignored",
            transport=fake_transport,
        )
        client.execute("query { test }")
        self.assertEqual(captured_headers.get("Project-access-token"), "proj_token_preferred")
        self.assertNotIn("Authorization", captured_headers)

    def test_service_instance_deploy(self):
        recorded = {}

        def fake_transport(req):
            body = json.loads(req.data.decode("utf-8"))
            recorded["query"] = body["query"]
            recorded["variables"] = body["variables"]
            return {"data": {"serviceInstanceDeploy": True}}

        client = RailwayClient(project_token="tok_1234567890", transport=fake_transport)
        result = client.service_instance_deploy(service_id="srv-1", environment_id="env-1")
        self.assertTrue(result)
        self.assertIn("mutation serviceInstanceDeploy", recorded["query"])
        self.assertEqual(recorded["variables"], {"serviceId": "srv-1", "environmentId": "env-1"})

    def test_deployment_redeploy(self):
        recorded = {}

        def fake_transport(req):
            body = json.loads(req.data.decode("utf-8"))
            recorded["query"] = body["query"]
            recorded["variables"] = body["variables"]
            return {"data": {"deploymentRedeploy": {"id": "dep-redeploy-1", "status": "QUEUED"}}}

        client = RailwayClient(project_token="tok_1234567890", transport=fake_transport)
        result = client.deployment_redeploy("dep-orig-1")
        self.assertEqual(result, {"id": "dep-redeploy-1", "status": "QUEUED"})
        self.assertIn("mutation deploymentRedeploy", recorded["query"])
        self.assertEqual(recorded["variables"], {"id": "dep-orig-1"})

    def test_list_deployments(self):
        recorded = {}

        def fake_transport(req):
            body = json.loads(req.data.decode("utf-8"))
            recorded["variables"] = body["variables"]
            return {
                "data": {
                    "deployments": {
                        "edges": [
                            {"node": {"id": "dep-1", "status": "SUCCESS", "createdAt": "2026-09-19T20:00:00Z"}},
                            {"node": {"id": "dep-2", "status": "FAILED", "createdAt": "2026-09-19T19:00:00Z"}},
                        ]
                    }
                }
            }

        client = RailwayClient(project_token="tok_1234567890", transport=fake_transport)
        nodes = client.list_deployments("srv-1", "env-1", first=10)
        self.assertEqual(len(nodes), 2)
        self.assertEqual(nodes[0]["id"], "dep-1")
        self.assertEqual(nodes[1]["id"], "dep-2")
        self.assertEqual(recorded["variables"]["input"], {"serviceId": "srv-1", "environmentId": "env-1"})
        self.assertEqual(recorded["variables"]["first"], 10)

    def test_get_deployment_with_meta_success(self):
        def fake_transport(req):
            body = json.loads(req.data.decode("utf-8"))
            self.assertIn("meta", body["query"])
            return {
                "data": {
                    "deployment": {
                        "id": "dep-1",
                        "status": "SUCCESS",
                        "createdAt": "2026-09-19T20:00:00Z",
                        "url": "https://dep-1.up.railway.app",
                        "meta": {"commitHash": "a" * 40},
                    }
                }
            }

        client = RailwayClient(project_token="tok_1234567890", transport=fake_transport)
        dep = client.get_deployment("dep-1")
        self.assertEqual(dep["id"], "dep-1")
        self.assertEqual(dep["status"], "SUCCESS")
        self.assertEqual(dep["meta"], {"commitHash": "a" * 40})

    def test_get_deployment_meta_rejected_retry_without_meta(self):
        queries_received = []

        def fake_transport(req):
            body = json.loads(req.data.decode("utf-8"))
            q = body["query"]
            queries_received.append(q)
            if "meta" in q:
                return {"errors": [{"message": "Cannot query field 'meta' on type 'Deployment'."}]}
            return {
                "data": {
                    "deployment": {
                        "id": "dep-1",
                        "status": "SUCCESS",
                        "createdAt": "2026-09-19T20:00:00Z",
                        "url": "https://dep-1.up.railway.app",
                    }
                }
            }

        client = RailwayClient(project_token="tok_1234567890", transport=fake_transport)
        dep = client.get_deployment("dep-1")
        self.assertEqual(dep["id"], "dep-1")
        self.assertEqual(dep["status"], "SUCCESS")
        self.assertNotIn("meta", dep)
        self.assertEqual(len(queries_received), 2)
        self.assertIn("meta", queries_received[0])
        self.assertNotIn("meta", queries_received[1])

    def test_get_build_and_deployment_logs(self):
        def fake_transport(req):
            body = json.loads(req.data.decode("utf-8"))
            q = body["query"]
            if "buildLogs" in q:
                return {
                    "data": {
                        "buildLogs": [
                            {"timestamp": "2026-09-19T20:00:01Z", "message": "Building image...", "severity": "info"}
                        ]
                    }
                }
            if "deploymentLogs" in q:
                return {
                    "data": {
                        "deploymentLogs": [
                            {"timestamp": "2026-09-19T20:00:05Z", "message": "Server started", "severity": "info"}
                        ]
                    }
                }
            return {"data": {}}

        client = RailwayClient(project_token="tok_1234567890", transport=fake_transport)
        build_logs = client.get_build_logs("dep-1")
        self.assertEqual(len(build_logs), 1)
        self.assertEqual(build_logs[0]["message"], "Building image...")

        deploy_logs = client.get_deployment_logs("dep-1")
        self.assertEqual(len(deploy_logs), 1)
        self.assertEqual(deploy_logs[0]["message"], "Server started")

    def test_graphql_errors_raised_and_sanitized(self):
        secret_token = "secret_project_token_xyz999"

        def fake_transport(req):
            return {
                "errors": [
                    {"message": f"Authentication failed for token {secret_token}. Access denied."}
                ]
            }

        client = RailwayClient(project_token=secret_token, transport=fake_transport)
        with self.assertRaises(RailwayClientError) as ctx:
            client.execute("query { viewer { id } }")

        err_msg = str(ctx.exception)
        self.assertNotIn(secret_token, err_msg)
        self.assertIn("[REDACTED]", err_msg)

    def test_http_error_raised_and_sanitized(self):
        secret_token = "secret_project_token_abc888"

        def fake_transport(req):
            err_fp = urllib.error.HTTPError(
                url="https://backboard.railway.com/graphql/v2",
                code=401,
                msg="Unauthorized",
                hdrs={},
                fp=None,
            )
            # Override read
            err_fp.read = lambda: f"Invalid token {secret_token}".encode("utf-8")
            raise err_fp

        client = RailwayClient(project_token=secret_token, transport=fake_transport)
        with self.assertRaises(RailwayClientError) as ctx:
            client.execute("query { viewer { id } }")

        err_msg = str(ctx.exception)
        self.assertNotIn(secret_token, err_msg)
        self.assertIn("[REDACTED]", err_msg)

    def test_extract_commit_hash(self):
        valid_sha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"

        # Explicit keys allowed
        self.assertEqual(extract_commit_hash({"commitHash": valid_sha}), valid_sha)
        self.assertEqual(extract_commit_hash({"commitSha": valid_sha}), valid_sha)
        self.assertEqual(extract_commit_hash(json.dumps({"commitHash": valid_sha})), valid_sha)
        self.assertEqual(extract_commit_hash(json.dumps({"commitSha": valid_sha})), valid_sha)

        # Unrelated keys must yield ""
        self.assertEqual(extract_commit_hash({"configHash": valid_sha}), "")
        self.assertEqual(extract_commit_hash({"commit": valid_sha}), "")
        self.assertEqual(extract_commit_hash({"sha": valid_sha}), "")
        self.assertEqual(extract_commit_hash({"hash": valid_sha}), "")
        self.assertEqual(extract_commit_hash({"commit": {"hash": valid_sha}}), "")
        self.assertEqual(extract_commit_hash(valid_sha), "")
        self.assertEqual(extract_commit_hash({"commitHash": "short"}), "")
        self.assertEqual(extract_commit_hash({"other": "not_a_sha"}), "")
        self.assertEqual(extract_commit_hash(None), "")
        self.assertEqual(extract_commit_hash({}), "")


if __name__ == "__main__":
    unittest.main()
