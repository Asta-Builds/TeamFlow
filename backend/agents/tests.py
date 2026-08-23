from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from organizations.models import Organization
from projects.models import Project
from tasks.models import Task
from agents.models import AgentExecutionTrace, CodebaseEmbedding
from agents.rag.embeddings import generate_embedding, cosine_similarity
from agents.rag.vector_store import query_similar_chunks
from agents.rag.ingest import ingest_sample_knowledge_base
from agents.graph import execute_ticket_swarm

User = get_user_model()


class MultiAgentTestCase(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="TeamFlow Test Org")
        self.user = User.objects.create_user(
            email="lead@teamflow.dev",
            name="Sarah Jenkins",
            role="tech_lead",
            organization=self.org,
            password="testpassword123",
        )
        self.project = Project.objects.create(
            name="Core Platform",
            organization=self.org,
            owner=self.user,
        )
        self.task = Task.objects.create(
            project=self.project,
            title="Implement JWT token refresh race condition fix",
            description="Fix concurrency lock when refreshing tokens from multi-tab browser sessions.",
            status=Task.Status.TODO,
            task_type="bug",
            priority="high",
            created_by=self.user,
            assignee=self.user,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_rag_embeddings_and_retrieval(self):
        """Test RAG ingestion and vector similarity search."""
        count = ingest_sample_knowledge_base(project=self.project)
        self.assertGreater(count, 0)
        self.assertEqual(CodebaseEmbedding.objects.count(), count)

        results = query_similar_chunks("JWT authentication refresh tokens", project_id=self.project.id)
        self.assertGreater(len(results), 0)
        self.assertIn("ADR-001", results[0]["file_path"])

    def test_multi_agent_swarm_execution(self):
        """Test end-to-end execution of the LangGraph multi-agent swarm on a ticket."""
        ingest_sample_knowledge_base(project=self.project)
        result = execute_ticket_swarm(self.task)

        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "completed")
        self.assertIn("ticket-", result["session_id"])
        
        # Verify trace created
        trace = AgentExecutionTrace.objects.get(pk=result["trace_id"])
        self.assertEqual(trace.task, self.task)
        self.assertGreater(len(trace.steps), 0)
        self.assertGreater(trace.tokens_used, 0)

        # Verify task was updated to done
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, Task.Status.DONE)

    def test_agent_dispatch_api_endpoint(self):
        """Test POST /api/agents/dispatch/<task_id>/"""
        response = self.client.post(f"/api/agents/dispatch/{self.task.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("trace", response.data)
        self.assertEqual(response.data["task_status"], "done")

    def test_agent_status_api_endpoint(self):
        """Test GET /api/agents/status/"""
        response = self.client.get("/api/agents/status/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["orchestration_framework"], "LangGraph (LangChain)")
        self.assertEqual(response.data["total_agent_seats"], 9)
