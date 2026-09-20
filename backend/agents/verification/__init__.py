import logging
import time
from typing import Optional, Sequence

from django.conf import settings
from agents.git_service import sanitize_sensitive_data
from .docker_executor import DockerExecutor
from .result import PlanStep, StepResult, VerificationPlan, VerificationResult
from .static import run_static_checks
from .toolchain import detect_plan

logger = logging.getLogger(__name__)


def _docker_executor() -> DockerExecutor:
    return DockerExecutor()


def _github_executor(repo: str, token: str, workspace: str, ref: str):
    from .github_executor import GitHubActionsExecutor
    return GitHubActionsExecutor(repo=repo, token=token, workspace=workspace, ref=ref)


def _finish(result: VerificationResult, start_time: float) -> VerificationResult:
    result.duration_s = round(time.time() - start_time, 3)
    logger.info(
        "Verification finished: executor=%s status=%s duration=%.3fs",
        result.executor,
        result.status,
        result.duration_s,
    )
    return result


def verify_workspace(
    workspace: str,
    files_modified: Sequence[str],
    *,
    ref: str = "HEAD",
    repo: str = "",
    token: str = "",
    timeout: Optional[int] = None,
) -> VerificationResult:
    start_time = time.time()

    # 1. files_modified empty -> failed, executor "none", reason "nothing was produced to verify"
    if not files_modified:
        return _finish(
            VerificationResult(
                status="failed",
                executor="none",
                reason="nothing was produced to verify",
            ),
            start_time,
        )

    # 2. run_static_checks(workspace); if failed, return it.
    static_result = run_static_checks(workspace)
    if static_result.status == "failed":
        return _finish(static_result, start_time)

    # 3. plan = detect_plan(workspace)
    plan = detect_plan(workspace)
    if plan.errors:
        return _finish(
            VerificationResult(
                status="failed",
                executor="static",
                reason="; ".join(plan.errors),
            ),
            start_time,
        )

    if plan.empty:
        return _finish(
            VerificationResult(
                status="unverified",
                executor="static",
                reason="no build toolchain was detected; static checks cannot approve code",
            ),
            start_time,
        )

    # 4. Choose executor from AGENT_VERIFY_EXECUTOR
    configured_executor = getattr(settings, "AGENT_VERIFY_EXECUTOR", "auto")
    effective_timeout = timeout if timeout is not None else getattr(settings, "AGENT_VERIFY_TIMEOUT", 420)
    chosen_executor = None

    if configured_executor == "none":
        return _finish(
            VerificationResult(
                status="unverified",
                executor="none",
                reason="verification is disabled (AGENT_VERIFY_EXECUTOR=none)",
            ),
            start_time,
        )

    elif configured_executor == "github_actions":
        if not repo or not token:
            return _finish(
                VerificationResult(
                    status="unverified",
                    executor="github_actions",
                    reason="github repo and token required for github_actions executor",
                ),
                start_time,
            )
        gh = _github_executor(repo, token, workspace, ref)
        avail, reason = gh.available()
        if not avail:
            return _finish(
                VerificationResult(
                    status="unverified",
                    executor="github_actions",
                    reason=reason,
                ),
                start_time,
            )
        chosen_executor = gh

    elif configured_executor == "docker":
        dock = _docker_executor()
        avail, reason = dock.available()
        if not avail:
            return _finish(
                VerificationResult(
                    status="unverified",
                    executor="docker",
                    reason=reason,
                ),
                start_time,
            )
        chosen_executor = dock

    elif configured_executor == "auto":
        gh_reason = ""
        dock_reason = ""

        if repo and token:
            try:
                gh = _github_executor(repo, token, workspace, ref)
                gh_avail, gh_reason = gh.available()
                if gh_avail:
                    chosen_executor = gh
            except Exception as exc:
                gh_reason = f"github actions unavailable: {sanitize_sensitive_data(exc)}"
        else:
            gh_reason = "github repo or token not configured"

        if chosen_executor is None:
            try:
                dock = _docker_executor()
                dock_avail, dock_reason = dock.available()
                if dock_avail:
                    chosen_executor = dock
            except Exception as exc:
                dock_reason = f"docker unavailable: {sanitize_sensitive_data(exc)}"

        if chosen_executor is None:
            return _finish(
                VerificationResult(
                    status="unverified",
                    executor="none",
                    reason=f"no verification environment: {gh_reason}; {dock_reason}",
                ),
                start_time,
            )

    else:
        return _finish(
            VerificationResult(
                status="unverified",
                executor="none",
                reason=f"unknown executor: {configured_executor}",
            ),
            start_time,
        )

    # 5. executor.run(...)
    try:
        result = chosen_executor.run(workspace, plan, ref=ref, timeout=effective_timeout)
    except Exception as exc:
        logger.warning("Verification executor failed: %s", exc, exc_info=True)
        result = VerificationResult(
            status="unverified",
            executor=chosen_executor.name,
            reason=f"executor error: {sanitize_sensitive_data(exc)}",
        )

    return _finish(result, start_time)


__all__ = [
    "verify_workspace",
    "VerificationResult",
    "StepResult",
    "VerificationPlan",
    "PlanStep",
    "detect_plan",
]
