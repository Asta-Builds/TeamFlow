import os
import time
from typing import Dict, Any, List, Optional
from agents.state import TicketState
from agents.tools.app_tool import log_task_activity, add_ticket_comment
from agents.tools.github_tool import post_pr_comment
from agents.events import emit_state_event
from agents.git_service import _resolve_project_repo_and_token, sanitize_sensitive_data

from agents.registry import get_agent_spec
from agents.users import get_agent_user_for_task
from tasks.models import Task

from agents.verification import verify_workspace, VerificationResult
from agents.untrusted_text import neutralize_untrusted_markdown

QA_MAX_REJECTIONS = 3


def _format_step_status(step: Any) -> str:
    if step.exit_code is not None:
        return f"exit {step.exit_code}"
    return step.conclusion or "unknown"


def _format_qa_comment(
    author_name: str,
    agent_role: str,
    result: Any,
    pr_url: Optional[str] = None,
) -> str:
    """Builds an honest, evidence-based QA comment quoting StepResult data with neutralized untrusted text."""
    clean_details_url = sanitize_sensitive_data(neutralize_untrusted_markdown(getattr(result, "details_url", "") or ""))
    details_line = f"\n- **Details:** {clean_details_url}" if clean_details_url else ""

    if result.status == "passed":
        step_lines = []
        for s in result.steps:
            st = _format_step_status(s)
            clean_cmd = sanitize_sensitive_data(neutralize_untrusted_markdown(s.command or getattr(s, "name", "")))
            clean_cwd = sanitize_sensitive_data(neutralize_untrusted_markdown(s.cwd or ""))
            step_lines.append(f"- `{clean_cmd}` (cwd: `{clean_cwd}`, {st})")
        steps_block = "\n".join(step_lines) if step_lines else "- No steps executed."
        return (
            f"**{author_name} - {agent_role}**\n\n"
            f"**Quality gate sign-off for @devops & @tech_lead:**\n\n"
            f"- **Validation Gate:** PASSED\n"
            f"- **Executor:** {result.executor}\n"
            f"- **Total Duration:** {result.duration_s:.1f}s\n"
            f"- **Verification Steps:**\n{steps_block}"
            f"{details_line}\n"
            f"- **Next:** Handing off to DevOps for the merge and release step.\n"
            f"- **PR:** {pr_url or 'none'}"
        )

    clean_reason = sanitize_sensitive_data(neutralize_untrusted_markdown(getattr(result, "reason", "") or ""))

    if result.status == "failed":
        failed_blocks = []
        for s in result.failed_steps:
            st = _format_step_status(s)
            clean_cmd = sanitize_sensitive_data(neutralize_untrusted_markdown(s.command or getattr(s, "name", "")))
            clean_cwd = sanitize_sensitive_data(neutralize_untrusted_markdown(s.cwd or ""))
            tail_lines = (s.output_tail or "").splitlines()[-40:]
            tail_text = "\n".join(tail_lines)
            clean_tail = sanitize_sensitive_data(neutralize_untrusted_markdown(tail_text))
            failed_blocks.append(
                f"- **Failed Step:** `{clean_cmd}` (cwd: `{clean_cwd}`, {st})\n\n```\n{clean_tail}\n```"
            )
        failed_section = "\n".join(failed_blocks) if failed_blocks else "- No specific failed steps recorded."
        return (
            f"**{author_name} - {agent_role}**\n\n"
            f"**Quality gate rejection for @backend_core & @tech_lead:**\n\n"
            f"- **Validation Gate:** FAILED\n"
            f"- **Executor:** {result.executor}\n"
            f"- **Reason:** {clean_reason}\n"
            f"- **Failures:**\n{failed_section}"
            f"{details_line}\n"
            f"- **Action Required:** @backend_core please inspect the failed step output above, fix the issues in your branch, and re-commit for validation.\n"
            f"- **PR:** {pr_url or 'none'}"
        )

    # unverified
    return (
        f"**{author_name} - {agent_role}**\n\n"
        f"**Quality gate unverified for @tech_lead:**\n\n"
        f"- **Validation Gate:** UNVERIFIED\n"
        f"- **Executor:** {result.executor}\n"
        f"- **Reason:** {clean_reason}\n"
        f"- **Status:** No automated verification was performed. The ticket is waiting for a human reviewer in QA."
        f"{details_line}\n"
        f"- **Enabling Verification:** Automated verification requires either a GitHub repository linked to the project (to run checks via GitHub Actions) or running the worker where a Docker daemon is available.\n"
        f"- **PR:** {pr_url or 'none'}"
    )


