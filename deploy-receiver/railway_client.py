"""Railway GraphQL API client using Python standard library only."""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any, Callable

logger = logging.getLogger(__name__)

DEFAULT_API_URL = "https://backboard.railway.com/graphql/v2"


class RailwayClientError(Exception):
    """Raised when Railway GraphQL API returns errors or HTTP fails."""


def sanitize_text(text: str, secrets: list[str] | None = None) -> str:
    """Scrub sensitive tokens and header patterns from text."""
    if not text:
        return ""
    sanitized = str(text)
    if secrets:
        for secret in secrets:
            if secret and len(secret) >= 4:
                sanitized = sanitized.replace(secret, "[REDACTED]")

    sanitized = re.sub(
        r"Project-Access-Token:\s*[^\s\r\n]+",
        "Project-Access-Token: [REDACTED]",
        sanitized,
        flags=re.IGNORECASE,
    )
    sanitized = re.sub(
        r"Authorization:\s*Bearer\s+[^\s\r\n]+",
        "Authorization: Bearer [REDACTED]",
        sanitized,
        flags=re.IGNORECASE,
    )
    sanitized = re.sub(
        r"Bearer\s+[a-zA-Z0-9_\-\.]{10,}",
        "Bearer [REDACTED]",
        sanitized,
        flags=re.IGNORECASE,
    )
    sanitized = re.sub(r"sha256=[0-9a-fA-F]{32,64}", "sha256=[REDACTED]", sanitized)
    return sanitized


def extract_commit_hash(meta: Any) -> str:
    """Extract a 40-character hex commit SHA from Railway's meta field (commitHash or commitSha)."""
    if not meta:
        return ""

    data = meta
    if isinstance(meta, str):
        try:
            data = json.loads(meta)
        except Exception:
            return ""

    if not isinstance(data, dict):
        return ""

    for key in ("commitHash", "commitSha"):
        val = data.get(key)
        if isinstance(val, str):
            val_str = val.strip()
            if len(val_str) == 40 and re.fullmatch(r"[0-9a-fA-F]{40}", val_str):
                return val_str.lower()

    return ""


