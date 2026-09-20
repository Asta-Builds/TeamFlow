#!/usr/bin/env python3
"""
Synchronous end-to-end smoke test for a single ticket through the TeamFlow agent swarm.

Runs in-process without Celery, creates an isolated throwaway workspace,
records LLM interactions to disk for deterministic replay, verifies git commits
against all claimed code changes, and cleans up database rows.

Usage:
    python scripts/agent_smoke.py [options]

Exit codes:
    0: Run completed, QA passed, every claimed file committed.
    1: Run failed (exception, no provider, QA failed, no files produced).
    2: Run completed, but a claimed file is missing from the commits.
    3: Run completed, files committed, but QA unverified (ticket is waiting in QA).
"""

from __future__ import annotations

import argparse
import datetime
import os
import re
import subprocess
import sys
import time
import traceback
from typing import Any, Dict, List, Optional, Set


def setup_django() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    backend_dir = os.path.join(repo_root, "backend")
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "teamflow.settings")
    import django
    django.setup()


def normalize_path(path: str) -> str:
    """Normalize a path by converting separators and stripping leading './' strictly."""
    norm = path.replace("\\", "/").strip()
    while norm.startswith("./"):
        norm = norm.removeprefix("./")
    return norm


def extract_claimed_files(comments: List[str]) -> List[str]:
    """
    Extract file paths that agents explicitly claimed to create or modify
    in their comments/reports.
    """
    claimed: List[str] = []
    patterns = [
        r"-\s*File\s+(?:Created|Modified):\s*[`'\"]?([^`'\"\n\r]+)[`'\"]?",
        r"(?:FILE|File|Fichier):\s*[`'\"]?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)[`'\"]?",
        r"-\s*`([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)`",
    ]
    for comment in comments:
        for pat in patterns:
            for match in re.finditer(pat, comment):
                path = match.group(1).strip()
                if path and not path.startswith("http") and not path.startswith("#"):
                    norm = normalize_path(path)
                    if norm and norm not in claimed:
                        claimed.append(norm)
    return claimed


def get_committed_files(workspace: str, before_commit: Optional[str] = None) -> Set[str]:
    """Retrieve all files committed in the workspace repository during this run."""
    files: Set[str] = set()
    if not os.path.exists(workspace):
        return files

    if before_commit:
        # Check files changed between before_commit and HEAD
        res = subprocess.run(
            ["git", "-C", workspace, "diff", "--name-only", f"{before_commit}..HEAD"],
            capture_output=True,
            text=True,
        )
    else:
        # No before_commit (repo had no commits), so everything in log belongs to run
        res = subprocess.run(
            ["git", "-C", workspace, "log", "--name-only", "--format="],
            capture_output=True,
            text=True,
        )

    if res.returncode == 0:
        for line in res.stdout.splitlines():
            clean = normalize_path(line)
            if clean:
                files.add(clean)

    return files


def file_is_committed(claimed: str, committed: Set[str]) -> bool:
    """Match claimed path against committed set, strictly by exact normalized path."""
    norm_claimed = normalize_path(claimed)
    return norm_claimed in committed


def decide_exit_code(
    run_failed: bool,
    has_mismatch: bool,
    qa_result: Optional[str],
    final_status: str,
) -> int:
    """
    Pure function mapping run outcomes to CLI exit codes:
      0: Run completed, QA passed, every claimed file committed.
      1: Run failed (exception, no provider, QA failed, no files produced, or unexpected status).
      2: Run completed, but a claimed file is missing from commits (wins over unverified).
      3: Run completed, files committed, but QA unverified and ticket is in 'qa'.
    """
    if run_failed:
        return 1

    qa = (qa_result or "").strip().lower()
    status = (final_status or "").strip().lower()

    if qa == "failed":
        return 1

    if qa == "unverified":
        if status != "qa":
            return 1
        if has_mismatch:
            return 2
        return 3

    if qa == "passed":
        if status != "done":
            return 1
        if has_mismatch:
            return 2
        return 0

    # If qa_result is None or unrecognized:
    if status != "done":
        return 1
    if has_mismatch:
        return 2
    return 0


