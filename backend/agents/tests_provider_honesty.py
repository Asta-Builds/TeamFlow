import unittest
from unittest.mock import patch, MagicMock
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from agents.models import AgentExecutionTrace
from tasks.models import Task
from projects.models import Project
from organizations.models import Organization

# We mock llm because LLMResult might not be defined if Task A is not done yet.
try:
    from agents.llm import LLMResult
except ImportError:
    from dataclasses import dataclass
    from typing import Optional
    @dataclass
    class LLMResult:
        text: Optional[str] = None
        provider: Optional[str] = None
        model: Optional[str] = None
        duration_s: float = 0.0
        attempts: int = 0
        error: Optional[str] = None
        prompt_tokens: Optional[int] = None
        output_tokens: Optional[int] = None
        total_tokens: Optional[int] = None

from agents.observability.langfuse_client import log_agent_execution_to_langfuse
from agents.antigravity_sdk import run_antigravity_agent, AntigravityAgentEngine
from agents.nodes.backend_agent import backend_agent_node
from agents.tasks import execute_chain_run
from deployments.models import Deployment

User = get_user_model()

@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class ProviderHonestyTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Test Org")
        self.project = Project.objects.create(name="Test Project", organization=self.org)
        self.user = User.objects.create_user(email="test@example.com", name="Test User", organization=self.org)
        self.task = Task.objects.create(title="Test Task", project=self.project, organization=self.org, status=Task.Status.TODO)
        self.trace = AgentExecutionTrace.objects.create(
            task=self.task,
            session_id="test-session",
            status=AgentExecutionTrace.Status.RUNNING,
            graph_state={}
        )

    @patch("agents.observability.langfuse_client.get_langfuse_client")
    def test_langfuse_no_invented_usage(self, mock_get_client):
        """1. log_agent_execution_to_langfuse sends no usage/cost if None, and real numbers if provided."""
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_trace = MagicMock()
        mock_client.trace.return_value = mock_trace

        log_agent_execution_to_langfuse(
            task=self.task,
            agent_role="test",
            prompt="hello",
            response_text="world",
            thoughts=[],
            tool_calls=[],
            tokens=None,
            cost=None,
        )

        # Assert no usage or cost in the kwargs
        generation_kwargs = mock_trace.generation.call_args[1]
        self.assertNotIn("usage", generation_kwargs)
        self.assertNotIn("cost_usd", generation_kwargs.get("metadata", {}))
        
        # Test with real numbers
        mock_trace.reset_mock()
        log_agent_execution_to_langfuse(
            task=self.task,
            agent_role="test",
            prompt="hello",
            response_text="world",
            thoughts=[],
            tool_calls=[],
            tokens=42,
            cost=0.005,
        )
        generation_kwargs = mock_trace.generation.call_args[1]
        self.assertEqual(generation_kwargs["usage"]["total"], 42)
        self.assertEqual(generation_kwargs["metadata"]["cost_usd"], 0.005)

    @patch("agents.tools.app_tool.trigger_app_deployment")
    @patch("agents.antigravity_sdk.AntigravityAgentEngine._build_antigravity_response")
    def test_devops_no_configured_provider(self, mock_build, mock_trigger):
        """2. DevOps agent with no provider leaves Task alone, creates no Deployment, says not configured."""
        mock_build.return_value = ("Original response", None)
        mock_trigger.return_value = {"ok": False, "configured": False, "error": "None"}
        
        initial_deploy_count = Deployment.objects.count()
        
        result = run_antigravity_agent(self.task, "devops", "Deploy to staging", user=self.user)
        
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, Task.Status.TODO)
        self.assertEqual(Deployment.objects.count(), initial_deploy_count)
        self.assertIn("No deployment provider is configured", result["response"])

    @patch("agents.llm.generate_text_detailed")
    @patch("agents.antigravity_sdk.AntigravityAgentEngine._check_sdk")
    @patch("agents.observability.langfuse_client.log_agent_execution_to_langfuse")
    def test_antigravity_agent_result_tokens(self, mock_log, mock_check, mock_generate):
        """3. AntigravityAgentResult uses real tokens_used from LLMResult, and 4. subagents_spawned is empty."""
        mock_check.return_value = False
        
        # Test with 77 tokens
        mock_generate.return_value = LLMResult(text="response", total_tokens=77)
        engine = AntigravityAgentEngine(agent_role="tech_lead")
        res1 = engine.execute_agent_sync(self.task, "test", [])
        self.assertEqual(res1.tokens_used, 77)
        self.assertEqual(res1.subagents_spawned, [])
        
        # Test with None tokens
        mock_generate.return_value = LLMResult(text="response", total_tokens=None)
        res2 = engine.execute_agent_sync(self.task, "test", [])
        self.assertIsNone(res2.tokens_used)

    @patch("agents.nodes.backend_agent.generate_text_detailed")
    @patch("agents.nodes.backend_agent.git_pull")
    @patch("agents.nodes.backend_agent.git_checkout_branch")
    @patch("agents.nodes.backend_agent.run_project_build")
    @patch("agents.nodes.backend_agent.git_commit")
    @patch("agents.nodes.backend_agent.git_push")
    def test_backend_agent_accumulates_tokens(self, *mocks):
        """5. Backend node adds reported tokens, unchanged if None."""
        mock_generate = mocks[-1]
        
        # Return 100 tokens
        mock_generate.return_value = LLMResult(text="FILE: test.py\nCODE:\nprint(1)", total_tokens=100)
        state = {"ticket_id": self.task.id, "total_tokens": 50, "workspace_path": "/tmp"}
        new_state = backend_agent_node(state)
        self.assertEqual(new_state["total_tokens"], 150)
        
        # Return None tokens
        mock_generate.return_value = LLMResult(text="FILE: test.py\nCODE:\nprint(1)", total_tokens=None)
        state = {"ticket_id": self.task.id, "total_tokens": 50, "workspace_path": "/tmp"}
        new_state2 = backend_agent_node(state)
        self.assertEqual(new_state2["total_tokens"], 50)

    @patch("agents.swarm_chain.execute_full_swarm_chain")
    @patch("agents.observability.langfuse_client.log_agent_execution_to_langfuse")
    def test_execute_chain_run_langfuse_crash(self, mock_log, mock_exec):
        """6. execute_chain_run still completes if Langfuse crashes (NameError regression)."""
        mock_exec.return_value = []
        mock_log.side_effect = Exception("Langfuse boom")
        
        res = execute_chain_run(self.trace.id, "do things")
        self.assertTrue(res["ok"])
        
        self.trace.refresh_from_db()
        self.assertEqual(self.trace.status, AgentExecutionTrace.Status.COMPLETED)
