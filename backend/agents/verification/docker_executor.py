import io
import logging
import os
import shutil
import subprocess
import tarfile
import tempfile
import time
import uuid
from pathlib import Path
from typing import List, Tuple

from django.conf import settings
from agents.git_service import sanitize_sensitive_data
from .result import PlanStep, StepResult, VerificationPlan, VerificationResult

logger = logging.getLogger(__name__)


def safe_extract_tar(tar: tarfile.TarFile, target_dir: str) -> None:
    for member in tar.getmembers():
        name = member.name
        if os.path.isabs(name) or name.startswith("/") or name.startswith("\\"):
            raise ValueError(f"Unsafe tar member path (absolute): {name}")
        parts = Path(name).parts
        if ".." in parts:
            raise ValueError(f"Unsafe tar member path (parent traversal): {name}")
        if member.issym() or member.islnk():
            linkname = member.linkname or ""
            if os.path.isabs(linkname) or linkname.startswith("/") or linkname.startswith("\\"):
                raise ValueError(f"Unsafe tar link target (absolute): {linkname}")
            if ".." in Path(linkname).parts:
                raise ValueError(f"Unsafe tar link target (parent traversal): {linkname}")

    if hasattr(tarfile, "data_filter"):
        tar.extractall(path=target_dir, filter="data")
    else:
        for member in tar.getmembers():
            if member.issym() or member.islnk():
                raise ValueError(f"Unsafe tar link member in fallback extractor: {member.name}")
        tar.extractall(path=target_dir)


def _make_writable(directory: str) -> None:
    try:
        os.chmod(directory, 0o777)
    except OSError:
        pass
    for root, dirs, files in os.walk(directory):
        for d in dirs:
            try:
                os.chmod(os.path.join(root, d), 0o777)
            except OSError:
                pass
        for f in files:
            p = os.path.join(root, f)
            try:
                st = os.stat(p)
                mode = 0o777 if (st.st_mode & 0o111) else 0o666
                os.chmod(p, mode)
            except OSError:
                pass


