"""
Deployment execution providers.

TeamFlow does not build or run containers itself. A deployment is handed to an
external deploy hook (for example a Render/Railway deploy hook, a GitHub Actions
``repository_dispatch`` relay, or an internal release service). TeamFlow records
only what the provider reports and never invents build, test, or health results.

Configuration (environment variables, read in ``teamflow.settings``):

- ``DEPLOY_HOOK_URL_<ENVIRONMENT>`` (``DEV``, ``STAGING``, ``PRODUCTION``): hook URL per environment.
- ``DEPLOY_HOOK_SECRET``: shared secret. Requests to the hook and provider callbacks
  are signed with HMAC-SHA256 in the ``X-TeamFlow-Signature: sha256=<hex>`` header.
- ``DEPLOY_CALLBACK_BASE_URL``: public base URL the provider uses to report status,
  e.g. ``https://teamflow.example.com``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from dataclasses import dataclass

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

SIGNATURE_HEADER = "X-TeamFlow-Signature"


class DeploymentProviderError(Exception):
    """Base error for deployment provider failures."""


class DeploymentProviderNotConfigured(DeploymentProviderError):
    """Raised when no deploy hook exists for the requested environment."""


@dataclass
class ProviderResponse:
    accepted: bool
    status_code: int
    detail: str


def hook_url_for(environment: str) -> str:
    urls = getattr(settings, "DEPLOY_HOOK_URLS", {}) or {}
    return (urls.get(environment) or "").strip()


def provider_configured(environment: str) -> bool:
    return bool(hook_url_for(environment))


def _secret() -> bytes:
    return (getattr(settings, "DEPLOY_HOOK_SECRET", "") or "").encode("utf-8")


def sign_payload(body: bytes) -> str:
    return "sha256=" + hmac.new(_secret(), body, hashlib.sha256).hexdigest()


def verify_signature(body: bytes, signature: str) -> bool:
    """Constant-time check of a provider callback signature. Fails closed without a secret."""
    if not _secret() or not signature:
        return False
    return hmac.compare_digest(sign_payload(body), signature.strip())


def callback_url_for(deployment_id: int) -> str:
    base = (getattr(settings, "DEPLOY_CALLBACK_BASE_URL", "") or "").rstrip("/")
    if not base:
        return ""
    return f"{base}/api/deployments/{deployment_id}/provider_callback/"


def request_deployment(deployment, action: str = "deploy") -> ProviderResponse:
    """Send a deployment or rollback request to the environment's deploy hook."""
    url = hook_url_for(deployment.environment)
    if not url:
        raise DeploymentProviderNotConfigured(
            f"No deployment provider is configured for the '{deployment.environment}' environment."
        )

    payload = {
        "action": action,
        "deployment_id": deployment.id,
        "project_id": deployment.project_id,
        "project": deployment.project.name,
        "github_repo": getattr(deployment.project, "github_repo", "") or "",
        "environment": deployment.environment,
        "branch": deployment.branch,
        "commit_sha": deployment.commit_sha,
        "callback_url": callback_url_for(deployment.id),
    }
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "TeamFlow-Deployments/1.0"}
    if _secret():
        headers[SIGNATURE_HEADER] = sign_payload(body)

    timeout = getattr(settings, "DEPLOY_HOOK_TIMEOUT_SECONDS", 15)
    try:
        response = requests.post(url, data=body, headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        logger.warning("Deploy hook request failed for deployment %s: %s", deployment.id, exc)
        return ProviderResponse(accepted=False, status_code=0, detail=f"Deploy hook unreachable: {exc.__class__.__name__}")

    accepted = 200 <= response.status_code < 300
    detail = (response.text or "").strip()[:500]
    return ProviderResponse(accepted=accepted, status_code=response.status_code, detail=detail)
