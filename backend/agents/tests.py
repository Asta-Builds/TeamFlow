from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from types import SimpleNamespace
from unittest.mock import patch
from organizations.models import Organization
from projects.models import Project
from tasks.models import Task
from agents.models import AgentEvent, AgentExecutionTrace, CodebaseEmbedding
from agents.events import emit_agent_event
from agents.users import get_or_create_agent_user
from agents.rag.embeddings import generate_embedding, cosine_similarity
from agents.rag.vector_store import query_similar_chunks
from agents.rag.ingest import ingest_sample_knowledge_base
from agents.graph import execute_ticket_swarm
from agents.antigravity_sdk import AntigravityAgentEngine
from agents.registry import blueprint_agent_keys, get_agent_spec, resolve_agent_key
from agents.tools.app_tool import trigger_app_deployment
from agents.git_service import (
    sanitize_sensitive_data,
    create_remote_repo,
    clone_or_pull,
    commit_and_push,
)
from agents.tools.github_tool import (
    tool_create_remote_repo,
    tool_clone_or_pull,
    tool_commit_and_push,
    AGENT_GITHUB_TOOLS,
    TECH_LEAD_GITHUB_TOOLS,
)

User = get_user_model()


class AgentRegistryTestCase(TestCase):
    def test_blueprint_roster_has_nine_specialist_seats(self):
        """The public roster matches the 1+2+2+1+1+1+1 company blueprint."""
        self.assertEqual(len(blueprint_agent_keys()), 9)
        self.assertEqual(get_agent_spec("backend_integrations")["email"], "backend2@teamflow.dev")
        self.assertEqual(get_agent_spec("frontend_design_system")["email"], "frontend2@teamflow.dev")

    def test_legacy_agent_mentions_resolve_to_primary_seats(self):
        self.assertEqual(resolve_agent_key("backend"), "backend_core")
        self.assertEqual(resolve_agent_key("frontend"), "frontend_app")
        self.assertEqual(resolve_agent_key("backend2"), "backend_integrations")
        self.assertEqual(resolve_agent_key("frontend2"), "frontend_design_system")

    def test_engine_uses_seat_identity_with_existing_domain_permission(self):
        engine = AntigravityAgentEngine("backend_integrations")
        self.assertEqual(engine.agent_key, "backend_integrations")
        self.assertEqual(engine.role, "backend")
        self.assertEqual(engine.spec["email"], "backend2@teamflow.dev")
        self.assertIn("Report only work", engine.spec["system_instructions"])

    def test_agent_users_are_scoped_per_organization(self):
        first_org = Organization.objects.create(name="First")
        second_org = Organization.objects.create(name="Second")
        first = get_or_create_agent_user("backend_core", first_org)
        second = get_or_create_agent_user("backend_core", second_org)
        self.assertNotEqual(first.id, second.id)
        self.assertNotEqual(first.email, second.email)
        self.assertEqual(first.agent_key, "backend_core")
        self.assertEqual(second.agent_key, "backend_core")

    def test_deployment_tool_resolves_agent_from_project_organization(self):
        organization = Organization.objects.create(name="Deployment Tool Org")
        project = Project.objects.create(name="Deployment Tool Project", organization=organization)

        result = trigger_app_deployment(project.id)

        self.assertTrue(result["ok"], result)
        deployment = project.deployments.get(pk=result["deployment_id"])
        self.assertEqual(deployment.triggered_by.organization, organization)
        self.assertEqual(deployment.triggered_by.agent_key, "devops")


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
            organization=self.org,
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

    def test_rag_retrieval_requires_a_tenant_scope(self):
        ingest_sample_knowledge_base(project=self.project)
        other_org = Organization.objects.create(name="Other RAG Org")
        other_project = Project.objects.create(
            name="Private Project",
            organization=other_org,
        )
        CodebaseEmbedding.objects.create(
            organization=other_org,
            project=other_project,
            file_path="private/secret.md",
            chunk_index=0,
            content="JWT authentication refresh tokens private tenant secret",
            embedding=generate_embedding("JWT authentication refresh tokens private tenant secret"),
        )

        self.assertEqual(query_similar_chunks("JWT authentication refresh tokens"), [])
        results = query_similar_chunks(
            "JWT authentication refresh tokens",
            project_id=self.project.id,
            organization_id=self.org.id,
        )
        self.assertTrue(results)
        self.assertNotIn("private/secret.md", {item["file_path"] for item in results})

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

    @patch("agents.queue.execute_graph_run.delay")
    def test_agent_dispatch_api_endpoint(self, delay):
        """Test POST /api/agents/dispatch/<task_id>/"""
        delay.return_value = SimpleNamespace(id="celery-job-1")
        response = self.client.post(f"/api/agents/dispatch/{self.task.id}/")
        self.assertEqual(response.status_code, 202)
        self.assertIn("trace", response.data)
        self.assertEqual(response.data["task_status"], "todo")
        self.assertEqual(response.data["trace"]["status"], "running")
        self.assertTrue(
            AgentEvent.objects.filter(
                task=self.task,
                event_type=AgentEvent.Type.QUEUED,
            ).exists()
        )
        delay.assert_called_once()

    @patch("agents.views.is_worker_available", return_value=False)
    @patch("agents.views.is_event_bus_available", return_value=False)
    @patch("agents.views.is_ollama_available", return_value=False)
    def test_agent_status_api_endpoint(self, _ollama, _redis, _worker):
        """Test GET /api/agents/status/"""
        response = self.client.get("/api/agents/status/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("LangGraph", response.data["orchestration_framework"])
        self.assertEqual(response.data["model_engine_status"], "offline")
        self.assertEqual(response.data["worker_queue_status"], "offline")
        self.assertEqual(response.data["event_bus_status"], "offline")
        self.assertEqual(response.data["total_agent_seats"], 9)
        self.assertEqual(
            {agent["key"] for agent in response.data["active_agents"]},
            {
                "tech_lead",
                "backend_core",
                "backend_integrations",
                "frontend_app",
                "frontend_design_system",
                "devops",
                "qa",
                "designer",
                "seo",
            },
        )

    @patch("agents.views.is_worker_available", return_value=False)
    @patch("agents.views.is_event_bus_available", return_value=True)
    @patch("agents.views.is_ollama_available", return_value=True)
    def test_agent_status_does_not_treat_redis_as_a_worker(self, _ollama, _redis, _worker):
        response = self.client.get("/api/agents/status/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["event_bus_status"], "ready")
        self.assertEqual(response.data["worker_queue_status"], "offline")

    @patch("agents.queue.execute_graph_run.delay")
    def test_agent_dispatch_cannot_access_another_tenant_task(self, delay):
        other_org = Organization.objects.create(name="Other Org")
        other_project = Project.objects.create(name="Other", organization=other_org)
        other_task = Task.objects.create(
            project=other_project,
            organization=other_org,
            title="Private task",
        )
        response = self.client.post(f"/api/agents/dispatch/{other_task.id}/")
        self.assertEqual(response.status_code, 404)
        delay.assert_not_called()

    def test_event_feed_is_tenant_scoped(self):
        own_trace = AgentExecutionTrace.objects.create(task=self.task, session_id="own")
        emit_agent_event(
            task=self.task,
            trace=own_trace,
            session_id="own",
            event_type="progress",
            message="Own update",
        )

        other_org = Organization.objects.create(name="Other Org")
        other_project = Project.objects.create(name="Other", organization=other_org)
        other_task = Task.objects.create(
            project=other_project,
            organization=other_org,
            title="Private task",
        )
        other_trace = AgentExecutionTrace.objects.create(task=other_task, session_id="other")
        emit_agent_event(
            task=other_task,
            trace=other_trace,
            session_id="other",
            event_type="progress",
            message="Other update",
        )

        response = self.client.get("/api/agents/events/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([event["message"] for event in response.data["events"]], ["Own update"])

    def test_authenticated_event_stream_emits_persisted_update(self):
        trace = AgentExecutionTrace.objects.create(task=self.task, session_id="stream")
        event = emit_agent_event(
            task=self.task,
            trace=trace,
            session_id="stream",
            event_type="progress",
            sender_key="backend_core",
            message="Implementing the scoped API update",
            current_work="Writing tenant checks",
            remaining_work=["run tests", "handoff"],
        )

        response = self.client.get(
            f"/api/agents/events/stream/?project={self.project.id}&after={event.id - 1}"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/event-stream")
        first_chunk = next(iter(response.streaming_content)).decode("utf-8")
        self.assertIn(f"id: {event.id}", first_chunk)
        self.assertIn("Implementing the scoped API update", first_chunk)
        self.assertIn("Writing tenant checks", first_chunk)

    @patch("agents.queue.execute_prompt_run.delay")
    def test_tagged_comment_queues_prompt_without_blocking(self, delay):
        delay.return_value = SimpleNamespace(id="prompt-job-1")
        response = self.client.post(
            f"/api/tasks/{self.task.id}/comments/",
            {"body": "@backend please inspect this"},
            format="json",
        )
        self.assertEqual(response.status_code, 202, response.content)
        self.assertEqual(response.data["agent_run"]["status"], "running")
        delay.assert_called_once()

    def test_member_cannot_dispatch_agents_or_read_another_workspace_trace(self):
        other_org = Organization.objects.create(name="Other Org Member")
        other_user = User.objects.create_user(
            email="member@other-org.dev",
            password="password123",
            organization=other_org,
        )
        other_project = Project.objects.create(name="Other Project", owner=other_user, organization=other_org)
        other_task = Task.objects.create(
            project=other_project,
            title="Other task",
            created_by=other_user,
            organization=other_org,
        )
        AgentExecutionTrace.objects.create(
            task=other_task,
            session_id="ticket-other",
            status=AgentExecutionTrace.Status.COMPLETED,
        )

        self.client.force_authenticate(user=other_user)
        self.assertEqual(self.client.post(f"/api/agents/dispatch/{other_task.id}/").status_code, 403)

        self.client.force_authenticate(user=self.user)
        self.assertEqual(self.client.get(f"/api/agents/traces/{other_task.id}/").data, [])


class AgentGitToolsTestCase(TestCase):
    def test_sanitize_sensitive_data_redacts_tokens(self):
        with patch.dict("os.environ", {"GITHUB_TOKEN": "ghp_secretToken12345"}):
            raw_url = "https://x-access-token:ghp_secretToken12345@github.com/org/repo.git"
            sanitized = sanitize_sensitive_data(raw_url)
            self.assertNotIn("ghp_secretToken12345", sanitized)
            self.assertIn("***", sanitized)

    def test_create_remote_repo_simulated_without_token(self):
        with patch.dict("os.environ", {"GITHUB_TOKEN": "", "GH_TOKEN": ""}, clear=True):
            res = create_remote_repo("my-new-microservice", description="Test repo")
            self.assertTrue(res["success"])
            self.assertTrue(res.get("simulated", False))
            self.assertEqual(res["repo_name"], "my-new-microservice")
            self.assertIn("github.com", res["clone_url"])

    @patch("requests.post")
    def test_create_remote_repo_via_api(self, mock_post):
        mock_post.return_value = SimpleNamespace(
            status_code=201,
            json=lambda: {
                "name": "payment-service",
                "full_name": "TeamFlow-Dev/payment-service",
                "html_url": "https://github.com/TeamFlow-Dev/payment-service",
                "clone_url": "https://github.com/TeamFlow-Dev/payment-service.git",
                "default_branch": "main",
            },
        )
        with patch.dict("os.environ", {"GITHUB_TOKEN": "ghp_mocktoken"}):
            res = create_remote_repo("payment-service", description="Payments API")
            self.assertTrue(res["success"])
            self.assertFalse(res.get("simulated", True))
            self.assertEqual(res["repo_name"], "payment-service")
            self.assertEqual(res["html_url"], "https://github.com/TeamFlow-Dev/payment-service")
            mock_post.assert_called_once()

    @patch("requests.get")
    @patch("requests.post")
    def test_create_remote_repo_already_exists(self, mock_post, mock_get):
        mock_post.return_value = SimpleNamespace(
            status_code=422,
            json=lambda: {"message": "name already exists on this account"},
        )
        mock_get.return_value = SimpleNamespace(
            status_code=200,
            json=lambda: {
                "name": "payment-service",
                "full_name": "TeamFlow-Dev/payment-service",
                "html_url": "https://github.com/TeamFlow-Dev/payment-service",
                "clone_url": "https://github.com/TeamFlow-Dev/payment-service.git",
                "default_branch": "main",
            },
        )
        with patch.dict("os.environ", {"GITHUB_TOKEN": "ghp_mocktoken"}):
            res = create_remote_repo("payment-service")
            self.assertTrue(res["success"])
            self.assertTrue(res.get("exists", False))
            self.assertEqual(res["repo_name"], "payment-service")

    @patch("agents.git_service._run_git_command")
    def test_clone_or_pull_clones_when_no_git_dir(self, mock_run):
        mock_run.return_value = {"success": True, "stdout": "Cloning into...", "stderr": "", "returncode": 0}
        with patch("os.path.exists") as mock_exists:
            # .git does not exist
            mock_exists.return_value = False
            res = clone_or_pull("https://github.com/TeamFlow-Dev/new-repo.git", "/tmp/sandbox/new-repo")
            self.assertTrue(res["success"])
            self.assertEqual(res["action"], "cloned")

    @patch("agents.git_service._run_git_command")
    def test_clone_or_pull_pulls_when_git_dir_exists(self, mock_run):
        mock_run.return_value = {"success": True, "stdout": "Already up to date.", "stderr": "", "returncode": 0}
        with patch("os.path.exists") as mock_exists:
            # .git exists
            mock_exists.return_value = True
            res = clone_or_pull("https://github.com/TeamFlow-Dev/existing-repo.git", "/tmp/sandbox/existing-repo")
            self.assertTrue(res["success"])
            self.assertEqual(res["action"], "pulled")

    @patch("agents.git_service.git_push")
    @patch("agents.git_service.git_commit")
    @patch("agents.git_service.git_checkout_branch")
    @patch("os.path.exists")
    def test_commit_and_push(self, mock_exists, mock_checkout, mock_commit, mock_push):
        mock_exists.return_value = True
        mock_checkout.return_value = {"success": True}
        mock_commit.return_value = {"success": True, "committed": True, "sha": "abc1234", "output": "commit ok"}
        mock_push.return_value = {"success": True, "output": "push ok"}

        res = commit_and_push("/tmp/sandbox/repo", "feat(auth): add keycloak auth", branch="feat/auth")
        self.assertTrue(res["success"])
        self.assertEqual(res["sha"], "abc1234")
        self.assertTrue(res["pushed"])
        mock_commit.assert_called_once()
        mock_push.assert_called_once()

    def test_langchain_tools_structure(self):
        self.assertTrue(hasattr(tool_create_remote_repo, "name"))
        self.assertTrue(hasattr(tool_clone_or_pull, "name"))
        self.assertTrue(hasattr(tool_commit_and_push, "name"))
        self.assertGreaterEqual(len(AGENT_GITHUB_TOOLS), 5)
        self.assertGreaterEqual(len(TECH_LEAD_GITHUB_TOOLS), len(AGENT_GITHUB_TOOLS) + 1)
