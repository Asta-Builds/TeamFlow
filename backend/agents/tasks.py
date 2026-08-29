"""Celery entrypoints for non-blocking agent runs."""

from __future__ import annotations

from celery import shared_task
from django.contrib.auth import get_user_model
from django.utils import timezone

from .events import emit_agent_event
from .graph import execute_ticket_swarm
from .models import AgentExecutionTrace

User = get_user_model()


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
        trace.status = AgentExecutionTrace.Status.COMPLETED
        trace.graph_state = {"mode": "chain", "phase": "completed", "events_count": len(events)}
        trace.steps = events
        trace.finished_at = timezone.now()
        trace.save(update_fields=["status", "graph_state", "steps", "finished_at"])
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
