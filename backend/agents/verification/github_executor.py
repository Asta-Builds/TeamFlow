import logging
import subprocess
import time
from datetime import datetime
from typing import Any, List, Optional, Tuple

import requests
from django.conf import settings

from agents.git_service import sanitize_sensitive_data
from agents.tools.github_tool import _github_headers
from .result import StepResult, VerificationPlan, VerificationResult
from .workflow_template import WORKFLOW_PATH

logger = logging.getLogger(__name__)


def _map_step_conclusion(raw_concl: Optional[str]) -> str:
    c = (raw_concl or "").lower()
    if c == "success":
        return "success"
    if c == "failure":
        return "failure"
    if c == "skipped":
        return "skipped"
    if c == "cancelled":
        return "error"
    if c == "timed_out":
        return "timed_out"
    return "error"


def _parse_duration(started_at: Optional[str], completed_at: Optional[str]) -> float:
    if not started_at or not completed_at:
        return 0.0
    try:
        s = started_at.replace("Z", "+00:00")
        c = completed_at.replace("Z", "+00:00")
        dt_start = datetime.fromisoformat(s)
        dt_end = datetime.fromisoformat(c)
        return max(0.0, round((dt_end - dt_start).total_seconds(), 2))
    except Exception:
        return 0.0


def _event_priority(run_item: dict) -> int:
    event = run_item.get("event")
    if event == "push":
        return 0
    if event == "pull_request":
        return 1
    return 2