def get_latest_qa_data(task: Any, trace: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    """
    Extract the latest QA verdict and evidence from structured data:
    - Graph engine: history entry in trace.steps where node == 'qa'
    - Chain engine: AgentEvent rows for the ticket where metadata contains 'qa_result'
    Never parse comment text for the QA verdict.
    """
    # 1. Check trace.steps (structured history written by graph engine)
    if trace and getattr(trace, "steps", None) and isinstance(trace.steps, list):
        for step in reversed(trace.steps):
            if isinstance(step, dict) and step.get("node") == "qa" and step.get("qa_result"):
                metrics = step.get("metrics") or {}
                return {
                    "verdict": step.get("qa_result"),
                    "executor": metrics.get("executor") or "none",
                    "reason": step.get("rejection_reason") or metrics.get("reason") or "",
                    "details_url": metrics.get("details_url") or "",
                    "steps": metrics.get("steps") or [],
                }

    # 2. Check AgentEvent rows for the ticket (structured events from chain engine & graph engine)
    try:
        from agents.models import AgentEvent
        events = AgentEvent.objects.filter(task=task).order_by("-id")
        for ev in events:
            if isinstance(ev.metadata, dict) and ev.metadata.get("qa_result"):
                meta = ev.metadata
                metrics = meta.get("metrics") or {}
                return {
                    "verdict": meta.get("qa_result"),
                    "executor": metrics.get("executor") or "none",
                    "reason": meta.get("reason") or metrics.get("reason") or "",
                    "details_url": metrics.get("details_url") or "",
                    "steps": metrics.get("steps") or [],
                }
    except Exception:
        pass

    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run a single ticket through the TeamFlow agent swarm synchronously and record interactions.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Run without confirmation prompt against the configured database.",
    )
    parser.add_argument(
        "--title",
        type=str,
        default="Add a /health endpoint returning service status as JSON",
        help="Title for the throwaway smoke ticket.",
    )
    parser.add_argument(
        "--description",
        type=str,
        default="Implement a GET /health endpoint returning service status as JSON with tests and a client view component.",
        help="Description for the throwaway smoke ticket.",
    )
    parser.add_argument(
        "--no-record",
        action="store_true",
        help="Disable recording live LLM responses to fixture directory.",
    )
    parser.add_argument(
        "--record-dir",
        type=str,
        default="",
        help="Directory to save recorded LLM interactions (default: backend/agents/fixtures/llm/).",
    )
    parser.add_argument(
        "--engine",
        choices=["chain", "graph"],
        default="chain",
        help="Swarm execution engine: 'chain' (agents/swarm_chain.py, matching frontend modal) or 'graph' (agents/graph.py, matching API dispatch). Default: chain.",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Keep throwaway database rows (org, project, user, task) instead of deleting them on exit.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run strict unit tests for path normalization, exact-match logic, and exit code mapping, then exit.",
    )

    args = parser.parse_args()

    if args.self_test:
        print("Running self-tests for path matching...")
        test_failures = 0
        
        def check(claimed, committed, expected):
            nonlocal test_failures
            result = file_is_committed(claimed, committed)
            if result != expected:
                print(f"FAIL: claimed='{claimed}', committed={committed}. Expected {expected}, got {result}")
                test_failures += 1
            else:
                print(f"PASS: claimed='{claimed}' against {committed} -> {result}")

        check("docs/README.md", {"README.md"}, False)
        check("app.py", {"myapp.py"}, False)
        check(".github/workflows/ci.yml", {".github/workflows/ci.yml"}, True)
        check("./.env", {".env"}, True)
        check(".env", {".env"}, True)
        check("src/app.py", {"src/app.py"}, True)
        
        norm_env = normalize_path("./.env")
        if norm_env != ".env":
            print(f"FAIL: './.env' normalized to '{norm_env}', expected '.env'")
            test_failures += 1

        print("\nRunning self-tests for exit code decision...")

        def check_exit_code(run_failed, has_mismatch, qa_result, final_status, expected):
            nonlocal test_failures
            result = decide_exit_code(run_failed, has_mismatch, qa_result, final_status)
            desc = f"run_failed={run_failed}, mismatch={has_mismatch}, qa={qa_result}, status='{final_status}'"
            if result != expected:
                print(f"FAIL: {desc}. Expected {expected}, got {result}")
                test_failures += 1
            else:
                print(f"PASS: {desc} -> {result}")

        # Required test cases:
        # passed/done -> 0
        check_exit_code(False, False, "passed", "done", 0)
        # failed -> 1
        check_exit_code(False, False, "failed", "in_progress", 1)
        check_exit_code(True, False, None, "done", 1)
        # unverified/qa -> 3
        check_exit_code(False, False, "unverified", "qa", 3)
        # unverified with a mismatch -> 2
        check_exit_code(False, True, "unverified", "qa", 2)
        # unverified but final status in_progress -> 1
        check_exit_code(False, False, "unverified", "in_progress", 1)
        # additional sanity checks:
        check_exit_code(False, True, "passed", "done", 2)
        check_exit_code(False, False, "passed", "qa", 1)

        if test_failures > 0:
            print(f"\nSelf-test failed with {test_failures} errors.")
            return 1
        print("\nAll self-tests passed.")
        return 0

    setup_django()

    from django.conf import settings
    from django.utils import timezone
    from agents.llm import model_available

    # Step 1: Database name report
    db_name = settings.DATABASES.get("default", {}).get("NAME", "unknown")
    print(f"Target database: {db_name}", flush=True)

    # Step 2: Report provider first before touching database
    print("Checking model provider...", flush=True)
    if not model_available():
        sys.stdout.flush()
        print(
            "No model provider configured or available. Set GEMINI_API_KEY, OPENAI_API_KEY or OLLAMA_BASE_URL.",
            file=sys.stderr,
            flush=True,
        )
        return 1

    # Database confirmation check
    if not args.yes:
        if not sys.stdin.isatty():
            print("Refusing to run against database without --yes in non-interactive mode.", file=sys.stderr)
            return 1
        try:
            confirm = input(f"Proceed with throwaway smoke run against '{db_name}'? [y/N]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nAborted.", file=sys.stderr)
            return 1
        if confirm not in ("y", "yes"):
            print("Aborted by user.", file=sys.stderr)
            return 1

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    backend_dir = os.path.join(repo_root, "backend")

    # Step 4: Configure recording
    if args.no_record:
        record_dir = ""
        settings.LLM_RECORD_DIR = ""
        print("Recording: disabled (--no-record)")
    else:
        record_dir = (
            os.path.abspath(args.record_dir)
            if args.record_dir
            else os.path.join(backend_dir, "agents", "fixtures", "llm")
        )
        os.makedirs(record_dir, exist_ok=True)
        settings.LLM_RECORD_DIR = record_dir
        print(f"Recording: {record_dir}")

    initial_fixtures = set(os.listdir(record_dir)) if record_dir and os.path.exists(record_dir) else set()

    # Step 3: Set up isolated scenario
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    tag = f"smoke-{ts}"

    from organizations.models import Organization
    from accounts.models import User
    from projects.models import Project
    from tasks.models import Task
    from agents.models import AgentExecutionTrace
    from agents.git_service import get_project_workspace

    org = None
    ceo_user = None
    project = None
    task = None
    trace = None
    workspace_path = ""
    run_failed = False
    failure_reason = ""
    duration = 0.0

    try:
        print(f"\nSetting up isolated scenario ({tag})...")
        org = Organization.objects.create(
            name=f"{tag}-org",
            subscription_tier=Organization.Tier.STARTER,
        )

        ceo_user = User.objects.create_user(
            email=f"ceo-{tag}@example.com",
            password=None,
            name=f"Smoke CEO {ts}",
            role=User.Role.CEO,
            organization=org,
        )

        project = Project.objects.create(
            name=f"{tag}-proj",
            description="Smoke test isolated project",
            github_repo="",  # Isolated: no remote repo so nothing pushed
            owner=ceo_user,
            organization=org,
        )

        task = Task.objects.create(
            project=project,
            organization=org,
            title=args.title,
            description=args.description,
            created_by=ceo_user,
            priority="medium",
            status=Task.Status.TODO,
        )

        workspace_path = get_project_workspace(task)

        print(f"Organization: {org.name} (id={org.id})")
        print(f"Project:      {project.name} (id={project.id})")
        print(f"CEO User:     {ceo_user.email} (id={ceo_user.id})")
        print(f"Ticket:       #{task.id} - {task.title}")
        print(f"Workspace:    {workspace_path}")

        # Step 5: Run swarm synchronously with live streaming events
        before_commit = None
        if os.path.exists(workspace_path):
            res_head = subprocess.run(
                ["git", "-C", workspace_path, "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
            )
            if res_head.returncode == 0:
                before_commit = res_head.stdout.strip()

        trace = AgentExecutionTrace.objects.create(
            task=task,
            session_id=f"smoke-{task.id}-{int(time.time())}",
            status=AgentExecutionTrace.Status.RUNNING,
            graph_state={"mode": args.engine, "phase": "starting"},
        )

        import agents.events
        original_emit = agents.events.emit_agent_event

        def streaming_emit(*e_args, **kwargs):
            sender = kwargs.get("sender_key") or "system"
            event_type = kwargs.get("event_type") or "info"
            msg = kwargs.get("message") or ""
            print(f"[{sender}] [{event_type}] {msg}", flush=True)
            return original_emit(*e_args, **kwargs)

        agents.events.emit_agent_event = streaming_emit

        try:
            import agents.swarm_chain
            agents.swarm_chain.emit_agent_event = streaming_emit
        except Exception:
            pass

        # Track tokens across detailed generation calls
        from agents import llm
        original_generate_detailed = llm.generate_text_detailed
        total_tokens_recorded: Optional[int] = None

        def token_tracking_generate_detailed(*g_args, **g_kwargs):
            nonlocal total_tokens_recorded
            res = original_generate_detailed(*g_args, **g_kwargs)
            if res and res.total_tokens is not None:
                if total_tokens_recorded is None:
                    total_tokens_recorded = 0
                total_tokens_recorded += res.total_tokens
            return res

        llm.generate_text_detailed = token_tracking_generate_detailed

        print(f"\n--- Starting swarm execution (engine={args.engine}) ---\n", flush=True)
        start_time = time.time()

        try:
            if args.engine == "chain":
                from agents.swarm_chain import execute_full_swarm_chain
                events = execute_full_swarm_chain(
                    task=task,
                    trigger_user=ceo_user,
                    instruction="",
                    session_id=trace.session_id,
                    trace=trace,
                )
                duration = time.time() - start_time
                trace.status = AgentExecutionTrace.Status.COMPLETED
                trace.graph_state = {"mode": "chain", "phase": "completed", "events_count": len(events)}
                trace.steps = events
                trace.duration_seconds = round(duration, 2)
                if total_tokens_recorded is not None:
                    trace.tokens_used = total_tokens_recorded
                trace.finished_at = timezone.now()
                trace.save()
            else:
                from agents.graph import execute_ticket_swarm
                res = execute_ticket_swarm(task=task, trace=trace)
                duration = time.time() - start_time
                if not res.get("ok"):
                    run_failed = True
                    failure_reason = res.get("error") or "Graph execution reported failure."
        except Exception as exc:
            duration = time.time() - start_time
            run_failed = True
            failure_reason = f"Exception during execution: {exc}"
            print(f"\nExecution failed with exception: {exc}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            trace.status = AgentExecutionTrace.Status.FAILED
            trace.graph_state = {"error": str(exc), "phase": "failed"}
            trace.duration_seconds = round(duration, 2)
            if total_tokens_recorded is not None:
                trace.tokens_used = total_tokens_recorded
            trace.finished_at = timezone.now()
            try:
                trace.save()
            except Exception as save_exc:
                print(f"Warning: Failed to save trace: {save_exc}", file=sys.stderr)

        # Step 6: Report what really happened
        task.refresh_from_db()
        trace.refresh_from_db()

        qa_data = get_latest_qa_data(task, trace)
        qa_verdict = qa_data["verdict"] if qa_data else None
        qa_reason = qa_data["reason"] if qa_data else ""

        if not run_failed:
            if qa_verdict == "unverified":
                if task.status != Task.Status.QA:
                    run_failed = True
                    failure_reason = (
                        f"Ticket status is '{task.status}', expected '{Task.Status.QA}' for unverified QA."
                    )
            elif qa_verdict == "failed":
                run_failed = True
                failure_reason = (
                    f"QA verification failed: {qa_reason or getattr(task, 'qa_rejection_reason', '') or 'quality gate rejection'}."
                )
            elif qa_verdict == "passed":
                if task.status != Task.Status.DONE:
                    run_failed = True
                    failure_reason = f"QA passed, but ticket status is '{task.status}' (expected '{Task.Status.DONE}')."
            else:
                if task.status != Task.Status.DONE:
                    run_failed = True
                    failure_reason = f"Ticket status is '{task.status}', expected '{Task.Status.DONE}'."
                    if getattr(task, "qa_rejected", False):
                        failure_reason += f" (QA rejection: {task.qa_rejection_reason})"

        print("\n" + "=" * 60)
        print("SWARM EXECUTION REPORT")
        print("=" * 60)
        tokens_display = (
            str(trace.tokens_used)
            if (trace.tokens_used is not None and trace.tokens_used > 0)
            else "not reported"
        )
        print(f"Trace status: {trace.status}")
        print(f"Tokens used:  {tokens_display}")
        print(f"Duration:     {duration:.2f}s")

        if record_dir and os.path.exists(record_dir):
            final_fixtures = set(os.listdir(record_dir))
            new_fixtures = final_fixtures - initial_fixtures
            print(f"Record dir:   {record_dir}")
            print(f"Fixtures:     {len(new_fixtures)} new files written (total {len(final_fixtures)} in dir)")

        print(f"Workspace:    {workspace_path}")

        print("\nGit Log (--stat -3):")
        res_log = subprocess.run(
            ["git", "-C", workspace_path, "log", "--stat", "-3"],
            capture_output=True,
            text=True,
        )
        if res_log.returncode == 0:
            print(res_log.stdout.strip())
        else:
            print(f"git log failed (code {res_log.returncode}): {res_log.stderr.strip()}")

        print("\nGit Status (--porcelain):")
        res_status = subprocess.run(
            ["git", "-C", workspace_path, "status", "--porcelain"],
            capture_output=True,
            text=True,
        )
        if res_status.returncode == 0:
            print(res_status.stdout.strip() if res_status.stdout.strip() else "(clean)")
        else:
            print(f"git status failed: {res_status.stderr.strip()}")

        # Check claimed files vs git commits
        comments = list(task.comments.order_by("created_at"))
        comment_texts = [c.body for c in comments]
        claimed_files = extract_claimed_files(comment_texts)
        committed_files = get_committed_files(workspace_path)

        print(f"\nVerification of Claimed Files vs Git Commits:")
        print(f"Claimed files:   {len(claimed_files)}")
        print(f"Committed files: {len(committed_files)}")

        has_mismatch = False
        mismatches: List[str] = []

        if not claimed_files:
            print("Notice: No code files were claimed in comments by agents.")
            if not run_failed:
                run_failed = True
                failure_reason = "Run completed but no code changes were claimed by agents."
        else:
            for f in claimed_files:
                if file_is_committed(f, committed_files):
                    print(f"  VERIFIED: '{f}' is present in git commits.")
                else:
                    print(f"  MISMATCH: Claimed file '{f}' was NOT found in git commits!")
                    has_mismatch = True
                    mismatches.append(f)

        print(f"\nTicket Final Status: {task.status}")

        print("\nQA Evidence:")
        if qa_data:
            print(f"  Verdict:     {qa_data['verdict']}")
            print(f"  Executor:    {qa_data['executor']}")
            print(f"  Reason:      {qa_data['reason'] or 'none'}")
            if qa_data.get("details_url"):
                print(f"  Details URL: {qa_data['details_url']}")
            steps = qa_data.get("steps") or []
            if steps:
                print("  Verification Steps:")
                for s in steps:
                    cmd = s.get("command") or s.get("name") or "unknown"
                    cwd = s.get("cwd") or "."
                    exit_code = s.get("exit_code")
                    st = f"exit {exit_code}" if exit_code is not None else (s.get("conclusion") or "unknown")
                    print(f"    - `{cmd}` (cwd: `{cwd}`, {st})")
            else:
                print("  Verification Steps: (none)")
        else:
            print("  (no structured QA evidence recorded)")

        print(f"\nAgent Comments ({len(comments)}):")
        for i, c in enumerate(comments, 1):
            author_name = c.author.name if c.author else "Unknown"
            author_role = getattr(c.author, "role", "system") if c.author else "system"
            print(f"\n--- Comment {i} by {author_name} ({author_role}) at {c.created_at} ---")
            print(c.body)

        # Step 7: Verdict and Exit Codes
        print("\n" + "=" * 60)
        exit_code = decide_exit_code(run_failed, has_mismatch, qa_verdict, str(task.status))
        if exit_code == 0:
            print("VERDICT: SUCCESS - Run completed and all claimed files committed to git")
            return 0
        elif exit_code == 1:
            print(f"VERDICT: FAILED - {failure_reason or 'Run failed'}")
            return 1
        elif exit_code == 2:
            print(f"VERDICT: MISMATCH - Run completed but {len(mismatches)} claimed file(s) missing from git")
            return 2
        elif exit_code == 3:
            reason_msg = qa_reason or "Automated verification was not possible"
            print(f"VERDICT: UNVERIFIED - {reason_msg}")
            print("Ticket is waiting in QA for a human reviewer.")
            return 3
        else:
            print(f"VERDICT: FAILED - Unexpected exit code {exit_code}")
            return 1

    finally:
        # Step 8: Cleanup / --keep
        if args.keep:
            print("\nDatabase rows kept (--keep):")
            if org and org.id:
                print(f"  Organization ID: {org.id}")
            if project and project.id:
                print(f"  Project ID:      {project.id}")
            if ceo_user and ceo_user.id:
                print(f"  User ID:         {ceo_user.id}")
            if task and task.id:
                print(f"  Task ID:         {task.id}")
            if workspace_path:
                print(f"Workspace preserved at: {workspace_path}")
        else:
            if org and org.pk:
                print("\nCleaning up throwaway database rows...")
                try:
                    org.delete()
                    print("Database cleanup complete.")
                except Exception as cleanup_err:
                    print(f"Warning: Cleanup failed: {cleanup_err}", file=sys.stderr)
            if workspace_path:
                print(f"Workspace preserved at: {workspace_path}")


if __name__ == "__main__":
    sys.exit(main())
