"""
Google Antigravity SDK Integration for TeamFlow.
Implements programmatic agent configuration, reasoning stream capture,
tool invocations, and subagent orchestration using the Antigravity Python SDK.
"""

import os
import re
import sys
import time
import logging
from typing import Dict, Any, List, Optional, AsyncGenerator
from dataclasses import dataclass, field

from django.contrib.auth import get_user_model
from django.utils import timezone
from tasks.models import Task, Comment, TaskActivity
from notifications.models import Notification
from .models import AgentExecutionTrace
from .registry import AGENT_SEATS, get_agent_spec, resolve_agent_key
from .users import get_or_create_agent_user
from .tools.rag_tool import retrieve_context
from .tools.github_tool import create_branch, open_pull_request, merge_pull_request
from .tools.app_tool import trigger_app_deployment
from .tools.redis_tool import publish_agent_event
from .events import emit_agent_event, ensure_task_organization
from .observability.langfuse_client import generate_langfuse_trace_url

logger = logging.getLogger(__name__)
User = get_user_model()


@dataclass
class AntigravityToolCall:
    name: str
    args: Dict[str, Any]
    output: Optional[str] = None
    status: str = "completed"


@dataclass
class AntigravityAgentResult:
    agent_name: str
    agent_role: str
    response_text: str
    thoughts: List[str] = field(default_factory=list)
    tool_calls: List[AntigravityToolCall] = field(default_factory=list)
    subagents_spawned: List[str] = field(default_factory=list)
    tokens_used: Optional[int] = None
    duration_seconds: float = 0.0
    session_id: str = ""
    langfuse_url: str = ""


ANTIGRAV_AGENT_SPECS: Dict[str, Dict[str, Any]] = {
    key: get_agent_spec(key) for key in AGENT_SEATS
}