class DockerExecutor:
    name: str = "docker"

    def available(self) -> Tuple[bool, str]:
        if not shutil.which("docker"):
            return (False, "docker executable not found")
        try:
            proc = subprocess.run(
                ["docker", "info"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if proc.returncode != 0:
                err = sanitize_sensitive_data(proc.stderr.strip() or proc.stdout.strip())
                return (False, f"docker info failed with exit code {proc.returncode}: {err}")
            return (True, "")
        except subprocess.TimeoutExpired:
            return (False, "docker info timed out after 10s")
        except Exception as exc:
            return (False, f"docker check failed: {sanitize_sensitive_data(exc)}")

    def run(
        self,
        workspace: str,
        plan: VerificationPlan,
        *,
        ref: str = "HEAD",
        timeout: int = 420,
    ) -> VerificationResult:
        start_time = time.time()
        deadline = start_time + timeout
        steps: List[StepResult] = []

        output_limit = getattr(settings, "AGENT_VERIFY_OUTPUT_LIMIT", 20000)
        node_image = getattr(settings, "AGENT_VERIFY_NODE_IMAGE", "node:22-bookworm-slim")
        python_image = getattr(settings, "AGENT_VERIFY_PYTHON_IMAGE", "python:3.12-slim")
        cpus = getattr(settings, "AGENT_VERIFY_DOCKER_CPUS", "2")
        memory = getattr(settings, "AGENT_VERIFY_DOCKER_MEMORY", "2g")

        temp_dir = None
        try:
            temp_dir = tempfile.mkdtemp(prefix="teamflow-verify-")
            # 1. Export git archive
            try:
                archive_proc = subprocess.run(
                    ["git", "-C", workspace, "archive", "--format=tar", ref],
                    capture_output=True,
                    timeout=30,
                )
            except subprocess.TimeoutExpired:
                return VerificationResult(
                    status="unverified",
                    executor="docker",
                    reason="git archive timed out",
                    duration_s=round(time.time() - start_time, 3),
                )
            except Exception as exc:
                return VerificationResult(
                    status="unverified",
                    executor="docker",
                    reason=f"git archive failed: {sanitize_sensitive_data(exc)}",
                    duration_s=round(time.time() - start_time, 3),
                )

            if archive_proc.returncode != 0:
                err_text = archive_proc.stderr.decode("utf-8", errors="replace").strip()
                return VerificationResult(
                    status="unverified",
                    executor="docker",
                    reason=f"git archive failed: {sanitize_sensitive_data(err_text)}",
                    duration_s=round(time.time() - start_time, 3),
                )

            # 2. Extract tar into temp_dir
            try:
                with tarfile.open(fileobj=io.BytesIO(archive_proc.stdout), mode="r:*") as tar:
                    safe_extract_tar(tar, temp_dir)
            except ValueError as v_err:
                return VerificationResult(
                    status="unverified",
                    executor="docker",
                    reason=f"tar extraction rejected: {v_err}",
                    duration_s=round(time.time() - start_time, 3),
                )
            except Exception as tar_err:
                return VerificationResult(
                    status="unverified",
                    executor="docker",
                    reason=f"tar extraction failed: {sanitize_sensitive_data(tar_err)}",
                    duration_s=round(time.time() - start_time, 3),
                )

            # 3. Make copy writable
            _make_writable(temp_dir)

            # 4. Execute steps
            for step in plan.steps:
                remaining = deadline - time.time()
                if remaining <= 0:
                    step_res = StepResult(
                        name=step.name,
                        command=" ".join(step.argv),
                        cwd=step.cwd,
                        exit_code=None,
                        conclusion="timed_out",
                        duration_s=0.0,
                        output_tail="Step timed out (verification budget exhausted)",
                    )
                    steps.append(step_res)
                    return VerificationResult(
                        status="unverified",
                        executor="docker",
                        reason=f"{step.name} timed out",
                        steps=steps,
                        duration_s=round(time.time() - start_time, 3),
                    )

                container_name = f"teamflow-verify-{uuid.uuid4().hex}"
                image = node_image if step.toolchain == "node" else python_image
                work_dir = "/work" if step.cwd in (".", "") else f"/work/{step.cwd.lstrip('/')}"

                cmd = [
                    "docker",
                    "run",
                    "--rm",
                    "--name",
                    container_name,
                    "--user",
                    "1000:1000",
                    "--cap-drop",
                    "ALL",
                    "--security-opt",
                    "no-new-privileges",
                    "--pids-limit",
                    "512",
                    "--cpus",
                    str(cpus),
                    "--memory",
                    str(memory),
                    "--read-only",
                    "--tmpfs",
                    "/tmp:rw,exec,size=512m",
                ]
                if step.phase == "check":
                    cmd.extend(["--network", "none"])

                cmd.extend([
                    "-e",
                    "HOME=/tmp",
                    "-e",
                    "CI=true",
                    "-e",
                    "npm_config_cache=/tmp/.npm",
                    "-v",
                    f"{temp_dir}:/work",
                    "-w",
                    work_dir,
                    image,
                ])
                cmd.extend(step.argv)

                step_start = time.time()
                try:
                    proc = subprocess.run(
                        cmd,
                        capture_output=True,
                        text=True,
                        timeout=max(1.0, remaining),
                        errors="replace",
                    )
                    step_duration = time.time() - step_start
                except subprocess.TimeoutExpired as texc:
                    step_duration = time.time() - step_start
                    try:
                        subprocess.run(["docker", "kill", container_name], capture_output=True, timeout=5)
                    except Exception:
                        pass

                    out = ""
                    if texc.stdout:
                        out += texc.stdout if isinstance(texc.stdout, str) else texc.stdout.decode("utf-8", errors="replace")
                    if texc.stderr:
                        out += texc.stderr if isinstance(texc.stderr, str) else texc.stderr.decode("utf-8", errors="replace")
                    tail = out[-output_limit:] if len(out) > output_limit else out
                    step_res = StepResult(
                        name=step.name,
                        command=" ".join(step.argv),
                        cwd=step.cwd,
                        exit_code=None,
                        conclusion="timed_out",
                        duration_s=round(step_duration, 3),
                        output_tail=sanitize_sensitive_data(tail),
                    )
                    steps.append(step_res)
                    return VerificationResult(
                        status="unverified",
                        executor="docker",
                        reason=f"{step.name} timed out",
                        steps=steps,
                        duration_s=round(time.time() - start_time, 3),
                    )

                combined = (proc.stdout or "") + (proc.stderr or "")
                tail = combined[-output_limit:] if len(combined) > output_limit else combined
                sanitized_tail = sanitize_sensitive_data(tail)

                if proc.returncode != 0:
                    if proc.returncode in (125, 126, 127):
                        step_res = StepResult(
                            name=step.name,
                            command=" ".join(step.argv),
                            cwd=step.cwd,
                            exit_code=proc.returncode,
                            conclusion="error",
                            duration_s=round(step_duration, 3),
                            output_tail=sanitized_tail,
                        )
                        steps.append(step_res)
                        return VerificationResult(
                            status="unverified",
                            executor="docker",
                            reason=f"the container could not run {step.name} (docker exit {proc.returncode})",
                            steps=steps,
                            duration_s=round(time.time() - start_time, 3),
                        )

                    step_res = StepResult(
                        name=step.name,
                        command=" ".join(step.argv),
                        cwd=step.cwd,
                        exit_code=proc.returncode,
                        conclusion="failure",
                        duration_s=round(step_duration, 3),
                        output_tail=sanitized_tail,
                    )
                    steps.append(step_res)
                    return VerificationResult(
                        status="failed",
                        executor="docker",
                        reason=f"{step.name} exited with code {proc.returncode}",
                        steps=steps,
                        duration_s=round(time.time() - start_time, 3),
                    )

                step_res = StepResult(
                    name=step.name,
                    command=" ".join(step.argv),
                    cwd=step.cwd,
                    exit_code=0,
                    conclusion="success",
                    duration_s=round(step_duration, 3),
                    output_tail=sanitized_tail,
                )
                steps.append(step_res)

            return VerificationResult(
                status="passed",
                executor="docker",
                reason="",
                steps=steps,
                duration_s=round(time.time() - start_time, 3),
            )

        except Exception as exc:
            logger.warning("DockerExecutor unexpected error: %s", exc, exc_info=True)
            return VerificationResult(
                status="unverified",
                executor="docker",
                reason=f"docker executor error: {sanitize_sensitive_data(exc)}",
                steps=steps,
                duration_s=round(time.time() - start_time, 3),
            )
        finally:
            if temp_dir:
                shutil.rmtree(temp_dir, ignore_errors=True)
