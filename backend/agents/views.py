from rest_framework import status, views, permissions
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from tasks.models import Task
from .models import AgentExecutionTrace, CodebaseEmbedding
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
    Returns multi-agent cluster status, LangGraph readiness, pgvector stats, and seats.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        total_embeddings = CodebaseEmbedding.objects.count()
        total_traces = AgentExecutionTrace.objects.count()
        successful_traces = AgentExecutionTrace.objects.filter(status=AgentExecutionTrace.Status.COMPLETED).count()

        agents_list = [
            {"role": "tech_lead", "name": "Sarah Jenkins", "title": "Tech Lead (Orchestrator)", "status": "active"},
            {"role": "backend_1", "name": "Marcus Aurelius", "title": "Senior Backend Agent (Core API)", "status": "active"},
            {"role": "backend_2", "name": "Hypatia of Alexandria", "title": "Backend Agent (Integrations)", "status": "active"},
            {"role": "frontend_1", "name": "Cleopatra Philopator", "title": "Senior Frontend Agent (Web App)", "status": "active"},
            {"role": "frontend_2", "name": "Augustus Caesar", "title": "Frontend Agent (Design System)", "status": "active"},
            {"role": "qa", "name": "Alan Turing", "title": "QA Automation Gate Agent", "status": "active"},
            {"role": "devops", "name": "Joan of Arc", "title": "DevOps & Release Agent", "status": "active"},
            {"role": "designer", "name": "Leonardo DaVinci", "title": "UI/UX Specialist Agent", "status": "active"},
            {"role": "seo", "name": "Ada Lovelace", "title": "SEO & Performance Agent", "status": "active"},
        ]

        return Response(
            {
                "orchestration_framework": "LangGraph (LangChain)",
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