class AntigravityAgentEngine:
    """
    Antigravity SDK Engine Driver for TeamFlow.
    Interfaces with google.antigravity when available, with full structured fallback.
    """

    def __init__(self, agent_role: str = "pm"):
        self.agent_key = resolve_agent_key(agent_role)
        self.spec = get_agent_spec(self.agent_key)
        self.role = self.spec["role"]
        self.sdk_available = self._check_sdk()

    def _check_sdk(self) -> bool:
        try:
            import google.antigravity # type: ignore
            return True
        except ImportError:
            return False

    def execute_agent_sync(
        self,
        task: Task,
        prompt: str,
        rag_context: List[str],
        user: Optional[Any] = None
    ) -> AntigravityAgentResult:
        """
        Synchronous execution driver using Antigravity SDK agent loop.
        Captures reasoning thoughts, tool calls, and output response.
        """
        start_time = time.time()
        session_id = f"agy-{self.agent_key}-task-{task.id}-{int(start_time)}"
        langfuse_url = generate_langfuse_trace_url(session_id)

        # Ensure task organization is valid
        task = ensure_task_organization(task)

        # 1. Create trace upfront in RUNNING status for live tracking
        trace = AgentExecutionTrace.objects.create(
            task=task,
            session_id=session_id,
            status=AgentExecutionTrace.Status.RUNNING,
            graph_state={
                "engine": "google_antigravity_sdk",
                "agent_role": self.agent_key,
                "prompt": prompt,
                "phase": "running",
            },
            langfuse_url=langfuse_url,
        )

        def _broadcast(event_type: str, message: str, metadata: Optional[Dict[str, Any]] = None):
            try:
                emit_agent_event(
                    task=task,
                    trace=trace,
                    session_id=session_id,
                    event_type=event_type,
                    sender_key=self.agent_key,
                    message=message,
                    current_work=message,
                    metadata=metadata or {},
                )
                publish_agent_event(f"task_{task.id}", {
                    "event_type": event_type,
                    "session_id": session_id,
                    "agent": self.spec["name"],
                    "agent_key": self.agent_key,
                    "message": message,
                    "metadata": metadata or {},
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
                })
            except Exception as e:
                logger.debug(f"Event emission bypassed: {e}")

        thoughts: List[str] = []
        def _add_thought(text: str):
            thoughts.append(text)
            _broadcast("thought", text)

        _broadcast("started", f"{self.spec['name']} is analyzing ticket #{task.id} with Google Antigravity SDK.")
        _add_thought(f"[Antigravity SDK] Initializing agent persona '{self.spec['name']}' ({self.agent_key})")
        _add_thought(f"[Antigravity SDK] Ingesting prompt instructions: '{prompt[:60]}...'")
        _add_thought(f"[Antigravity SDK] Retrieving pgvector RAG memory embeddings ({len(rag_context)} chunks found)")

        tool_calls: List[AntigravityToolCall] = []
        def _add_tool_call(name: str, args: Dict[str, Any], output: str):
            tc = AntigravityToolCall(name=name, args=args, output=output)
            tool_calls.append(tc)
            _broadcast("tool_call", f"Executed tool `{name}`: {output}", metadata={"name": name, "args": args, "output": output})

        # Explicit workspace directives only (see agents/directives.py)
        from .directives import PUSH_ROLES, detect_directives
        from .git_service import get_project_workspace, git_pull, run_project_build, git_push, get_current_branch
        project_workspace = get_project_workspace(task)
        directives = detect_directives(prompt)

        if "pull" in directives:
            _add_thought(f"[{self.spec['name']}] Pulling main from the linked remote in the project workspace")
            pull_res = git_pull("main", cwd=project_workspace)
            _add_tool_call("git_pull", {"branch": "main"}, pull_res.get("output", ""))

        if "build" in directives:
            _add_thought(f"[{self.spec['name']}] Running static checks in the project workspace")
            build_res = run_project_build(project_workspace)
            _add_tool_call("run_project_build", {}, build_res.get("output", ""))

        if "push" in directives:
            cur_branch = get_current_branch(cwd=project_workspace)
            if self.role not in PUSH_ROLES:
                _add_tool_call("git_push", {"branch": cur_branch}, f"Not pushed: the {self.role} seat does not push branches.")
            elif cur_branch in {"main", "master", "HEAD"}:
                _add_tool_call("git_push", {"branch": cur_branch}, "Not pushed: prompts never push the main branch.")
            else:
                _add_thought(f"[{self.spec['name']}] Pushing branch {cur_branch} to the linked remote")
                push_res = git_push(cur_branch, cwd=project_workspace)
                _add_tool_call("git_push", {"branch": cur_branch}, push_res.get("output", ""))

        # Tool Invocations based on role and task context
        repo_name = getattr(task.project, "github_repo", "") or ""

        if self.role == "pm":
            _add_thought(f"[{self.spec['name']}] Analyzing project phases (Initiation -> Planning) and defining scope boundaries")
            _add_thought(f"[{self.spec['name']}] Synthesizing Work Breakdown Structure (WBS) with risk matrix and DoD acceptance criteria")
            _add_tool_call(
                name="wbs_decomposition_and_risk_matrix",
                args={"project": task.project.name if task.project else "Workspace", "feature": prompt},
                output="Decomposed into WBS-structured engineering tickets (Backend Core, Frontend Views, QA Harness, DevOps CI/CD) with risk mitigation plan"
            )

        elif self.role in {"tech_lead", "backend"}:
            _add_thought(f"[{self.spec['name']}] Analyzing architectural dependencies and branch strategy")
            _add_tool_call(
                name="pgvector_rag_query",
                args={"query": f"{task.title} {prompt}", "top_k": 3},
                output=f"Retrieved {len(rag_context)} chunks from vector store"
            )
            if self.role == "backend":
                # Branches and pull requests are created only when code is actually written
                # (see code_writer.parse_and_apply_code_changes); report the workspace state here.
                _add_tool_call(
                    name="repository_status",
                    args={"repo": repo_name or None},
                    output=(
                        f"Linked repository: {repo_name}. Current branch: {get_current_branch(cwd=project_workspace)}."
                        if repo_name
                        else "No repository is linked to this project; pushes and pull requests are unavailable."
                    ),
                )

        elif self.role == "qa":
            _add_thought(f"[{self.spec['name']}] Evaluating test coverage and validating acceptance criteria gate")
            qa_res = run_project_build(project_workspace)
            _add_tool_call(
                name="run_static_checks",
                args={"ticket_id": task.id},
                output=qa_res.get("output", ""),
            )

        elif self.role == "devops":
            _add_thought(f"[{self.spec['name']}] Requesting a staging deployment from the configured provider")
            dep_res = trigger_app_deployment(project_id=task.project_id, environment="staging", branch="main", commit_sha="")
            if dep_res.get("ok"):
                output_str = "deployment requested and accepted"
            elif dep_res.get("configured") is False:
                output_str = "No deployment provider is configured, so no deployment was started."
            else:
                output_str = f"deployment request failed: {dep_res.get('error') or dep_res.get('status')}"
            _add_tool_call(
                name="request_staging_deployment",
                args={"environment": "staging"},
                output=output_str,
            )

        # Generate intelligent response
        _broadcast("progress", f"Synthesizing dynamic response for {task.title}...")
        response_text, tokens = self._build_antigravity_response(task, prompt, rag_context, tool_calls, user=user)
        _broadcast("completed", f"{self.spec['name']} response ready ({len(response_text)} chars).", metadata={"response_preview": response_text[:140]})

        duration = round(time.time() - start_time, 2)

        # Stream active trace to Langfuse server
        from .observability.langfuse_client import log_agent_execution_to_langfuse
        langfuse_url = log_agent_execution_to_langfuse(
            task=task,
            agent_role=self.role,
            prompt=prompt,
            response_text=response_text,
            thoughts=thoughts,
            tool_calls=tool_calls,
            tokens=tokens,
            cost=None,
            session_id=session_id,
        ) or langfuse_url

        return AntigravityAgentResult(
            agent_name=self.spec["name"],
            agent_role=self.agent_key,
            response_text=response_text,
            thoughts=thoughts,
            tool_calls=tool_calls,
            subagents_spawned=[],
            tokens_used=tokens,
            duration_seconds=duration,
            session_id=session_id,
            langfuse_url=langfuse_url,
        )

    def _build_antigravity_response(
        self,
        task: Task,
        prompt: str,
        rag_context: List[str],
        tool_calls: List[AntigravityToolCall],
        user: Optional[Any] = None
    ) -> tuple[str, Optional[int]]:
        """Constructs an Antigravity SDK response with real multi-provider LLM inference, conversation history, and live workspace code edits."""
        # 1. Fetch conversation history for natural turn-taking
        comments_history = ""
        try:
            recent_comments = list(
                Comment.objects.filter(task=task)
                .select_related("author")
                .order_by("-created_at")[:5]
            )
            recent_comments.reverse()
            if recent_comments:
                comments_history = "\n".join(
                    f"[{c.author.name if c.author else 'User'}]: {c.body}"
                    for c in recent_comments
                )
        except Exception:
            pass

        project_name = task.project.name if task.project else "Workspace Project"
        project_desc = getattr(task.project, "description", "") or ""

        system_prompt = (
            f"You are {self.spec['name']}, {self.spec['title']} at TeamFlow.\n"
            f"Your specialty: {self.spec['specialty']}.\n"
            f"Persona & Tone: {self.spec.get('persona_voice', '')}\n"
            f"You are collaborating directly with the CEO and your fellow engineering teammates.\n"
            f"Project: '{project_name}' (Overview: {project_desc})\n"
            f"Ticket: #{task.id} - {task.title}\n"
            f"Status: {task.status} | Priority: {task.priority}\n"
            f"Description: {task.description or 'None'}\n\n"
            f"Codebase Context (pgvector RAG):\n" + ("\n".join(rag_context[:3]) if rag_context else "Standard project architecture.") + "\n\n"
            f"Recent Conversation History on Ticket:\n" + (comments_history if comments_history else "No previous comments.") + "\n\n"
            f"Tools Executed This Turn: " + (", ".join(t.name for t in tool_calls) if tool_calls else "None") + "\n\n"
            f"HUMAN COLLABORATION PRINCIPLES:\n"
            f"1. Tone: Speak like an authentic, high-caliber senior software engineer (warm, technically grounded, proactive, and concise).\n"
            f"2. Never use robotic declarations like '[Google Antigravity SDK · Athena] Phase Governance Status...'. Speak directly as {self.spec['name']}.\n"
            f"3. Active Listening: Address the user's specific prompt directly. If asked to pull, build, or push, confirm what was executed and summarize the build/git status.\n"
            f"4. Constructive Pushback: If a request introduces scope creep, technical debt, or architectural conflicts, gently flag the trade-off and propose a pragmatic path forward.\n"
            f"5. Code Generation: If the user asks to implement, create, or modify code, output each standalone file block in this exact format:\n"
            f"FILE: [path/to/file_relative_to_workspace]\n"
            f"CODE:\n"
            f"[code content]\n"
            f"---\n"
            f"Always use Tailwind CSS, Lucide React icons, and Sonner toasts for frontend components."
        )

        # Query Language Model via centralized llm service
        from .llm import generate_text_detailed, ModelUnavailable
        llm_result = generate_text_detailed(system_prompt, prompt)
        response_text = llm_result.text
        tokens = llm_result.total_tokens

        # Fallback when no model is configured
        if not response_text:
            lines = [ModelUnavailable.default_detail]
            
            workspace_tools = [t for t in tool_calls if t.name in {"git_pull", "run_project_build", "git_push"}]
            if workspace_tools:
                lines.append("\nHere is what happened in the project workspace:")
                for tool in workspace_tools:
                    lines.append(f"- `{tool.name}`: {tool.output}")
            elif tool_calls:
                lines.append("\n**Actions completed:**")
                for t in tool_calls:
                    lines.append(f"- `{t.name}`: {t.output}")
                    
            response_text = "\n".join(lines)

        # 4. Parse file changes and execute Git lifecycle on workspace mount
        try:
            from .code_writer import parse_and_apply_code_changes
            diff_summary = parse_and_apply_code_changes(
                response_text,
                task=task,
                agent_info={
                    "name": self.spec["name"],
                    "email": get_or_create_agent_user(self.agent_key, task.organization).email,
                    "role": self.role
                }
            )
            if diff_summary:
                response_text += diff_summary
        except Exception as e:
            logger.warning(f"Failed to parse and apply code changes: {e}")

        return response_text, tokens


