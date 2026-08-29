import json
import os
import re
import time

from django.db import close_old_connections
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, views
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from projects.models import Project
from tasks.models import Comment, Task

from .models import AgentEvent, AgentExecutionTrace, CodebaseEmbedding
from .ollama_service import is_ollama_available
from .queue import (
    AgentQueueError,
    is_worker_available,
    queue_chain_run,
    queue_graph_run,
    queue_prompt_run,
)
from .rag.ingest import ingest_sample_knowledge_base
from .registry import active_agent_status
from .serializers import AgentEventSerializer, AgentExecutionTraceSerializer
from .tools.redis_tool import is_event_bus_available


def _organization_task(request, task_id):
    if request.user.organization_id is None:
        raise PermissionDenied("An organization is required for agent operations.")
    return get_object_or_404(
        Task.objects.select_related("project", "organization"),
        pk=task_id,
        organization=request.user.organization,
    )


def _event_queryset(request):
    if request.user.organization_id is None:
        raise PermissionDenied("An organization is required for agent operations.")
    queryset = AgentEvent.objects.filter(
        organization=request.user.organization,
    ).select_related("sender", "task", "project", "trace")
    project_id = request.query_params.get("project")
    task_id = request.query_params.get("task")
    session_id = request.query_params.get("session")
    if project_id:
        queryset = queryset.filter(project_id=project_id)
    if task_id:
        queryset = queryset.filter(task_id=task_id)
    if session_id:
        queryset = queryset.filter(session_id=session_id)
    return queryset


def _queue_error_response(exc):
    return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