class GitHubActionsExecutor:
    name: str = "github_actions"

    def __init__(
        self,
        repo: str,
        token: str,
        workspace: str = "",
        ref: str = "HEAD",
        poll_interval: int = 10,
    ) -> None:
        self.repo = (repo or "").strip()
        self.token = (token or "").strip()
        self.workspace = workspace
        self.ref = ref
        self.poll_interval = poll_interval

    def _sanitize(self, text: Any) -> str:
        if text is None:
            return ""
        s = str(text)
        if self.token:
            s = s.replace(self.token, "***TOKEN***")
        return sanitize_sensitive_data(s)

    def _resolve_sha(self, workspace: str, ref: str) -> Optional[str]:
        try:
            res = subprocess.run(
                ["git", "-C", workspace, "rev-parse", ref],
                capture_output=True,
                text=True,
                check=False,
            )
            if res.returncode == 0:
                sha = res.stdout.strip()
                if sha:
                    return sha
            return None
        except Exception as exc:
            logger.warning(
                "Failed to resolve git ref %s in %s: %s",
                ref,
                workspace,
                self._sanitize(str(exc)),
            )
            return None

    def available(
        self,
        workspace: Optional[str] = None,
        ref: Optional[str] = None,
    ) -> Tuple[bool, str]:
        if not self.repo or not self.token:
            return (False, "no GitHub repository or token is configured for this project")

        ws = workspace or self.workspace
        if not ws:
            return (False, "no project workspace was given to the GitHub Actions executor")

        r = ref or self.ref or "HEAD"

        sha = self._resolve_sha(ws, r)
        if not sha:
            return (False, f"commit '{r}' could not be resolved locally")

        short_sha = sha[:7]
        api_base = getattr(settings, "GITHUB_API_URL", "https://api.github.com").rstrip("/")
        headers = _github_headers(self.token)

        try:
            commit_url = f"{api_base}/repos/{self.repo}/commits/{sha}"
            commit_resp = requests.get(commit_url, headers=headers, timeout=15)
            if commit_resp.status_code != 200:
                return (False, f"commit {short_sha} has not been pushed to {self.repo}")

            workflow_url = f"{api_base}/repos/{self.repo}/contents/{WORKFLOW_PATH}"
            wf_resp = requests.get(workflow_url, params={"ref": sha}, headers=headers, timeout=15)
            if wf_resp.status_code != 200:
                return (False, f"the repository has no TeamFlow verification workflow at {WORKFLOW_PATH}")

            return (True, "")
        except requests.RequestException as exc:
            return (False, self._sanitize(str(exc)))

    def run(
        self,
        workspace: str,
        plan: Optional[VerificationPlan] = None,
        *,
        ref: str = "HEAD",
        timeout: Optional[int] = None,
    ) -> VerificationResult:
        start_time = time.monotonic()
        effective_timeout = (
            timeout
            if timeout is not None
            else getattr(settings, "AGENT_VERIFY_TIMEOUT", 420)
        )
        output_limit = getattr(settings, "AGENT_VERIFY_OUTPUT_LIMIT", 20000)
        deadline = start_time + effective_timeout
        api_base = getattr(settings, "GITHUB_API_URL", "https://api.github.com").rstrip("/")
        headers = _github_headers(self.token)
        html_url = ""

        try:
            ws = workspace or self.workspace
            if not ws:
                return VerificationResult(
                    status="unverified",
                    executor=self.name,
                    reason="no project workspace was given to the GitHub Actions executor",
                    duration_s=round(time.monotonic() - start_time, 2),
                )

            r = ref or self.ref or "HEAD"
            logger.info("Starting GitHub Actions verification for %s at ref %s", self.repo, r)

            sha = self._resolve_sha(ws, r)
            if not sha:
                return VerificationResult(
                    status="unverified",
                    executor=self.name,
                    reason=f"cannot resolve git ref '{r}' in workspace",
                    duration_s=round(time.monotonic() - start_time, 2),
                )

            short_sha = sha[:7]

            # 1. Find the run
            discovery_deadline = min(deadline, start_time + 120)
            selected_run: Optional[dict] = None

            while time.monotonic() < discovery_deadline:
                runs_url = f"{api_base}/repos/{self.repo}/actions/runs"
                resp = requests.get(
                    runs_url,
                    params={"head_sha": sha, "per_page": 20},
                    headers=headers,
                    timeout=15,
                )
                resp.raise_for_status()
                workflow_runs = resp.json().get("workflow_runs", [])

                matching = [
                    run_item
                    for run_item in workflow_runs
                    if (run_item.get("path") or "").lstrip("/") == WORKFLOW_PATH.lstrip("/")
                ]
                if matching:
                    selected_run = min(matching, key=_event_priority)
                    break

                remaining_discovery = discovery_deadline - time.monotonic()
                if remaining_discovery <= 0:
                    break
                time.sleep(min(self.poll_interval, remaining_discovery))

            if not selected_run:
                return VerificationResult(
                    status="unverified",
                    executor=self.name,
                    reason=f"the verification workflow did not start for commit {short_sha}",
                    duration_s=round(time.monotonic() - start_time, 2),
                )

            run_id = selected_run.get("id")
            html_url = selected_run.get("html_url", "")
            last_status = selected_run.get("status", "unknown")
            run_data = selected_run
            logger.info("Found workflow run %s (status: %s)", run_id, last_status)

            # 2. Poll run until completed
            while run_data.get("status") != "completed":
                if time.monotonic() >= deadline:
                    return VerificationResult(
                        status="unverified",
                        executor=self.name,
                        reason=f"GitHub Actions run timed out with status '{last_status}'",
                        duration_s=round(time.monotonic() - start_time, 2),
                        details_url=html_url,
                    )

                remaining = deadline - time.monotonic()
                time.sleep(min(self.poll_interval, max(0.1, remaining)))

                run_url = f"{api_base}/repos/{self.repo}/actions/runs/{run_id}"
                resp = requests.get(run_url, headers=headers, timeout=15)
                resp.raise_for_status()
                run_data = resp.json()
                last_status = run_data.get("status", "unknown")
                html_url = run_data.get("html_url", html_url)

            logger.info("Workflow run %s completed with status %s", run_id, last_status)

            # 3. Fetch jobs and steps
            jobs_url = f"{api_base}/repos/{self.repo}/actions/runs/{run_id}/jobs"
            resp_jobs = requests.get(jobs_url, headers=headers, timeout=15)
            resp_jobs.raise_for_status()
            jobs = resp_jobs.json().get("jobs", [])

            all_steps: List[StepResult] = []
            for job in jobs:
                job_id = job.get("id")
                job_conclusion = (job.get("conclusion") or "").lower()
                raw_steps = job.get("steps", [])

                job_step_results: List[StepResult] = []
                first_failed_step: Optional[StepResult] = None

                for s in raw_steps:
                    step_name = self._sanitize(s.get("name") or "unnamed step")
                    raw_concl = s.get("conclusion")
                    step_concl = _map_step_conclusion(raw_concl)
                    duration_s = _parse_duration(s.get("started_at"), s.get("completed_at"))
                    sr = StepResult(
                        name=step_name,
                        command=step_name,
                        cwd=".",
                        exit_code=None,
                        conclusion=step_concl,
                        duration_s=duration_s,
                        output_tail="",
                    )
                    job_step_results.append(sr)
                    if step_concl == "failure" and first_failed_step is None:
                        first_failed_step = sr

                # 4. Fetch logs for failed job
                if job_conclusion == "failure" or first_failed_step is not None:
                    log_url = f"{api_base}/repos/{self.repo}/actions/jobs/{job_id}/logs"
                    try:
                        log_resp = requests.get(log_url, headers=headers, timeout=15)
                        if log_resp.status_code == 200:
                            sanitized_log = self._sanitize(log_resp.text)
                            tail = (
                                sanitized_log[-output_limit:]
                                if len(sanitized_log) > output_limit
                                else sanitized_log
                            )
                        else:
                            tail = self._sanitize(f"Failed to fetch job log: HTTP {log_resp.status_code}")
                    except Exception as log_exc:
                        tail = self._sanitize(f"Failed to fetch job log: {log_exc}")

                    if first_failed_step is not None:
                        first_failed_step.output_tail = tail
                    elif job_step_results:
                        job_step_results[0].output_tail = tail

                all_steps.extend(job_step_results)

            # 5. Map run conclusion
            run_conclusion = (run_data.get("conclusion") or "").lower()
            if run_conclusion == "success":
                status = "passed"
                reason = ""
            elif run_conclusion == "failure":
                status = "failed"
                failed_steps = [s for s in all_steps if s.conclusion not in ("success", "skipped")]
                if failed_steps:
                    step_names = ", ".join(s.name for s in failed_steps)
                    reason = f"GitHub Actions verification failed at step(s): {step_names}"
                else:
                    reason = "GitHub Actions verification failed"
            else:
                status = "unverified"
                concl_str = run_conclusion if run_conclusion else "missing"
                reason = f"GitHub Actions run concluded {concl_str}"

            return VerificationResult(
                status=status,
                executor=self.name,
                reason=reason,
                steps=all_steps,
                duration_s=round(time.monotonic() - start_time, 2),
                details_url=html_url,
            )

        except Exception as exc:
            duration_s = round(time.monotonic() - start_time, 2)
            sanitized_msg = self._sanitize(str(exc))
            return VerificationResult(
                status="unverified",
                executor=self.name,
                reason=f"GitHub Actions verification error: {sanitized_msg}",
                duration_s=duration_s,
                details_url=html_url,
            )
