import time
from typing import Any, Dict
from django.conf import settings

from agents.approvals import BranchResolutionError, request_release_approval
from agents.events import emit_state_event
from agents.models import AgentExecutionTrace
from agents.registry import get_agent_spec
from agents.state import TicketState
from agents.users import get_agent_user_for_task
from tasks.models import Comment, Task, TaskActivity

from agents.release import current_branch_head, format_release_comment, perform_release


def devops_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    DevOps Specialist Agent:
    - Release gate: creates approval request pinning commit SHA when approval required.
    - When approval is disabled: performs release immediately via perform_release.
    """
    ticket_id = state.get("ticket_id")
    project_id = state.get("project_id")
    title = state.get("title", "")
    history = list(state.get("history", []))
    total_tokens = state.get("total_tokens", 0)
    total_cost = state.get("total_cost_usd", 0.0)

    agent_key = "devops"
    agent_spec = get_agent_spec(agent_key)
    author_name = agent_spec["name"]
    agent_role = agent_spec["role"]

    task_obj = Task.objects.select_related("project", "organization").get(id=ticket_id) if ticket_id else None
    agent_user = get_agent_user_for_task(task_obj, agent_key) if task_obj else None

    emit_state_event(
        state,
        event_type="progress",
        sender_key="devops",
        message="I received the release handoff and am evaluating the release gate.",
        current_work="Evaluating release gate",
        remaining_work=["release verification"],
    )

    branch_name = state.get("branch_name", "")
    repo = state.get("github_repo", "") or ""
    pr_url = state.get("pr_url", "") or ""

    require_approval = getattr(settings, "AGENT_REQUIRE_RELEASE_APPROVAL", True)

    if require_approval:
        session_id = state.get("langfuse_session_id")
        trace = (
            AgentExecutionTrace.objects.filter(session_id=session_id, task=task_obj).first()
            if task_obj and session_id
            else None
        )

        try:
            approval = request_release_approval(
                task_obj,
                trace=trace,
                engine="graph",
                branch=branch_name,
                repo=repo,
                pr_url=pr_url,
            )
        except BranchResolutionError as exc:
            comment_body = (
                f"**{author_name} - {agent_role}**\n\n"
                f"The release could not be prepared: {exc}"
            )
            if task_obj:
                Comment.objects.create(task=task_obj, author=agent_user, body=comment_body)
            step_log = {
                "node": "devops",
                "agent_role": agent_role,
                "action": "release_gate_failed",
                "message": f"The release could not be prepared: {exc}",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
            }
            history.append(step_log)
            return {
                "status": "qa",
                "assigned_agent": "done",
                "history": history,
                "total_tokens": total_tokens,
                "total_cost_usd": total_cost,
            }

        short_sha = approval.head_sha[:7] if approval.head_sha else ""
        comment_body = (
            f"**{author_name} - {agent_role}**\n\n"
            f"QA passed. The release is waiting for approval by a workspace owner or admin: "
            f"merge `{branch_name}` at `{short_sha}` into `main`, then request a staging deployment."
        )
        if task_obj:
            Comment.objects.create(task=task_obj, author=agent_user, body=comment_body)
            TaskActivity.objects.create(
                task=task_obj,
                actor=agent_user,
                action="release_gate_awaiting_approval",
                details={"branch": branch_name, "sha": approval.head_sha, "approval_id": approval.id},
            )

        step_log = {
            "node": "devops",
            "agent_role": agent_role,
            "action": "release_gate",
            "message": f"QA passed. The release is waiting for approval for {branch_name} at {short_sha}.",
            "approval_id": approval.id,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        }
        history.append(step_log)

        return {
            "status": "qa",
            "approval_id": approval.id,
            "assigned_agent": "done",
            "history": history,
            "total_tokens": total_tokens,
            "total_cost_usd": total_cost,
        }

    # Approval not required: release immediately
    expected_sha = current_branch_head(task_obj, branch_name)
    actor_email = agent_user.email if agent_user else getattr(settings, "GIT_AUTHOR_EMAIL", "")

    result = perform_release(
        task_obj,
        branch=branch_name,
        expected_head_sha=expected_sha,
        repo=repo,
        pr_url=pr_url,
        actor_email=actor_email,
    )

    if format_release_comment:
        comment_body = format_release_comment(author_name, agent_role, result)
    else:
        comment_body = (
            f"**{author_name} - {agent_role}**\n\n"
            f"{getattr(result, 'detail', '')}\n"
            f"{getattr(result, 'deployment_detail', '')}"
        )

    if task_obj:
        Comment.objects.create(task=task_obj, author=agent_user, body=comment_body)
        TaskActivity.objects.create(
            task=task_obj,
            actor=agent_user,
            action="release_completed" if getattr(result, "merged", False) else "release_failed",
            details=result.to_dict() if hasattr(result, "to_dict") else {},
        )

    merged = getattr(result, "merged", False)
    step_log = {
        "node": "devops",
        "agent_role": agent_role,
        "action": "release_step",
        "message": getattr(result, "detail", ""),
        "deployment_status": getattr(result, "deployment_status", ""),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    }
    history.append(step_log)
    emit_state_event(
        state,
        event_type="completed" if merged else "blocked",
        sender_key="devops",
        message=f"Release step recorded. {getattr(result, 'detail', '')} {getattr(result, 'deployment_detail', '')}".strip(),
        current_work="Release workflow step completed" if merged else "Release blocked",
        remaining_work=[] if merged else ["resolve release blocker"],
        metadata={"release": result.to_dict() if hasattr(result, "to_dict") else {}},
    )

    return {
        "status": "done" if merged else "qa",
        "deployment_status": getattr(result, "deployment_status", ""),
        "deployment_logs": getattr(result, "deployment_detail", ""),
        "assigned_agent": "done",
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