class AgentDispatchView(views.APIView):
    """Queue a LangGraph run for an organization-owned ticket."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, task_id):
        task = _organization_task(request, task_id)
        try:
            trace = queue_graph_run(task)
        except AgentQueueError as exc:
            return _queue_error_response(exc)
        return Response(
            {
                "message": "Multi-agent swarm queued.",
                "trace": AgentExecutionTraceSerializer(trace).data,
                "task_status": task.status,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class AgentTracesView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, task_id=None):
        if request.user.organization_id is None:
            raise PermissionDenied("An organization is required for agent operations.")
        traces = AgentExecutionTrace.objects.filter(
            task__organization=request.user.organization,
        ).select_related("task", "task__project")
        if task_id:
            traces = traces.filter(task_id=task_id)
        else:
            traces = traces[:50]
        return Response(AgentExecutionTraceSerializer(traces, many=True).data)


class AgentIngestRAGView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if request.user.organization_id is None:
            raise PermissionDenied("An organization is required for agent operations.")
        project_id = request.data.get("project_id")
        project = None
        if project_id:
            project = get_object_or_404(
                Project,
                pk=project_id,
                organization=request.user.organization,
            )
        count = ingest_sample_knowledge_base(project=project, organization=request.user.organization)
        return Response(
            {
                "message": f"Successfully ingested {count} scoped knowledge chunks.",
                "chunks_ingested": count,
            }
        )


class AgentStatusView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        organization = request.user.organization
        if organization is None:
            raise PermissionDenied("An organization is required for agent operations.")
        model_available = is_ollama_available() or bool(os.getenv("OPENAI_API_KEY"))
        event_bus_available = is_event_bus_available()
        worker_available = event_bus_available and is_worker_available()
        traces = AgentExecutionTrace.objects.filter(task__organization=organization)
        agents_list = active_agent_status(engine_available=model_available)
        return Response(
            {
                "orchestration_framework": "Google Antigravity SDK compatibility layer & LangGraph",
                "model_engine_status": "ready" if model_available else "offline",
                "worker_queue_status": "ready" if worker_available else "offline",
                "event_bus_status": "ready" if event_bus_available else "offline",
                "vector_store": "PostgreSQL + pgvector",
                "observability": "Langfuse",
                "memory_queue": "Redis",
                "total_agent_seats": len(agents_list),
                "active_agents": agents_list,
                "rag_embeddings_count": CodebaseEmbedding.objects.filter(organization=organization).count(),
                "total_swarms_executed": traces.count(),
                "successful_swarms": traces.filter(status=AgentExecutionTrace.Status.COMPLETED).count(),
            }
        )


class AntigravityAgentRunView(views.APIView):
    """Queue a prompt for a specific organization-owned agent seat."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        task_id = request.data.get("task_id")
        agent_role = request.data.get("agent_role", "tech_lead")
        prompt = request.data.get("prompt", "").strip()
        if not task_id or not prompt:
            return Response(
                {"detail": "Both task_id and prompt are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        task = _organization_task(request, task_id)
        try:
            trace = queue_prompt_run(task, prompt, request.user, specific_tag=agent_role)
        except AgentQueueError as exc:
            return _queue_error_response(exc)
        return Response(
            {"message": "Agent prompt queued.", "trace": AgentExecutionTraceSerializer(trace).data},
            status=status.HTTP_202_ACCEPTED,
        )


class SwarmChainExecuteView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, task_id):
        task = _organization_task(request, task_id)
        instruction = request.data.get("instruction", "").strip()
        try:
            trace = queue_chain_run(task, instruction)
        except AgentQueueError as exc:
            return _queue_error_response(exc)
        return Response(
            {
                "message": f"Multi-agent swarm chain queued for ticket #{task.id}.",
                "task_id": task.id,
                "task_status": task.status,
                "trace": AgentExecutionTraceSerializer(trace).data,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class AgentEventsView(views.APIView):
    """Return persisted lifecycle events, incrementally after an event ID."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        try:
            after_id = max(0, int(request.query_params.get("after", 0)))
            limit = min(200, max(1, int(request.query_params.get("limit", 100))))
        except (TypeError, ValueError):
            return Response({"detail": "after and limit must be integers."}, status=400)
        events = _event_queryset(request).filter(id__gt=after_id).order_by("id")[:limit]
        data = AgentEventSerializer(events, many=True).data
        return Response({"events": data, "last_event_id": data[-1]["id"] if data else after_id})


class AgentEventStreamView(views.APIView):
    """Authenticated SSE stream with bounded connections and resumable IDs."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        try:
            after_id = max(0, int(request.query_params.get("after", 0)))
        except (TypeError, ValueError):
            return Response({"detail": "after must be an integer."}, status=400)

        organization_id = request.user.organization_id
        project_id = request.query_params.get("project")
        task_id = request.query_params.get("task")
        session_id = request.query_params.get("session")

        def stream():
            last_id = after_id
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                close_old_connections()
                queryset = AgentEvent.objects.filter(
                    organization_id=organization_id,
                    id__gt=last_id,
                ).select_related("sender", "task", "project", "trace").order_by("id")
                if project_id:
                    queryset = queryset.filter(project_id=project_id)
                if task_id:
                    queryset = queryset.filter(task_id=task_id)
                if session_id:
                    queryset = queryset.filter(session_id=session_id)

                sent = False
                for event in queryset[:100]:
                    payload = AgentEventSerializer(event).data
                    last_id = event.id
                    sent = True
                    yield f"id: {event.id}\nevent: agent_event\ndata: {json.dumps(payload)}\n\n"
                if not sent:
                    yield ": keep-alive\n\n"
                time.sleep(1)
            close_old_connections()

        response = StreamingHttpResponse(stream(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache, no-transform"
        response["X-Accel-Buffering"] = "no"
        return response


class SwarmLiveFeedView(views.APIView):
    """Legacy comment feed retained for existing clients, now tenant scoped."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        comments_qs = Comment.objects.filter(
            task__organization=request.user.organization,
        ).select_related("author", "task", "task__project").order_by("-created_at")
        project_id = request.query_params.get("project")
        task_id = request.query_params.get("task")
        if project_id:
            comments_qs = comments_qs.filter(task__project_id=project_id)
        if task_id:
            comments_qs = comments_qs.filter(task_id=task_id)

        feed_items = []
        for comment in comments_qs[:50]:
            author_name = comment.author.name or comment.author.email if comment.author else "TeamFlow"
            author_role = getattr(comment.author, "role", "system") if comment.author else "system"
            target_agent = "Swarm"
            target_match = re.search(r"➔\s*@([a-zA-Z0-9_\s\(\)]+?)(?:\]|\n|\:)", comment.body)
            if target_match:
                target_agent = target_match.group(1).strip()
            feed_items.append(
                {
                    "id": f"comment-{comment.id}",
                    "type": "comment",
                    "sender_name": author_name,
                    "sender_role": author_role,
                    "target_agent": target_agent,
                    "content": comment.body,
                    "task_id": comment.task_id,
                    "task_title": comment.task.title,
                    "project_id": comment.task.project_id,
                    "project_name": comment.task.project.name,
                    "created_at": comment.created_at.isoformat(),
                }
            )
        return Response({"feed": feed_items, "total_events": len(feed_items)})