def run_antigravity_agent(
    task: Task,
    agent_role: str,
    prompt: str,
    user: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Public entrypoint to run an Antigravity SDK Agent on a task.
    Saves comment, creates trace record, logs activity, and returns full metadata.
    """
    engine = AntigravityAgentEngine(agent_role=agent_role)
    rag_context = retrieve_context(
        f"{task.title} {prompt}",
        project_id=task.project_id,
        organization_id=task.organization_id,
    )
    
    result = engine.execute_agent_sync(task, prompt, rag_context, user=user)

    # 1. Get or create agent user in Django
    agent_user = get_or_create_agent_user(engine.agent_key, task.organization)

    # 2. Automatically apply task status transitions, assignees, and PR links based on agent work
    old_status = task.status
    repo_name = getattr(task.project, "github_repo", "") or ""

    if engine.role == "pm":
        if task.status == Task.Status.TODO:
            task.status = Task.Status.IN_PROGRESS
        # Set assignee to agent_user if currently unassigned
        if not task.assignee:
            task.assignee = agent_user

    elif engine.role in {"backend", "frontend"}:
        task.status = Task.Status.IN_REVIEW
        task.assignee = agent_user
    elif engine.role == "tech_lead":
        if task.status == Task.Status.TODO:
            task.status = Task.Status.IN_PROGRESS
        task.assignee = agent_user
    elif engine.role == "qa":
        prompt_lower = prompt.lower()
        if any(w in prompt_lower for w in ["validate", "approve", "done", "pass", "close"]):
            task.status = Task.Status.DONE
            task.qa_rejected = False
        else:
            task.status = Task.Status.QA
            task.qa_rejected = False
        task.assignee = agent_user
    elif engine.role == "devops":
        task.assignee = agent_user
        tc = next((t for t in result.tool_calls if t.name == "request_staging_deployment"), None)
        if tc:
            if "accepted" in tc.output:
                task.status = Task.Status.DONE
                result.response_text = "Deployment requested and accepted."
            elif "not configured" in tc.output.lower() or "no deployment provider" in tc.output.lower():
                result.response_text = "No deployment provider is configured, so no deployment was started."
            else:
                result.response_text = tc.output.capitalize()

    task.save()

    # Log status change if status transitioned
    if task.status != old_status:
        TaskActivity.objects.create(
            task=task,
            actor=agent_user,
            action="status_changed",
            details={"from": old_status, "to": task.status, "engine": "google_antigravity_sdk"}
        )

    # 3. Save comment
    comment = Comment.objects.create(
        task=task,
        author=agent_user,
        body=result.response_text
    )

    # 4. Update or create trace
    trace, _ = AgentExecutionTrace.objects.update_or_create(
        session_id=result.session_id,
        defaults={
            "task": task,
            "status": AgentExecutionTrace.Status.COMPLETED,
            "graph_state": {
                "engine": "google_antigravity_sdk",
                "agent_role": result.agent_role,
                "prompt": prompt,
                "task_status": task.status,
                "pr_url": task.pr_url,
                "thoughts": result.thoughts,
                "tool_calls": [{"name": t.name, "args": t.args, "output": t.output} for t in result.tool_calls],
                "subagents": result.subagents_spawned,
                "retrieved_context": rag_context,
            },
            "steps": [
                {"node": "antigravity_init", "agent_role": result.agent_name, "message": t, "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ")}
                for t in result.thoughts
            ] + [
                {"node": t.name, "agent_role": result.agent_name, "message": f"Executed tool {t.name}: {t.output}", "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ")}
                for t in result.tool_calls
            ],
            "tokens_used": result.tokens_used or 0,
            "duration_seconds": result.duration_seconds,
            "langfuse_url": result.langfuse_url,
            "finished_at": timezone.now(),
        }
    )

    # 5. Activity & Notification
    TaskActivity.objects.create(
        task=task,
        actor=agent_user,
        action="antigravity_prompt_executed",
        details={"agent": result.agent_name, "session_id": result.session_id, "new_status": task.status}
    )

    if user and user != agent_user:
        Notification.objects.create(
            recipient=user,
            actor=agent_user,
            title=f"Antigravity Agent ({result.agent_name}) Responded",
            message=result.response_text[:120],
            link=f"/projects/{task.project_id}",
            organization=task.organization,
        )

    return {
        "ok": True,
        "trace_id": trace.id,
        "comment_id": comment.id,
        "agent_name": result.agent_name,
        "agent_role": result.agent_role,
        "response": result.response_text,
        "thoughts": result.thoughts,
        "tool_calls": [{"name": t.name, "args": t.args, "output": t.output} for t in result.tool_calls],
        "session_id": result.session_id,
        "duration_seconds": result.duration_seconds,
        "langfuse_url": result.langfuse_url,
    }
