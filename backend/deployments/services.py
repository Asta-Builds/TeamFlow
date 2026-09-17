"""Deployment orchestration shared by the REST API and the DevOps agent."""

from __future__ import annotations

from django.utils import timezone

from .models import Deployment
from .providers import DeploymentProviderNotConfigured, provider_configured, request_deployment

TERMINAL_STATUSES = {
    Deployment.Status.SUCCESS,
    Deployment.Status.FAILED,
    Deployment.Status.ROLLED_BACK,
    Deployment.Status.CANCELLED,
}
CALLBACK_STATUSES = {
    Deployment.Status.IN_PROGRESS,
    Deployment.Status.SUCCESS,
    Deployment.Status.FAILED,
    Deployment.Status.ROLLED_BACK,
    Deployment.Status.CANCELLED,
}


def _now_line(message: str) -> str:
    return f"[{timezone.now().strftime('%Y-%m-%d %H:%M:%SZ')}] {message}\n"


def start_deployment(
    *,
    project,
    environment: str,
    branch: str,
    commit_sha: str,
    actor,
    organization,
    action: str = "deploy",
    deployment: Deployment | None = None,
) -> Deployment:
    """
    Record a deployment request and hand it to the configured provider.

    Raises ``DeploymentProviderNotConfigured`` before anything is written when the
    environment has no provider. The returned record is ``in_progress`` when the
    provider accepted the request and ``failed`` when it did not.
    """
    if not provider_configured(environment):
        raise DeploymentProviderNotConfigured(
            f"No deployment provider is configured for the '{environment}' environment."
        )

    actor_label = getattr(actor, "name", "") or getattr(actor, "email", "") or "TeamFlow"
    if deployment is None:
        deployment = Deployment.objects.create(
            project=project,
            environment=environment,
            branch=branch or "main",
            commit_sha=commit_sha or "",
            triggered_by=actor,
            organization=organization,
            status=Deployment.Status.QUEUED,
        )
    else:
        deployment.status = Deployment.Status.QUEUED

    deployment.logs = (deployment.logs or "") + _now_line(
        f"{action.capitalize()} of {deployment.branch}"
        f"{' @ ' + deployment.commit_sha if deployment.commit_sha else ''}"
        f" to {environment} requested by {actor_label}."
    )

    result = request_deployment(deployment, action=action)
    if result.accepted:
        deployment.status = Deployment.Status.IN_PROGRESS
        deployment.logs += _now_line(
            f"Deployment provider accepted the request (HTTP {result.status_code}). "
            "Waiting for the provider to report the outcome."
        )
    else:
        deployment.status = Deployment.Status.FAILED
        deployment.finished_at = timezone.now()
        reason = f"HTTP {result.status_code}" if result.status_code else "no response"
        deployment.logs += _now_line(f"Deployment provider rejected the request ({reason}). {result.detail}".strip())
    deployment.save(update_fields=["status", "logs", "finished_at", "branch", "commit_sha"])
    return deployment


def apply_provider_callback(deployment: Deployment, payload: dict) -> Deployment:
    """Apply a signed status report from the deployment provider."""
    new_status = str(payload.get("status", "")).strip()
    if new_status not in CALLBACK_STATUSES:
        raise ValueError(f"Unsupported deployment status: {new_status!r}")
    if deployment.status in TERMINAL_STATUSES:
        raise ValueError("Deployment already reached a final status.")

    deployment.status = new_status
    commit_sha = str(payload.get("commit_sha", "")).strip()[:40]
    if commit_sha:
        deployment.commit_sha = commit_sha
    logs = str(payload.get("logs", "")).strip()
    if logs:
        deployment.logs = (deployment.logs or "") + logs[:20000] + "\n"
    deployment.logs = (deployment.logs or "") + _now_line(f"Provider reported status '{new_status}'.")
    if new_status in TERMINAL_STATUSES:
        deployment.finished_at = timezone.now()
        deployment.duration_seconds = max(0, int((deployment.finished_at - deployment.started_at).total_seconds()))
    deployment.save(update_fields=["status", "commit_sha", "logs", "finished_at", "duration_seconds"])
    return deployment