class RailwayClient:
    """GraphQL client for Railway operations."""

    def __init__(
        self,
        api_url: str = DEFAULT_API_URL,
        project_token: str | None = None,
        api_token: str | None = None,
        transport: Callable[..., Any] | None = None,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.project_token = project_token
        self.api_token = api_token
        self.transport = transport
        self._secrets: list[str] = [s for s in (project_token, api_token) if s]

    def _sanitize(self, text: str) -> str:
        return sanitize_text(text, self._secrets)

    def execute(self, query: str, variables: dict | None = None) -> dict:
        """Execute a GraphQL query or mutation, returning data or raising RailwayClientError."""
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "TeamFlow-DeployReceiver/1.0",
        }
        if self.project_token:
            headers["Project-Access-Token"] = self.project_token
        elif self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"

        payload_bytes = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
        req = urllib.request.Request(self.api_url, data=payload_bytes, headers=headers, method="POST")

        try:
            if self.transport is not None:
                try:
                    res = self.transport(req)
                except TypeError:
                    res = self.transport(query, variables)

                if isinstance(res, dict):
                    parsed = res
                elif hasattr(res, "read"):
                    resp_body = res.read()
                    if isinstance(resp_body, bytes):
                        resp_body = resp_body.decode("utf-8")
                    parsed = json.loads(resp_body)
                elif isinstance(res, (bytes, str)):
                    if isinstance(res, bytes):
                        res = res.decode("utf-8")
                    parsed = json.loads(res)
                elif isinstance(res, tuple) and len(res) >= 2:
                    body = res[1]
                    if isinstance(body, bytes):
                        body = body.decode("utf-8")
                    parsed = json.loads(body)
                else:
                    raise RailwayClientError(f"Unexpected transport response: {type(res)}")
            else:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    resp_body = resp.read().decode("utf-8")
                    parsed = json.loads(resp_body)
        except urllib.error.HTTPError as exc:
            err_body = ""
            if hasattr(exc, "read"):
                try:
                    err_bytes = exc.read()
                    if isinstance(err_bytes, bytes):
                        err_body = err_bytes.decode("utf-8", errors="replace")
                    elif isinstance(err_bytes, str):
                        err_body = err_bytes
                except Exception:
                    pass
            sanitized = self._sanitize(f"Railway HTTP {exc.code}: {err_body or exc.reason}")
            raise RailwayClientError(sanitized) from exc
        except RailwayClientError:
            raise
        except Exception as exc:
            sanitized = self._sanitize(f"Railway connection error: {exc}")
            raise RailwayClientError(sanitized) from exc

        if isinstance(parsed, dict) and parsed.get("errors"):
            error_msgs = [e.get("message", str(e)) for e in parsed["errors"]]
            combined = "; ".join(error_msgs)
            sanitized = self._sanitize(f"Railway GraphQL error: {combined}")
            raise RailwayClientError(sanitized)

        if not isinstance(parsed, dict) or "data" not in parsed:
            raise RailwayClientError("Malformed GraphQL response: missing 'data' key")

        return parsed.get("data") or {}

    def service_instance_deploy(self, service_id: str, environment_id: str) -> Any:
        """Trigger a deploy of a service in an environment."""
        mutation = """
        mutation serviceInstanceDeploy($serviceId: String!, $environmentId: String!) {
            serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
        }
        """
        data = self.execute(mutation, {"serviceId": service_id, "environmentId": environment_id})
        return data.get("serviceInstanceDeploy")

    def deployment_redeploy(self, deployment_id: str) -> dict:
        """Redeploy an existing deployment."""
        mutation = """
        mutation deploymentRedeploy($id: String!) {
            deploymentRedeploy(id: $id) {
                id
                status
            }
        }
        """
        data = self.execute(mutation, {"id": deployment_id})
        return data.get("deploymentRedeploy") or {}

    def list_deployments(self, service_id: str, environment_id: str, first: int = 10) -> list[dict]:
        """List deployments for a service and environment."""
        query = """
        query deployments($input: DeploymentListInput!, $first: Int) {
            deployments(input: $input, first: $first) {
                edges {
                    node {
                        id
                        status
                        createdAt
                    }
                }
            }
        }
        """
        variables = {
            "input": {
                "serviceId": service_id,
                "environmentId": environment_id,
            },
            "first": first,
        }
        data = self.execute(query, variables)
        edges = data.get("deployments", {}).get("edges", [])
        nodes = []
        for edge in edges:
            if isinstance(edge, dict) and "node" in edge:
                nodes.append(edge["node"])
        return nodes

    def get_deployment(self, deployment_id: str) -> dict:
        """Fetch deployment details. Requests meta as optional extra, retrying without it if rejected."""
        query_with_meta = """
        query deployment($id: String!) {
            deployment(id: $id) {
                id
                status
                createdAt
                url
                meta
            }
        }
        """
        try:
            data = self.execute(query_with_meta, {"id": deployment_id})
            dep = data.get("deployment")
            if dep is not None:
                return dep
        except RailwayClientError as exc:
            logger.info("Railway deployment query with meta rejected, retrying without meta: %s", self._sanitize(str(exc)))

        query_without_meta = """
        query deployment($id: String!) {
            deployment(id: $id) {
                id
                status
                createdAt
                url
            }
        }
        """
        data = self.execute(query_without_meta, {"id": deployment_id})
        dep = data.get("deployment")
        if dep is None:
            raise RailwayClientError(f"Deployment {deployment_id} not found")
        return dep

    def get_build_logs(self, deployment_id: str, limit: int = 200) -> list[dict]:
        """Fetch build logs for a deployment."""
        query = """
        query buildLogs($deploymentId: String!, $limit: Int) {
            buildLogs(deploymentId: $deploymentId, limit: $limit) {
                timestamp
                message
                severity
            }
        }
        """
        try:
            data = self.execute(query, {"deploymentId": deployment_id, "limit": limit})
            return data.get("buildLogs") or []
        except Exception as exc:
            logger.warning("Failed to fetch build logs for %s: %s", deployment_id, self._sanitize(str(exc)))
            return []

    def get_deployment_logs(self, deployment_id: str, limit: int = 200) -> list[dict]:
        """Fetch runtime deployment logs for a deployment."""
        query = """
        query deploymentLogs($deploymentId: String!, $limit: Int) {
            deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
                timestamp
                message
                severity
            }
        }
        """
        try:
            data = self.execute(query, {"deploymentId": deployment_id, "limit": limit})
            return data.get("deploymentLogs") or []
        except Exception as exc:
            logger.warning("Failed to fetch deployment logs for %s: %s", deployment_id, self._sanitize(str(exc)))
            return []
