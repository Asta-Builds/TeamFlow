import time
import logging
from typing import Dict, Any, Optional
from django.utils import timezone

from langgraph.graph import StateGraph, END

from .state import TicketState
from .nodes.tech_lead import tech_lead_node
from .nodes.backend_agent import backend_agent_node
from .nodes.frontend_agent import frontend_agent_node
from .nodes.qa_agent import qa_agent_node
from .nodes.devops_agent import devops_agent_node
from .nodes.uiux_agent import uiux_agent_node
from .nodes.seo_agent import seo_agent_node
from .observability.langfuse_client import get_langfuse_callback, generate_langfuse_trace_url
from .models import AgentExecutionTrace
from .events import emit_agent_event, ensure_task_organization

logger = logging.getLogger(__name__)


def route_from_tech_lead(state: TicketState) -> str:
    """Routing logic from Tech Lead orchestrator node."""
    assigned = state.get("assigned_agent", "backend")
    if assigned in {"backend", "frontend", "qa", "devops", "designer", "seo"}:
        return assigned
    if assigned == "done" or state.get("status") == "done":
        return END
    return "backend"


def route_from_qa(state: TicketState) -> str:
    """Conditional routing from QA node (Cycle / Decision Gate)."""
    qa_result = state.get("qa_result")
    if qa_result == "passed":
        return "devops"
    # Rejection cycle back to backend for fix
    return "backend"


def build_teamflow_agent_graph():
    """
    Compiles the LangGraph Multi-Agent StateGraph according to
    Section 7 in Multi_Agent_Architecture_LangChain.md.
    """
    workflow = StateGraph(TicketState)

    # 1. Add Specialist Agent Nodes
    workflow.add_node("tech_lead", tech_lead_node)
    workflow.add_node("backend", backend_agent_node)
    workflow.add_node("frontend", frontend_agent_node)
    workflow.add_node("qa", qa_agent_node)
    workflow.add_node("devops", devops_agent_node)
    workflow.add_node("designer", uiux_agent_node)
    workflow.add_node("seo", seo_agent_node)

    # 2. Entry Point
    workflow.set_entry_point("tech_lead")

    # 3. Edges & Conditional Routing
    workflow.add_conditional_edges(
        "tech_lead",
        route_from_tech_lead,
        {
            "backend": "backend",
            "frontend": "frontend",
            "qa": "qa",
            "devops": "devops",
            "designer": "designer",
            "seo": "seo",
            END: END,
        }
    )

    # Developers report back to Tech Lead for PR review
    workflow.add_edge("backend", "tech_lead")
    workflow.add_edge("frontend", "tech_lead")
    workflow.add_edge("designer", "frontend")
    workflow.add_edge("seo", "tech_lead")

    # QA validation / rejection cycle
    workflow.add_conditional_edges(
        "qa",
        route_from_qa,
        {
            "devops": "devops",
            "backend": "backend",
        }
    )

    # DevOps release finishes workflow
    workflow.add_edge("devops", END)

    return workflow.compile()


# Compile global app graph
agent_app = build_teamflow_agent_graph()


