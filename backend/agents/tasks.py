"""Celery entrypoints for non-blocking agent runs."""

from __future__ import annotations

from celery import shared_task
from django.contrib.auth import get_user_model
from django.utils import timezone
import logging

from .events import emit_agent_event
from .graph import execute_ticket_swarm
from .models import AgentExecutionTrace, ApprovalRequest

try:
    from agents.release import format_release_comment, perform_release, ReleaseResult
except ImportError:
    format_release_comment = None
    perform_release = None
    ReleaseResult = None

User = get_user_model()
logger = logging.getLogger(__name__)


def _load_trace(trace_id: int) -> AgentExecutionTrace:
    return AgentExecutionTrace.objects.select_related(
        "task",
        "task__project",
        "task__organization",
    ).get(pk=trace_id)


def _fail_trace(trace: AgentExecutionTrace, exc: Exception) -> None:
    trace.status = AgentExecutionTrace.Status.FAILED
    trace.graph_state = {**trace.graph_state, "error": str(exc), "phase": "failed"}
    trace.finished_at = timezone.now()
    trace.save(update_fields=["status", "graph_state", "finished_at"])
    emit_agent_event(
        task=trace.task,
        trace=trace,
        session_id=trace.session_id,
        event_type="failed",
        message=f"The agent run stopped because: {exc}",
        current_work="Run failed",
        remaining_work=["resolve the blocker", "retry the run"],
    )


@shared_task(name="agents.execute_graph_run")
def execute_graph_run(trace_id: int):
    trace = _load_trace(trace_id)
    return execute_ticket_swarm(trace.task, trace=trace)


@shared_task(name="agents.execute_chain_run")
def execute_chain_run(trace_id: int, instruction: str = ""):
    trace = _load_trace(trace_id)
    try:
        from .swarm_chain import execute_full_swarm_chain

        events = execute_full_swarm_chain(
            task=trace.task,
            instruction=instruction,
            session_id=trace.session_id,
            trace=trace,
        )
        has_approval = any(
            isinstance(e, dict) and e.get("approval_id")
            for e in events
        ) or ApprovalRequest.objects.filter(trace=trace, status=ApprovalRequest.Status.PENDING).exists()

        if has_approval:
            trace.status = AgentExecutionTrace.Status.AWAITING_APPROVAL
            trace.graph_state = {"mode": "chain", "phase": "awaiting_approval", "events_count": len(events)}
        else:
            trace.status = AgentExecutionTrace.Status.COMPLETED
            trace.graph_state = {"mode": "chain", "phase": "completed", "events_count": len(events)}
        trace.steps = events
        trace.finished_at = timezone.now()


        try:
            from .observability.langfuse_client import log_agent_execution_to_langfuse
            lf_url = log_agent_execution_to_langfuse(
                task=trace.task,
                agent_role="chain",
                prompt=instruction or trace.task.description or trace.task.title,
                response_text=f"Swarm chain completed with {len(events)} events",
                thoughts=[event.get("message", "") for event in events if isinstance(event, dict)],
                tool_calls=[],
                tokens=None,
                cost=None,
                session_id=trace.session_id,
            )
            if lf_url:
                trace.langfuse_url = lf_url
        except Exception as lf_err:
            logger.warning(f"Failed to log chain run to Langfuse: {lf_err}")

        trace.save(update_fields=["status", "graph_state", "steps", "langfuse_url", "finished_at"])
        return {"ok": True, "trace_id": trace.id, "events_count": len(events)}
    except Exception as exc:
        _fail_trace(trace, exc)
        raise


@shared_task(name="agents.execute_prompt_run")
def execute_prompt_run(trace_id: int, prompt: str, agent_keys: list[str], user_id: int):
    trace = _load_trace(trace_id)
    user = User.objects.filter(
        pk=user_id,
        organization=trace.task.organization,
    ).first()
    responses = []
    try:
        from .antigravity_sdk import run_antigravity_agent
        from .registry import get_agent_spec, resolve_agent_key

        for requested_key in agent_keys:
            agent_key = resolve_agent_key(requested_key)
            spec = get_agent_spec(agent_key)
            emit_agent_event(
                task=trace.task,
                trace=trace,
                session_id=trace.session_id,
                event_type="started",
                sender_key=agent_key,
                message=f"I received the prompt and am starting the {spec['title']} work now.",
                current_work=f"Responding as {spec['title']}",
                remaining_work=["analyze context", "perform available tools", "report result"],
            )
            result = run_antigravity_agent(
                task=trace.task,
                agent_role=agent_key,
                prompt=prompt,
                user=user,
            )
            responses.append(result)
            emit_agent_event(
                task=trace.task,
                trace=trace,
                session_id=trace.session_id,
                event_type="completed",
                sender_key=agent_key,
                message=result["response"],
                current_work="Prompt response completed",
                remaining_work=[],
                metadata={
                    "child_trace_id": result["trace_id"],
                    "comment_id": result["comment_id"],
                    "tool_calls": result.get("tool_calls", []),
                },
            )

        trace.status = AgentExecutionTrace.Status.COMPLETED
        trace.graph_state = {
            "mode": "prompt",
            "phase": "completed",
            "prompt": prompt,
            "agents": agent_keys,
            "responses": len(responses),
        }
        trace.steps = [
            {
                "node": response["agent_role"],
                "agent_role": response["agent_name"],
                "action": "prompt_response",
                "message": response["response"],
                "timestamp": response.get("created_at", timezone.now().isoformat()),
            }
            for response in responses
        ]
        trace.finished_at = timezone.now()
        trace.save(update_fields=["status", "graph_state", "steps", "finished_at"])
        return {"ok": True, "trace_id": trace.id, "responses": len(responses)}
    except Exception as exc:
        _fail_trace(trace, exc)
        raise


