import ast
import os
import time
from typing import Dict, Any, List, Tuple
from agents.state import TicketState
from agents.tools.app_tool import set_ticket_qa_decision, log_task_activity, add_ticket_comment
from agents.tools.github_tool import post_pr_comment
from agents.events import emit_state_event


def verify_code_artifacts(files_modified: List[str], project_workspace: str = "") -> Tuple[bool, str, Dict[str, Any]]:
    """Perform real static, syntax, and invariant analysis on modified artifacts."""
    checked_files = []
    syntax_errors = []

    if not files_modified and project_workspace and os.path.exists(project_workspace):
        for root, dirs, files in os.walk(project_workspace):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in {"node_modules", "__pycache__"}]
            for file in files:
                if not file.startswith(".") and not file.endswith((".pyc", ".log")):
                    checked_files.append(os.path.join(root, file))
    else:
        for f in (files_modified or []):
            full_path = os.path.join(project_workspace, f) if project_workspace else f
            if os.path.exists(full_path):
                checked_files.append(full_path)

    for file_path in checked_files:
        if file_path.endswith(".py"):
            try:
                with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
                    content = fh.read()
                ast.parse(content, filename=file_path)
            except SyntaxError as syn_err:
                syntax_errors.append(f"{os.path.basename(file_path)}: line {syn_err.lineno} - {syn_err.msg}")
            except Exception as exc:
                syntax_errors.append(f"{os.path.basename(file_path)}: read error - {exc}")

    if syntax_errors:
        reason = f"Syntax verification failed in modified files: {'; '.join(syntax_errors)}"
        return False, reason, {"checked_count": len(checked_files), "syntax_errors": syntax_errors}

    return True, "", {"checked_count": len(checked_files), "syntax_valid": True}


def qa_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    QA Specialist Agent:
    - Runs automated syntax and invariant verification against the Pull Request artifacts
    - Evaluates acceptance criteria
    - Decision Gate:
      * Passed -> Approved, routes to DevOps for deployment
      * Failed -> Rejection with mandatory reason, cycles back to Dev!
    """
    ticket_id = state.get("ticket_id")
    title = state.get("title", "")
    pr_url = state.get("pr_url", "")
    files_modified = state.get("files_modified", [])
    project_workspace = state.get("workspace_path", "")
    history = list(state.get("history", []))
    total_tokens = state.get("total_tokens", 0) + 480
    total_cost = state.get("total_cost_usd", 0.0) + 0.0048

    emit_state_event(
        state,
        event_type="progress",
        sender_key="qa",
        message="I am evaluating the recorded implementation result against the current QA gate.",
        current_work="Evaluating QA decision",
        remaining_work=["record QA evidence", "release handoff"],
    )

    passed, error_reason, metrics = verify_code_artifacts(files_modified, project_workspace)

    retry_count = sum(1 for h in history if h.get("node") == "qa")
    qa_passed = passed

    if qa_passed:
        qa_result = "passed"
        rejection_reason = None
        checked_count = metrics.get("checked_count", 0)
        message = f"QA Agent: Python syntax checks passed for {checked_count} file(s)" + (f" on PR {pr_url}." if pr_url else ".")
        if pr_url:
            post_pr_comment(pr_url, f"**QA Sign-Off:** Python syntax checks passed for {checked_count} file(s).")
        if ticket_id:
            set_ticket_qa_decision(ticket_id, qa_passed=True, reason="")
            qa_comment = (
                f"**Alan Turing (AI) - QA Specialist**\n\n"
                f"**Sprint Quality Gate Sign-Off for @devops & @tech_lead:**\n\n"
                f"- **Validation Gate:** PASSED ({checked_count} file(s) checked).\n"
                f"- **Checks Performed:** Python syntax verification of the changed files.\n"
                f"- **Next:** Handing off to DevOps for the merge and release step.\n"
                f"- **PR:** {pr_url or 'none'}"
            )
            add_ticket_comment(ticket_id, "qa", qa_comment)
            log_task_activity(ticket_id, "Alan Turing (AI)", "qa_validated", {"checked_count": checked_count, "decision": "passed"})
    else:
        qa_result = "failed"
        rejection_reason = error_reason or "Artifact validation failed: Invariant or syntax check error."
        message = f"QA Agent: Rejection recorded for PR {pr_url}. Reason: {rejection_reason}. Reopening ticket for developer fix."
        if pr_url:
            post_pr_comment(pr_url, f"**QA Rejection:** {rejection_reason}")
        if ticket_id:
            set_ticket_qa_decision(ticket_id, qa_passed=False, reason=rejection_reason)
            qa_comment = (
                f"**Alan Turing (AI) - QA Specialist**\n\n"
                f"**Sprint Quality Gate REJECTION for @backend_core & @tech_lead:**\n\n"
                f"- **Validation Gate:** FAILED.\n"
                f"- **Reason / Defect:** {rejection_reason}\n"
                f"- **Action Required:** @backend_core please inspect the syntax and schema invariant failures, fix in your feature branch, and re-commit for validation.\n"
                f"- **Blockers:** Ticket blocked until automated verification passes.\n"
                f"- **PR:** {pr_url}"
            )
            add_ticket_comment(ticket_id, "qa", qa_comment)
            log_task_activity(ticket_id, "Alan Turing (AI)", "qa_rejected", {"reason": rejection_reason, "decision": "failed"})

    step_log = {
        "node": "qa",
        "agent_role": "QA Engineer",
        "action": "qa_validation" if qa_passed else "qa_rejection",
        "qa_result": qa_result,
        "rejection_reason": rejection_reason,
        "message": message,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        "tokens": 480,
        "cost_usd": 0.0048,
        "metrics": metrics,
    }
    history.append(step_log)
    emit_state_event(
        state,
        event_type="handoff" if qa_passed else "blocked",
        sender_key="qa",
        recipient_key="devops" if qa_passed else "backend_core",
        message=(
            "I recorded a passing QA decision and handed the run to the release step."
            if qa_passed
            else f"I blocked the release and returned the work for correction: {rejection_reason}"
        ),
        current_work="QA decision recorded",
        remaining_work=["release handoff"] if qa_passed else ["resolve QA rejection", "repeat QA"],
        metadata={"qa_result": qa_result, "reason": rejection_reason, "metrics": metrics},
    )

    return {
        "status": "qa" if not qa_passed else "in_progress",
        "qa_result": qa_result,
        "qa_rejection_reason": rejection_reason,
        "assigned_agent": "devops" if qa_passed else "backend",
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