def execute_ticket_swarm(
    task,
    initial_assigned_agent: Optional[str] = None,
    trace: Optional[AgentExecutionTrace] = None,
) -> Dict[str, Any]:
    """
    Executes the multi-agent graph for a TeamFlow task.
    Traced to Langfuse with session_id = task.id.
    Persists AgentExecutionTrace in PostgreSQL.
    """
    task = ensure_task_organization(task)
    start_time = time.time()
    session_id = trace.session_id if trace else f"ticket-{task.id}-{int(start_time)}"
    langfuse_url = generate_langfuse_trace_url(session_id)

    if trace is None:
        trace = AgentExecutionTrace.objects.create(
            task=task,
            session_id=session_id,
            status=AgentExecutionTrace.Status.RUNNING,
            graph_state={"mode": "graph", "phase": "starting"},
            langfuse_url=langfuse_url,
        )

    emit_agent_event(
        task=task,
        trace=trace,
        session_id=session_id,
        event_type="started",
        sender_key="tech_lead",
        message="I am reviewing the ticket context and deciding which specialist should take the first work item.",
        current_work="Analyzing ticket scope and project context",
        remaining_work=["specialist work", "review", "QA decision", "release handoff"],
    )

    initial_state: TicketState = {
        "ticket_id": task.id,
        "project_id": task.project_id,
        "project_name": task.project.name if task.project else "Workspace",
        "title": task.title,
        "description": task.description or "",
        "status": "todo",
        "assigned_agent": initial_assigned_agent or "tech_lead",
        "priority": task.priority or "medium",
        "task_type": getattr(task, "task_type", "feature") or "feature",
        "pr_url": None,
        "qa_result": None,
        "qa_rejection_reason": None,
        "retrieved_context": [],
        "history": [],
        "subtasks": [],
        "code_changes": {},
        "errors": [],
        "deployment_status": None,
        "deployment_logs": None,
        "langfuse_session_id": session_id,
        "total_tokens": 0,
        "total_cost_usd": 0.0,
    }

    # Setup Langfuse tracing callback
    callbacks = []
    lf_handler = get_langfuse_callback(session_id=session_id)
    if lf_handler:
        callbacks.append(lf_handler)

    config = {
        "callbacks": callbacks,
        "metadata": {
            "langfuse_session_id": session_id,
            "ticket_id": task.id,
            "project": task.project.name if task.project else "Workspace",
        },
        "recursion_limit": 15,
    }

    try:
        final_state = agent_app.invoke(initial_state, config=config)
        duration = round(time.time() - start_time, 2)

        # Update task status and PR in database
        final_status = final_state.get("status", "done")
        task.status = final_status
        if final_state.get("pr_url"):
            task.pr_url = final_state.get("pr_url")
        task.save()

        trace.status = AgentExecutionTrace.Status.COMPLETED
        trace.graph_state = final_state
        trace.steps = final_state.get("history", [])
        trace.tokens_used = final_state.get("total_tokens", 0)
        trace.cost_usd = final_state.get("total_cost_usd", 0.0)
        trace.duration_seconds = duration
        trace.langfuse_url = langfuse_url
        trace.finished_at = timezone.now()
        trace.save(update_fields=[
            "status", "graph_state", "steps", "tokens_used", "cost_usd",
            "duration_seconds", "langfuse_url", "finished_at",
        ])
        emit_agent_event(
            task=task,
            trace=trace,
            session_id=session_id,
            event_type="completed",
            message="The orchestration run has finished. Review the recorded artifacts and validation evidence before accepting the result.",
            current_work="Run completed",
            remaining_work=[],
        )

        return {
            "ok": True,
            "trace_id": trace.id,
            "session_id": session_id,
            "status": "completed",
            "final_state": final_state,
            "duration_seconds": duration,
            "langfuse_url": langfuse_url,
        }

    except Exception as e:
        logger.error(f"Multi-agent execution error for task #{task.id}: {e}", exc_info=True)
        duration = round(time.time() - start_time, 2)
        trace.status = AgentExecutionTrace.Status.FAILED
        trace.graph_state = {"error": str(e)}
        trace.steps = [{"node": "error", "message": str(e), "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ")}]
        trace.duration_seconds = duration
        trace.langfuse_url = langfuse_url
        trace.finished_at = timezone.now()
        trace.save(update_fields=[
            "status", "graph_state", "steps", "duration_seconds",
            "langfuse_url", "finished_at",
        ])
        emit_agent_event(
            task=task,
            trace=trace,
            session_id=session_id,
            event_type="failed",
            message=f"The orchestration run stopped because: {e}",
            current_work="Run failed",
            remaining_work=["resolve the reported blocker", "retry the run"],
        )
        return {
            "ok": False,
            "trace_id": trace.id,
            "session_id": session_id,
            "status": "failed",
            "error": str(e),
            "duration_seconds": duration,
            "langfuse_url": langfuse_url,
        }
