import os
import shutil
import tempfile

from django.test import TestCase, override_settings
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
from agents import git_service
from agents.directives import detect_directives
from agents.git_service import (
    sanitize_sensitive_data,
    create_remote_repo,
    clone_or_pull,
    commit_and_push,
    _configured_git_identity,
)
from agents.tools.github_tool import (
    tool_create_remote_repo,
    tool_clone_or_pull,
    tool_commit_and_push,
    AGENT_GITHUB_TOOLS,
    TECH_LEAD_GITHUB_TOOLS,
)
from agents.pm_service import decompose_plan_and_create_tasks
from agents.swarm_chain import generate_validation_contract
from agents.state import TicketState
from agents.nodes.backend_agent import backend_agent_node
from agents.nodes.frontend_agent import frontend_agent_node

User = get_user_model()


class AgentRegistryTestCase(TestCase):
    def test_blueprint_roster_has_the_active_pm_seat(self):
        self.assertIn("pm", blueprint_agent_keys())
        self.assertEqual(len(blueprint_agent_keys()), 10)
        self.assertEqual(get_agent_spec("pm")["email_local"], "pm")

    def test_legacy_agent_mentions_resolve_to_primary_seats(self):
        self.assertEqual(resolve_agent_key("backend"), "backend_core")
        self.assertEqual(resolve_agent_key("frontend"), "frontend_app")
        self.assertEqual(resolve_agent_key("backend2"), "backend_integrations")
        self.assertEqual(resolve_agent_key("frontend2"), "frontend_design_system")

    def test_engine_uses_seat_identity_with_existing_domain_permission(self):
        engine = AntigravityAgentEngine("backend_integrations")
        self.assertEqual(engine.agent_key, "backend_integrations")
        self.assertEqual(engine.role, "backend")
        self.assertEqual(engine.spec["email_local"], "backend2")
        self.assertIn("Report only work", engine.spec["system_instructions"])

    def test_agent_users_are_scoped_per_organization(self):
        first_org = Organization.objects.create(name="First")
        second_org = Organization.objects.create(name="Second")
        first = get_or_create_agent_user("backend_core", first_org)
        second = get_or_create_agent_user("backend_core", second_org)
        self.assertNotEqual(first.id, second.id)
        self.assertNotEqual(first.email, second.email)
        self.assertEqual(first.agent_key, resolve_agent_key("backend_core"))
        self.assertEqual(second.agent_key, resolve_agent_key("backend_core"))

    def test_deployment_tool_reports_missing_provider_without_recording(self):
        organization = Organization.objects.create(name="Deployment Tool Org")
        project = Project.objects.create(name="Deployment Tool Project", organization=organization)

        result = trigger_app_deployment(project.id)

        self.assertFalse(result["ok"])
        self.assertIs(result["configured"], False)
        self.assertFalse(project.deployments.exists())

    @override_settings(
        DEPLOY_HOOK_URLS={"staging": "https://deploy.example.invalid/hook"},
        DEPLOY_HOOK_SECRET="test-hook-secret",
    )
    @patch("deployments.providers.requests.post")
    def test_deployment_tool_resolves_agent_from_project_organization(self, mock_post):
        mock_post.return_value = SimpleNamespace(status_code=202, text="queued")
        organization = Organization.objects.create(name="Deployment Tool Org")
        project = Project.objects.create(name="Deployment Tool Project", organization=organization)

        result = trigger_app_deployment(project.id)

        self.assertTrue(result["ok"], result)
        deployment = project.deployments.get(pk=result["deployment_id"])
        self.assertEqual(deployment.status, "in_progress")
        self.assertEqual(deployment.triggered_by.organization, organization)
        self.assertEqual(deployment.triggered_by.agent_key, resolve_agent_key("devops"))


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
        self.assertEqual(response.data["total_agent_seats"], len(blueprint_agent_keys()))
        self.assertEqual(
            {agent["key"] for agent in response.data["active_agents"]},
            set(blueprint_agent_keys()),
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
    def test_platform_token_is_not_shared_with_tenants_by_default(self):
        with patch.dict(os.environ, {"GITHUB_TOKEN": "ghp_platformToken1234567890"}):
            self.assertEqual(git_service.platform_github_token(), "")
            with override_settings(AGENT_ALLOW_PLATFORM_GITHUB_TOKEN=True, GITHUB_TOKEN=""):
                self.assertEqual(git_service.platform_github_token(), "ghp_platformToken1234567890")

    def test_sanitize_redacts_tenant_tokens_too(self):
        text = "remote https://x-access-token:gho_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r.git ghp_ABCDEFGHIJKLMNOPQRSTUVWX"
        cleaned = sanitize_sensitive_data(text)
        self.assertNotIn("gho_abcdefghijklmnopqrstuvwxyz0123", cleaned)
        self.assertNotIn("ghp_ABCDEFGHIJKLMNOPQRSTUVWX", cleaned)

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

    @override_settings(AGENT_ALLOW_PLATFORM_GITHUB_TOKEN=True)
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

    @override_settings(AGENT_ALLOW_PLATFORM_GITHUB_TOKEN=True)
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
            res = clone_or_pull(
                "https://github.com/TeamFlow-Dev/new-repo.git",
                os.path.join(git_service.GENERATED_PROJECTS_ROOT, "new-repo"),
            )
            self.assertTrue(res["success"])
            self.assertEqual(res["action"], "cloned")

    @patch("agents.git_service._run_git_command")
    def test_clone_or_pull_pulls_when_git_dir_exists(self, mock_run):
        mock_run.return_value = {"success": True, "stdout": "Already up to date.", "stderr": "", "returncode": 0}
        with patch("os.path.exists") as mock_exists:
            # .git exists
            mock_exists.return_value = True
            res = clone_or_pull(
                "https://github.com/TeamFlow-Dev/existing-repo.git",
                os.path.join(git_service.GENERATED_PROJECTS_ROOT, "existing-repo"),
            )
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

    def test_configured_git_identity_uses_environment(self):
        with patch.dict(os.environ, {"GIT_AUTHOR_NAME": "Release Bot", "GIT_AUTHOR_EMAIL": "bot@example.invalid"}):
            self.assertEqual(_configured_git_identity(), ("Release Bot", "bot@example.invalid"))

    @override_settings(GIT_AUTHOR_NAME="", GIT_AUTHOR_EMAIL="")
    def test_configured_git_identity_fails_closed_without_configuration(self):
        with patch.dict(os.environ, {"GIT_AUTHOR_NAME": "", "GIT_AUTHOR_EMAIL": ""}):
            with self.assertRaises(RuntimeError):
                _configured_git_identity()


class PMBackendFrontendWorkflowTestCase(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Workflow Test Org")
        self.ceo = User.objects.create_user(
            email="ceo@teamflow.dev",
            name="Human CEO",
            role="ceo",
            organization=self.org,
            password="testpassword123",
        )
        self.project = Project.objects.create(
            name="Realtime Notification Service",
            description="Real-time notification center with SSE streaming, Django REST API, and Next.js 16 UI.",
            organization=self.org,
            owner=self.ceo,
            github_repo="",
        )

    @patch("agents.pm_service._query_llm_for_decomposition", return_value=None)
    def test_pm_decomposes_plan_and_creates_backend_and_frontend_tasks(self, mock_query_llm):
        plan_text = (
            "Build real-time user notification center:\n"
            "- 1. Backend: Django REST API for notifications and Redis pub/sub queue\n"
            "- 2. Frontend: Next.js 16 App Router component with real-time SSE streaming and Sonner toasts"
        )
        result = decompose_plan_and_create_tasks(self.project, plan_text, self.ceo)
        self.assertIn("pm_summary", result)
        self.assertGreaterEqual(len(result["tasks"]), 2)

        # Verify created tasks in DB
        tasks = list(Task.objects.filter(project=self.project))
        self.assertGreaterEqual(len(tasks), 2)

        backend_task = next((t for t in tasks if "backend" in t.title.lower()), tasks[0])
        frontend_task = next((t for t in tasks if "frontend" in t.title.lower() or "interface" in t.title.lower()), tasks[1])

        self.assertIsNotNone(backend_task)
        self.assertIsNotNone(frontend_task)

    @patch("agents.tools.github_tool.open_pull_request")
    @patch("agents.tools.github_tool.create_branch")
    def test_end_to_end_pm_backend_frontend_workflow(self, mock_create_branch, mock_open_pr):
        mock_create_branch.return_value = {"success": True, "branch": "feat/mock"}
        mock_open_pr.return_value = {"pr_url": "https://github.com/example-org/example-repo/pull/42", "is_live_pr": True}

        # 1. PM Phase: Create task with upfront Validation Contract
        task = Task.objects.create(
            project=self.project,
            title="Real-time SSE Notification Center",
            description="End-to-end notification pipeline with backend event stream and frontend dynamic widget.",
            status=Task.Status.TODO,
            task_type=Task.Type.FEATURE,
            priority=Task.Priority.HIGH,
            created_by=self.ceo,
            organization=self.org,
        )
        contract = generate_validation_contract(task, "Implement SSE stream and interactive client component")
        self.assertGreaterEqual(len(contract), 5)
        task.validation_contract = contract
        task.save()

        # 2. Backend Phase: Backend specialist builds API & models
        backend_state: TicketState = {
            "ticket_id": task.id,
            "project_id": self.project.id,
            "project_name": self.project.name,
            "title": task.title,
            "description": task.description,
            "status": "todo",
            "assigned_agent": "backend",
            "priority": "high",
            "task_type": "feature",
            "pr_url": None,
            "qa_result": None,
            "qa_rejection_reason": None,
            "retrieved_context": ["ADR-001: Architecture Decision Record for SSE and Celery queues."],
            "history": [],
            "subtasks": [],
            "code_changes": {},
            "errors": [],
            "deployment_status": None,
            "deployment_logs": None,
            "langfuse_session_id": f"ticket-{task.id}",
            "total_tokens": 0,
            "total_cost_usd": 0.0,
        }

        backend_result = backend_agent_node(backend_state)
        self.assertEqual(backend_result["status"], "in_review")
        self.assertTrue(any(path.startswith("api/") for path in backend_result["code_changes"]))
        # No repository is linked, so nothing may claim a pushed branch or an open PR.
        self.assertEqual(backend_result["pr_url"], "")
        self.assertEqual(len(backend_result["files_modified"]), 1)
        self.assertIn("files_modified", TicketState.__annotations__)
        self.assertTrue(
            git_service.is_isolated_workspace(backend_result["workspace_path"]),
            backend_result["workspace_path"],
        )
        self.assertGreater(backend_result["total_tokens"], 0)
        self.assertEqual(backend_result["assigned_agent"], "tech_lead")

        # 3. Frontend Phase: Frontend specialist builds Next.js 16 UI with SSE & Generative UI
        frontend_state: TicketState = {
            "ticket_id": task.id,
            "project_id": self.project.id,
            "project_name": self.project.name,
            "title": task.title,
            "description": task.description,
            "status": "in_review",
            "assigned_agent": "frontend",
            "priority": "high",
            "task_type": "feature",
            "pr_url": backend_result["pr_url"],
            "qa_result": None,
            "qa_rejection_reason": None,
            "retrieved_context": ["ADR-002: Next.js 16 App Router and React 19 Client State"],
            "history": backend_result["history"],
            "subtasks": [],
            "code_changes": backend_result["code_changes"],
            "errors": [],
            "deployment_status": None,
            "deployment_logs": None,
            "langfuse_session_id": f"ticket-{task.id}",
            "total_tokens": backend_result["total_tokens"],
            "total_cost_usd": backend_result["total_cost_usd"],
        }

        frontend_result = frontend_agent_node(frontend_state)
        self.assertEqual(frontend_result["status"], "in_review")

        # Verify component created in code_changes
        gen_components = [k for k in frontend_result["code_changes"].keys() if "frontend/src/components/generated/" in k]
        self.assertGreater(len(gen_components), 0)
        component_content = frontend_result["code_changes"][gen_components[0]]
        self.assertIn('"use client"', component_content)
        self.assertIn("useOptimistic", component_content)
        self.assertIn("EventSource", component_content)
        self.assertIn("sonner", component_content)
        self.assertIn("lucide-react", component_content)

        # Verify zero emojis policy in code and step messages
        for step in frontend_result["history"]:
            self.assertNotIn("🎨", step["message"])
            self.assertNotIn("💻", step["message"])

        # Verify token and cost accumulation across workflow
        self.assertGreater(frontend_result["total_tokens"], backend_result["total_tokens"])
        self.assertGreater(frontend_result["total_cost_usd"], backend_result["total_cost_usd"])


class AgentWorkspaceIsolationTestCase(TestCase):
    """Agent git operations must stay inside generated project workspaces."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="teamflow-isolation-")
        self.projects_root = os.path.join(self.root, "generated_projects")
        os.makedirs(self.projects_root)
        patcher = patch.object(git_service, "GENERATED_PROJECTS_ROOT", self.projects_root)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(shutil.rmtree, self.root, True)

    def _workspace(self, name="7_demo"):
        path = os.path.join(self.projects_root, name)
        git_service.bootstrap_new_project_repo(path, "Demo")
        return path

    def test_git_refuses_to_run_without_a_workspace(self):
        result = git_service._run_git_command(["status"], cwd=None)
        self.assertFalse(result["success"])
        self.assertTrue(result.get("isolation_error"))

    def test_git_refuses_to_run_in_the_platform_checkout(self):
        from django.conf import settings

        result = git_service._run_git_command(["status"], cwd=str(settings.BASE_DIR))
        self.assertFalse(result["success"])
        self.assertTrue(result.get("isolation_error"))

    def test_uninitialized_workspace_never_reaches_a_parent_repository(self):
        path = os.path.join(self.projects_root, "8_uninitialized")
        os.makedirs(path)
        result = git_service._run_git_command(["rev-parse", "--show-toplevel"], cwd=path)
        self.assertFalse(result["success"])
        self.assertTrue(result.get("isolation_error"))

    def test_workspace_is_a_standalone_repository(self):
        path = self._workspace()
        top = git_service._run_git_command(["rev-parse", "--show-toplevel"], cwd=path)
        self.assertTrue(top["success"], top)
        self.assertEqual(os.path.normcase(os.path.realpath(top["stdout"])), os.path.normcase(os.path.realpath(path)))

    def test_push_without_remote_is_reported_as_not_pushed(self):
        path = self._workspace()
        result = git_service.git_push("feat/demo", cwd=path)
        self.assertFalse(result["success"])
        self.assertTrue(result.get("is_local"))

    def test_pull_without_remote_is_reported_as_skipped(self):
        path = self._workspace()
        result = git_service.git_pull("main", cwd=path)
        self.assertFalse(result["success"])
        self.assertTrue(result.get("skipped"))

    def test_merge_outside_a_workspace_is_refused(self):
        result = git_service.git_merge_pull_request("", "feat/demo", "main", cwd=None)
        self.assertFalse(result["success"])

    def test_merge_failure_is_reported(self):
        path = self._workspace()
        result = git_service.git_merge_pull_request("", "feat/does-not-exist", "main", cwd=path)
        self.assertFalse(result["success"])
        self.assertEqual(result["merged_sha"], "")

    @patch.dict(os.environ, {"AGENT_PROTECTED_REPOS": "Example-Org/Platform"})
    def test_protected_repository_is_never_configured_or_cloned(self):
        path = self._workspace()
        self.assertTrue(git_service.is_protected_repo("https://github.com/example-org/platform.git"))
        self.assertIsNone(git_service._ensure_origin_configured(path, "example-org/platform", "token"))
        remotes = git_service._run_git_command(["remote"], cwd=path)
        self.assertNotIn("origin", remotes["stdout"].split())

        clone = git_service.clone_or_pull(
            "https://github.com/example-org/platform.git",
            os.path.join(self.projects_root, "9_clone"),
        )
        self.assertFalse(clone["success"])
        self.assertEqual(clone["action"], "refused")

    @override_settings(AGENT_ALLOW_PLATFORM_GITHUB_TOKEN=True, GITHUB_ORG="")
    def test_repository_is_not_guessed_from_folder_names(self):
        path = self._workspace("3_payments-service")
        with patch.dict(os.environ, {"GITHUB_ORG": "example-org"}):
            repo, _token, org = git_service._resolve_project_repo_and_token(path)
        self.assertEqual(repo, "")
        self.assertEqual(org, "example-org")

    def test_simulated_repository_is_not_linked_to_a_project(self):
        organization = Organization.objects.create(name="Repo Org")
        project = Project.objects.create(name="Repo Project", organization=organization)
        with patch.dict(os.environ, {"GITHUB_TOKEN": "", "GH_TOKEN": ""}):
            result = git_service.devops_create_project_repo(project)
        self.assertFalse(result["ok"])
        self.assertEqual(result["status_code"], 503)
        project.refresh_from_db()
        self.assertEqual(project.github_repo, "")


class AgentDirectiveTestCase(TestCase):
    def test_only_explicit_directives_trigger_workspace_actions(self):
        self.assertEqual(detect_directives("Add push notifications to the dashboard"), set())
        self.assertEqual(detect_directives("Address the pull request feedback"), set())
        self.assertEqual(detect_directives("Write the latest test fixtures"), set())
        self.assertEqual(detect_directives("How do I run the build?"), set())
        self.assertEqual(detect_directives("Please git push"), {"push"})
        self.assertEqual(
            detect_directives("Pull the latest changes, then run the build and push the branch"),
            {"pull", "build", "push"},
        )


class StaticCheckTestCase(TestCase):
    def test_bracket_balance_heuristic(self):
        check = git_service.check_js_bracket_balance
        self.assertIsNone(check("export const A = () => (<p>Don't {x}</p>);\n", "a.tsx"))
        self.assertIsNone(check('const s = "x"; function f() { return [1]; }\n', "b.ts"))
        self.assertIsNone(check("const r = s.replace(/[)]/g, '');\n", "c.ts"))
        self.assertIsNone(check("// ) comment\nconst y = { a: 1 }; /* ] */\n", "d.ts"))
        self.assertIn("Unclosed", check("function f() {\n", "e.ts"))
        self.assertIn("Mismatched", check("const x = (1];\n", "f.ts"))


class CodeWriterPathSafetyTestCase(TestCase):
    def test_model_supplied_paths_stay_inside_the_workspace(self):
        from agents.code_writer import safe_workspace_path

        workspace = tempfile.mkdtemp(prefix="teamflow-writer-")
        self.addCleanup(shutil.rmtree, workspace, True)
        for unsafe in (
            ".git/hooks/pre-commit",
            "src/../.git/config",
            "../outside.py",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "..\\..\\escape.py",
            "sub/.GIT/hooks/post-checkout",
            "",
        ):
            self.assertIsNone(safe_workspace_path(workspace, unsafe), unsafe)
        resolved = safe_workspace_path(workspace, "./api/views.py")
        self.assertEqual(resolved, os.path.join(os.path.realpath(workspace), "api", "views.py"))