def _ensure_task_in_qa(task_obj: Task, actor=None) -> Task:
    """Legally transitions task to QA status following KanbanStateMachine rules."""
    from tasks.application.use_cases import TaskApplicationService
    app_service = TaskApplicationService()
    if task_obj.status == Task.Status.TODO:
        task_obj = app_service.transition_status(task_obj, Task.Status.IN_PROGRESS, actor=actor)
    if task_obj.status == Task.Status.IN_PROGRESS:
        task_obj = app_service.transition_status(task_obj, Task.Status.IN_REVIEW, actor=actor)
    if task_obj.status == Task.Status.IN_REVIEW:
        task_obj = app_service.transition_status(task_obj, Task.Status.QA, actor=actor)
    return task_obj


def qa_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    QA Specialist Agent:
    - Runs automated project toolchain verification against the Pull Request artifacts
    - Evaluates acceptance criteria through real executor runs
    - Decision Gate:
      * Passed -> Approved, routes to DevOps for deployment
      * Failed -> Rejection with real evidence, cycles back to Dev
      * Unverified -> Stays in QA for human review, routes to END
    """
    ticket_id = state.get("ticket_id")
    history = list(state.get("history", []))
    pr_url = state.get("pr_url")
    total_tokens = state.get("total_tokens", 0)
    total_cost = state.get("total_cost_usd", 0.0)

    agent_key = "qa"
    agent_spec = get_agent_spec(agent_key)
    author_name = agent_spec["name"]
    agent_role = agent_spec["role"]

    task_obj = Task.objects.get(id=ticket_id) if ticket_id else None
    agent_user = get_agent_user_for_task(task_obj, agent_key) if task_obj else None

    emit_state_event(
        state,
        event_type="progress",
        sender_key="qa",
        message="I am evaluating the recorded implementation result against the current QA gate.",
        current_work="Evaluating QA decision",
        remaining_work=["record QA evidence", "release handoff"],
    )

    files_modified = list(state.get("files_modified", []))
    project_workspace = state.get("workspace_path", "")
    ref = state.get("branch_name") or "HEAD"

    resolved_repo, resolved_token, _ = _resolve_project_repo_and_token(project_workspace)
    repo = state.get("github_repo") or resolved_repo or ""
    token = resolved_token or ""

    result = verify_workspace(
        project_workspace,
        files_modified,
        ref=ref,
        repo=repo,
        token=token,
    )
    qa_result = result.status
    metrics = result.to_dict()
    clean_reason = sanitize_sensitive_data(neutralize_untrusted_markdown(getattr(result, "reason", "") or ""))

    prior_rejections = sum(1 for h in history if h.get("node") == "qa" and h.get("action") == "qa_rejection")
    rejection_count = prior_rejections + 1 if qa_result == "failed" else prior_rejections
    is_terminal_rejection = qa_result == "failed" and rejection_count >= QA_MAX_REJECTIONS

    qa_comment = _format_qa_comment(author_name, agent_role, result, pr_url)
    if is_terminal_rejection:
        qa_comment += f"\nQA has rejected this ticket {rejection_count} times. The swarm has stopped; a human needs to look at it."

    if task_obj:
        from tasks.application.use_cases import TaskApplicationService
        app_service = TaskApplicationService()

        task_obj = _ensure_task_in_qa(task_obj, actor=agent_user)
        if qa_result == "passed":
            task_obj.qa_rejected = False
            task_obj.qa_rejection_reason = ""
            task_obj.save(update_fields=["qa_rejected", "qa_rejection_reason", "updated_at"])
            log_task_activity(ticket_id, author_name, "qa_validated", {"executor": result.executor, "duration_s": result.duration_s, "decision": "passed"})
        elif qa_result == "failed":
            task_obj = app_service.transition_status(task_obj, Task.Status.IN_PROGRESS, actor=agent_user)
            task_obj.qa_rejected = True
            task_obj.qa_rejection_reason = clean_reason
            task_obj.save(update_fields=["qa_rejected", "qa_rejection_reason", "updated_at"])
            log_task_activity(ticket_id, author_name, "qa_rejected", {"executor": result.executor, "reason": clean_reason, "decision": "failed"})
        else:
            task_obj.qa_rejected = False
            task_obj.qa_rejection_reason = ""
            task_obj.save(update_fields=["qa_rejected", "qa_rejection_reason", "updated_at"])
            log_task_activity(ticket_id, author_name, "qa_unverified", {"executor": result.executor, "reason": clean_reason, "decision": "unverified"})

        add_ticket_comment(ticket_id, "qa", sanitize_sensitive_data(qa_comment))

    if pr_url:
        try:
            post_pr_comment(pr_url, sanitize_sensitive_data(qa_comment), token=token)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Could not post QA comment to PR %s: %s", pr_url, exc)

    if qa_result == "passed":
        action = "qa_validation"
        rejection_reason = None
        message = f"QA Agent: Verification passed via {result.executor} ({len(result.steps)} steps)."
        event_type = "handoff"
        recipient_key = "devops"
        event_msg = "I recorded a passing QA decision and handed the run to the release step."
        current_work = "QA decision recorded"
        remaining_work = ["release handoff"]
    elif qa_result == "failed":
        action = "qa_rejection"
        rejection_reason = clean_reason
        if is_terminal_rejection:
            message = f"QA Agent: Verification failed: {clean_reason}. Swarm stopped after {rejection_count} rejections."
            event_type = "blocked"
            recipient_key = "human"
            event_msg = f"QA has rejected this ticket {rejection_count} times. The swarm has stopped; a human needs to look at it."
            current_work = "QA decision recorded"
            remaining_work = ["human review of repeated QA failures"]
        else:
            message = f"QA Agent: Verification failed: {clean_reason}."
            event_type = "blocked"
            recipient_key = "backend_core"
            event_msg = f"I blocked the release and returned the work for correction: {clean_reason}"
            current_work = "QA decision recorded"
            remaining_work = ["resolve QA rejection", "repeat QA"]
    else:
        action = "qa_unverified"
        rejection_reason = clean_reason
        message = f"QA Agent: Workspace unverified: {clean_reason}."
        event_type = "blocked"
        recipient_key = "tech_lead"
        event_msg = f"Automated verification was not possible: {clean_reason}. Ticket is waiting for human QA validation."
        current_work = "QA decision recorded"
        remaining_work = ["human QA review"]

    step_log = {
        "node": "qa",
        "agent_role": agent_role,
        "action": action,
        "qa_result": qa_result,
        "rejection_reason": rejection_reason,
        "message": message,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        "metrics": metrics,
    }
    history.append(step_log)

    emit_state_event(
        state,
        event_type=event_type,
        sender_key="qa",
        recipient_key=recipient_key,
        message=event_msg,
        current_work=current_work,
        remaining_work=remaining_work,
        metadata={"qa_result": qa_result, "reason": rejection_reason, "metrics": metrics},
    )

    return {
        "status": "in_progress" if qa_result == "failed" else "qa",
        "qa_result": qa_result,
        "qa_rejection_reason": rejection_reason,
        "assigned_agent": "devops" if qa_result == "passed" else ("backend" if qa_result == "failed" else "tech_lead"),
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
