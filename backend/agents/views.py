import re
from rest_framework import status, views, permissions
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from tasks.models import Task
from .models import AgentExecutionTrace, CodebaseEmbedding
from .registry import active_agent_status
from .serializers import AgentExecutionTraceSerializer, CodebaseEmbeddingSerializer
from .graph import execute_ticket_swarm
from .rag.ingest import ingest_sample_knowledge_base


class AgentDispatchView(views.APIView):
    """
    POST /api/agents/dispatch/<int:task_id>/
    Dispatches the LangGraph Multi-Agent Swarm on a specific ticket.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, task_id):
        task = get_object_or_404(Task, pk=task_id)
        result = execute_ticket_swarm(task)
        
        if result.get("ok"):
            task.refresh_from_db()
            trace = AgentExecutionTrace.objects.get(pk=result["trace_id"])
            return Response(
                {
                    "message": "Multi-agent swarm execution completed successfully.",
                    "trace": AgentExecutionTraceSerializer(trace).data,
                    "task_status": task.status,
                },
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {
                    "message": "Multi-agent execution encountered an issue.",
                    "error": result.get("error"),
                    "trace_id": result.get("trace_id"),
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class AgentTracesView(views.APIView):
    """
    GET /api/agents/traces/
    GET /api/agents/traces/<int:task_id>/
    Retrieves multi-agent trace logs and Langfuse session links.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, task_id=None):
        if task_id:
            traces = AgentExecutionTrace.objects.filter(task_id=task_id).order_by("-created_at")
        else:
            traces = AgentExecutionTrace.objects.all().order_by("-created_at")[:50]
        
        serializer = AgentExecutionTraceSerializer(traces, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class AgentIngestRAGView(views.APIView):
    """
    POST /api/agents/ingest-rag/
    Ingests codebase, ADRs, and documentation chunks into pgvector store.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        project_id = request.data.get("project_id")
        project = None
        if project_id:
            from projects.models import Project
            project = get_object_or_404(Project, pk=project_id)

        count = ingest_sample_knowledge_base(project=project)
        return Response(
            {
                "message": f"Successfully ingested {count} architectural documents & code chunks into pgvector RAG store.",
                "chunks_ingested": count,
            },
            status=status.HTTP_200_OK,
        )


class AgentStatusView(views.APIView):
    """
    GET /api/agents/status/
    Returns multi-agent cluster status, Antigravity SDK readiness, pgvector stats, and seats.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        total_embeddings = CodebaseEmbedding.objects.count()
        total_traces = AgentExecutionTrace.objects.count()
        successful_traces = AgentExecutionTrace.objects.filter(status=AgentExecutionTrace.Status.COMPLETED).count()

        agents_list = active_agent_status()

        return Response(
            {
                "orchestration_framework": "Google Antigravity SDK & LangGraph Swarm",
                "antigravity_sdk_status": "enabled",
                "vector_store": "PostgreSQL + pgvector",
                "observability": "Langfuse",
                "memory_queue": "Redis",
                "total_agent_seats": len(agents_list),
                "active_agents": agents_list,
                "rag_embeddings_count": total_embeddings,
                "total_swarms_executed": total_traces,
                "successful_swarms": successful_traces,
            },
            status=status.HTTP_200_OK,
        )


class AntigravityAgentRunView(views.APIView):
    """
    POST /api/agents/antigravity/run/
    Executes an autonomous agent directly using the Google Antigravity SDK.
    Body: { "task_id": 1, "agent_role": "tech_lead", "prompt": "@tech_lead review architecture" }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        task_id = request.data.get("task_id")
        agent_role = request.data.get("agent_role", "tech_lead")
        prompt = request.data.get("prompt", "").strip()

        if not task_id or not prompt:
            return Response({"detail": "Both task_id and prompt are required."}, status=status.HTTP_400_BAD_REQUEST)

        task = get_object_or_404(Task, pk=task_id)

        from .antigravity_sdk import run_antigravity_agent
        result = run_antigravity_agent(
            task=task,
            agent_role=agent_role,
            prompt=prompt,
            user=request.user
        )

        return Response(result, status=status.HTTP_200_OK)


class SwarmChainExecuteView(views.APIView):
    """
    POST /api/agents/swarm-chain/<int:task_id>/
    Triggers the full multi-agent sequential chain where agents communicate, hand off,
    write code, run tests, and merge into main.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, task_id):
        task = get_object_or_404(Task, pk=task_id)
        instruction = request.data.get("instruction", "").strip()

        from .swarm_chain import execute_full_swarm_chain
        events = execute_full_swarm_chain(
            task=task,
            trigger_user=request.user,
            instruction=instruction
        )
        task.refresh_from_db()

        return Response({
            "message": f"Multi-agent swarm chain completed for ticket #{task.id}.",
            "task_id": task.id,
            "task_status": task.status,
            "chain_events": events,
            "events_count": len(events),
        }, status=status.HTTP_200_OK)


class SwarmLiveFeedView(views.APIView):
    """
    GET /api/agents/swarm-feed/?project=<id>&task=<id>
    Real-time communication flux & activity stream between agents and the CEO.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from tasks.models import TaskActivity, Comment
        project_id = request.query_params.get("project")
        task_id = request.query_params.get("task")

        comments_qs = Comment.objects.all().select_related("author", "task", "task__project").order_by("-created_at")
        if project_id:
            comments_qs = comments_qs.filter(task__project_id=project_id)
        if task_id:
            comments_qs = comments_qs.filter(task_id=task_id)

        comments = comments_qs[:50]

        feed_items = []
        for c in comments:
            author_name = c.author.name or c.author.email if c.author else "TeamFlow Agent"
            author_role = getattr(c.author, "role", "agent") if c.author else "agent"
            
            # Detect target agent in body (e.g. ➔ @Cleopatra or @backend)
            target_agent = "Swarm"
            if "➔ @" in c.body:
                target_match = re.search(r'➔\s*@([a-zA-Z0-9_\s\(\)]+?)(?:\]|\n|\:)', c.body)
                if target_match:
                    target_agent = target_match.group(1).strip()
            elif "@" in c.body:
                target_match = re.search(r'@([a-zA-Z0-9_]+)', c.body)
                if target_match:
                    target_agent = target_match.group(1).strip()

            feed_items.append({
                "id": f"comment-{c.id}",
                "type": "agent_message" if "@" in c.body or "➔" in c.body else "comment",
                "sender_name": author_name,
                "sender_role": author_role,
                "target_agent": target_agent,
                "content": c.body,
                "task_id": c.task_id,
                "task_title": c.task.title,
                "project_id": c.task.project_id,
                "project_name": c.task.project.name if c.task.project else "Project",
                "created_at": c.created_at.isoformat(),
            })

        return Response({
            "feed": feed_items,
            "total_events": len(feed_items),
        }, status=status.HTTP_200_OK)

