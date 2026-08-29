"""Tenant-safe queueing helpers shared by API and comment workflows."""

from __future__ import annotations

from django.utils import timezone

from .events import create_pending_trace, emit_agent_event
from .models import AgentExecutionTrace
from .tasks import execute_chain_run, execute_graph_run, execute_prompt_run


class AgentQueueError(RuntimeError):
    pass


def is_worker_available() -> bool:
    """Return whether at least one Celery worker answers a bounded ping."""
    try:
        from teamflow.celery import app

        inspector = app.control.inspect(timeout=1)
        return bool(inspector.ping())
    except Exception:
        return False


def _dispatch(trace, celery_task, *args):
    try:
        result = celery_task.delay(trace.id, *args)
        trace.graph_state = {
            **trace.graph_state,
            "celery_task_id": str(result.id),
        }
        trace.save(update_fields=["graph_state"])
        return trace
    except Exception as exc:
        trace.status = AgentExecutionTrace.Status.FAILED
        trace.graph_state = {**trace.graph_state, "phase": "queue_failed", "error": str(exc)}
        trace.finished_at = timezone.now()
        trace.save(update_fields=["status", "graph_state", "finished_at"])
        emit_agent_event(
            task=trace.task,
            trace=trace,
            session_id=trace.session_id,
            event_type="failed",
            message=f"The background run could not be queued: {exc}",
            current_work="Queue connection failed",
            remaining_work=["restore the worker queue", "retry the run"],
        )
        raise AgentQueueError("The agent worker queue is unavailable.") from exc


def queue_graph_run(task):
    trace = create_pending_trace(task, "graph")
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=trace.session_id,
        event_type="queued",
        message="The autonomous graph run is queued and waiting for an agent worker.",
        current_work="Waiting for worker capacity",
        remaining_work=["ticket analysis", "specialist work", "review", "QA", "release handoff"],
    )
    return _dispatch(trace, execute_graph_run)


def queue_chain_run(task, instruction: str = ""):
    trace = create_pending_trace(task, "chain")
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=trace.session_id,
        event_type="queued",
        message="The sequential swarm run is queued and waiting for an agent worker.",
        current_work="Waiting for worker capacity",
        remaining_work=["planning", "backend", "frontend", "QA", "merge review", "release handoff"],
    )
    return _dispatch(trace, execute_chain_run, instruction)


def resolve_prompt_agent_keys(prompt: str, specific_tag: str | None = None) -> list[str]:
    from .agent_prompter import AGENT_TAG_MAP, extract_agent_tags
    from .registry import blueprint_agent_keys, resolve_agent_key

    tags = [specific_tag] if specific_tag and specific_tag in AGENT_TAG_MAP else extract_agent_tags(prompt)
    if not tags:
        tags = ["tech_lead"]
    if "all" in tags:
        return blueprint_agent_keys()

    keys = []
    for tag in tags:
        meta = AGENT_TAG_MAP.get(tag)
        key = resolve_agent_key(meta["key"] if meta else tag)
        if key not in keys:
            keys.append(key)
    return keys


def queue_prompt_run(task, prompt: str, user, specific_tag: str | None = None):
    agent_keys = resolve_prompt_agent_keys(prompt, specific_tag)
    trace = create_pending_trace(task, "prompt")
    trace.graph_state = {
        **trace.graph_state,
        "prompt": prompt,
        "agents": agent_keys,
    }
    trace.save(update_fields=["graph_state"])
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=trace.session_id,
        event_type="queued",
        message=f"The prompt is queued for {len(agent_keys)} agent seat(s).",
        current_work="Waiting for worker capacity",
        remaining_work=["agent analysis", "available tool work", "response"],
        metadata={"agents": agent_keys},
    )
    return _dispatch(trace, execute_prompt_run, prompt, agent_keys, user.id)
