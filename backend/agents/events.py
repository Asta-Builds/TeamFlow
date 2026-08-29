"""Persistence helpers for truthful, streamable agent-run updates."""

from __future__ import annotations

import uuid

from .models import AgentEvent, AgentExecutionTrace
from .users import get_or_create_agent_user


def ensure_task_organization(task):
    if task.organization_id is None and task.project.organization_id:
        task.organization = task.project.organization
        task.save(update_fields=["organization"])
    if task.organization_id is None:
        raise ValueError("Agent runs require a task owned by an organization.")
    return task


def create_pending_trace(task, mode: str) -> AgentExecutionTrace:
    ensure_task_organization(task)
    session_id = f"{mode}-task-{task.id}-{uuid.uuid4().hex[:10]}"
    return AgentExecutionTrace.objects.create(
        task=task,
        session_id=session_id,
        status=AgentExecutionTrace.Status.RUNNING,
        graph_state={"mode": mode, "phase": "queued"},
    )


def emit_agent_event(
    *,
    task,
    session_id: str,
    event_type: str,
    message: str,
    sender_key: str = "",
    recipient_key: str = "",
    current_work: str = "",
    remaining_work=None,
    metadata=None,
    trace=None,
) -> AgentEvent:
    ensure_task_organization(task)
    sender = None
    if sender_key:
        sender = get_or_create_agent_user(sender_key, task.organization)
        sender_key = sender.agent_key
    return AgentEvent.objects.create(
        organization=task.organization,
        project=task.project,
        task=task,
        trace=trace,
        session_id=session_id,
        event_type=event_type,
        sender=sender,
        sender_key=sender_key,
        recipient_key=recipient_key,
        message=message,
        current_work=current_work,
        remaining_work=list(remaining_work or []),
        metadata=dict(metadata or {}),
    )


def emit_state_event(state: dict, **kwargs):
    """Emit an event from a LangGraph state without putting callbacks in state."""
    from tasks.models import Task

    task_id = state.get("ticket_id")
    session_id = state.get("langfuse_session_id")
    if not task_id or not session_id:
        return None
    task = Task.objects.select_related("project", "organization").get(pk=task_id)
    trace = AgentExecutionTrace.objects.filter(session_id=session_id, task=task).first()
    return emit_agent_event(
        task=task,
        session_id=session_id,
        trace=trace,
        **kwargs,
    )