@shared_task(name="agents.execute_release_approval")
def execute_release_approval(approval_id: int):
    """
    Perform the release gate execution after human approval.
    """
    from .models import ApprovalRequest
    from .users import get_or_create_agent_user
    from tasks.models import Comment

    try:
        approval = ApprovalRequest.objects.select_related(
            "task",
            "task__project",
            "task__organization",
            "trace",
        ).get(pk=approval_id)
    except ApprovalRequest.DoesNotExist:
        logger.warning("ApprovalRequest #%s does not exist; skipping release.", approval_id)
        return {"ok": False, "error": "ApprovalRequest not found"}

    if approval.status != ApprovalRequest.Status.APPROVED:
        logger.info("ApprovalRequest #%s is not in approved status (%s); doing nothing.", approval_id, approval.status)
        return {"ok": False, "status": approval.status}

    devops_user = get_or_create_agent_user("devops", approval.organization)
    actor_email = devops_user.email if devops_user else ""

    try:
        if perform_release is None:
            raise RuntimeError("perform_release is not available in agents.release.")

        result = perform_release(
            approval.task,
            branch=approval.branch,
            expected_head_sha=approval.head_sha,
            repo=approval.repo,
            pr_url=approval.pr_url,
            actor_email=actor_email,
        )

        result_dict = result.to_dict() if hasattr(result, "to_dict") else dict(result)
        approval.result = result_dict
        if getattr(result, "merged", False):
            approval.status = ApprovalRequest.Status.EXECUTED
        else:
            approval.status = ApprovalRequest.Status.FAILED
        approval.save(update_fields=["status", "result"])

        author_name = "Alan"
        agent_role = "devops"
        from .registry import get_agent_spec
        spec = get_agent_spec("devops")
        if spec:
            author_name = spec.get("name", author_name)
            agent_role = spec.get("role", agent_role)

        if format_release_comment:
            comment_body = format_release_comment(author_name, agent_role, result)
        else:
            comment_body = f"**{author_name} - {agent_role}**\n\n{getattr(result, 'detail', '')}\n{getattr(result, 'deployment_detail', '')}"
        Comment.objects.create(task=approval.task, author=devops_user, body=comment_body)

        detail = getattr(result, "detail", "")
        deployment_detail = getattr(result, "deployment_detail", "")
        session_id = approval.trace.session_id if approval.trace else f"approval-task-{approval.task_id}"

        if getattr(result, "merged", False):
            emit_agent_event(
                task=approval.task,
                trace=approval.trace,
                session_id=session_id,
                event_type="completed",
                sender_key="devops",
                message=f"Release completed. {detail} {deployment_detail}".strip(),
                current_work="Release completed",
                remaining_work=[],
                metadata={"release": result_dict},
            )
        else:
            emit_agent_event(
                task=approval.task,
                trace=approval.trace,
                session_id=session_id,
                event_type="blocked",
                sender_key="devops",
                message=f"Release not merged. {detail} {deployment_detail}".strip(),
                current_work="Release blocked",
                remaining_work=["investigate release failure"],
                metadata={"release": result_dict},
            )

        if approval.trace:
            trace = approval.trace
            trace.status = AgentExecutionTrace.Status.COMPLETED
            trace.graph_state = {
                **trace.graph_state,
                "release_result": result_dict,
                "phase": "completed" if getattr(result, "merged", False) else "release_failed",
            }
            trace.finished_at = timezone.now()
            trace.save(update_fields=["status", "graph_state", "finished_at"])

        return {"ok": getattr(result, "merged", False), "approval_id": approval.id, "status": approval.status}

    except Exception as exc:
        logger.exception("Unexpected error executing release approval #%s: %s", approval.id, exc)
        approval.status = ApprovalRequest.Status.FAILED
        approval.result = {
            "error": str(exc),
            "merged": False,
            "merge_mode": "none",
            "merged_sha": "",
            "detail": f"Release execution failed: {exc}",
            "pr_url": approval.pr_url,
            "deployment": {},
            "deployment_status": "failed",
            "deployment_detail": str(exc),
        }
        approval.save(update_fields=["status", "result"])

        if approval.trace:
            approval.trace.status = AgentExecutionTrace.Status.FAILED
            approval.trace.graph_state = {**approval.trace.graph_state, "error": str(exc), "phase": "release_failed"}
            approval.trace.finished_at = timezone.now()
            approval.trace.save(update_fields=["status", "graph_state", "finished_at"])

        session_id = approval.trace.session_id if approval.trace else f"approval-task-{approval.task_id}"
        emit_agent_event(
            task=approval.task,
            trace=approval.trace,
            session_id=session_id,
            event_type="failed",
            sender_key="devops",
            message=f"Release execution failed with an unexpected error: {exc}",
            current_work="Release execution failed",
            remaining_work=["investigate failure"],
            metadata={"error": str(exc)},
        )
        return {"ok": False, "approval_id": approval.id, "status": approval.status, "error": str(exc)}

