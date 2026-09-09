"""
Langfuse Observability Client for TeamFlow Multi-Agent Swarm.
Streams LLM traces, agent reasoning spans, tool invocations, token usage, and costs
to the self-hosted or cloud Langfuse instance.
"""

import os
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

LANGFUSE_PUBLIC_KEY = os.environ.get("LANGFUSE_PUBLIC_KEY") or "pk-lf-fc9b9462-567c-4e92-8082-773b759e8a17"
LANGFUSE_SECRET_KEY = os.environ.get("LANGFUSE_SECRET_KEY") or "sk-lf-dc01ab22-3da6-4af4-80b2-e1acf712d048"
LANGFUSE_HOST = os.environ.get("LANGFUSE_HOST") or "http://langfuse:3000"
LANGFUSE_UI_HOST = (os.environ.get("LANGFUSE_UI_HOST") or "http://localhost:3001").rstrip("/")
LANGFUSE_PROJECT_ID = os.environ.get("LANGFUSE_PROJECT_ID") or "cmtuisfno0006oihvk2oqcrrv"


def _is_configured() -> bool:
    return bool(LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY and LANGFUSE_HOST)


def get_langfuse_client():
    """Initializes and returns the Langfuse Python SDK client."""
    if not _is_configured():
        logger.debug("Langfuse is disabled because its connection settings are not configured.")
        return None
    try:
        from langfuse import Langfuse
        return Langfuse(
            public_key=LANGFUSE_PUBLIC_KEY,
            secret_key=LANGFUSE_SECRET_KEY,
            host=LANGFUSE_HOST,
        )
    except Exception as e:
        logger.warning(f"Could not initialize Langfuse client: {e}")
        return None


def _ensure_langchain_compat_shim():
    """Provides compatibility between langchain_core 0.3+ and langfuse 2.x callback handler."""
    import sys
    try:
        import langchain.callbacks.base  # noqa: F401
    except (ImportError, ModuleNotFoundError):
        import langchain_core.callbacks as lcc
        import langchain_core.agents as lca
        import langchain_core.documents as lcd

        class ShimModule:
            pass

        cb_mod = ShimModule()
        cb_mod.base = lcc
        cb_mod.BaseCallbackHandler = lcc.BaseCallbackHandler
        sys.modules.setdefault("langchain.callbacks", cb_mod)
        sys.modules.setdefault("langchain.callbacks.base", lcc)

        schema_mod = ShimModule()
        schema_agent = ShimModule()
        schema_agent.AgentAction = lca.AgentAction
        schema_agent.AgentFinish = lca.AgentFinish
        sys.modules.setdefault("langchain.schema", schema_mod)
        sys.modules.setdefault("langchain.schema.agent", schema_agent)
        schema_doc = ShimModule()
        schema_doc.Document = lcd.Document
        sys.modules.setdefault("langchain.schema.document", schema_doc)


def get_langfuse_callback(session_id: str, tags: Optional[list] = None):
    """
    Returns a Langfuse callback handler configured with session_id = ticket_id.
    """
    if not _is_configured():
        return None
    try:
        _ensure_langchain_compat_shim()
        from langfuse.callback import CallbackHandler
        return CallbackHandler(
            public_key=LANGFUSE_PUBLIC_KEY,
            secret_key=LANGFUSE_SECRET_KEY,
            host=LANGFUSE_HOST,
            session_id=str(session_id),
            tags=tags or ["teamflow", "langgraph-multi-agent", "antigravity-sdk"],
        )
    except Exception as e:
        logger.warning(f"Could not initialize Langfuse CallbackHandler: {e}")
        return None


def generate_langfuse_trace_url(session_id: str) -> str:
    """Generates direct browser dashboard URL for the ticket's multi-agent session trace."""
    ui_host = LANGFUSE_UI_HOST or "http://localhost:3001"
    project_id = LANGFUSE_PROJECT_ID or "cmtuisfno0006oihvk2oqcrrv"
    return f"{ui_host}/project/{project_id}/sessions/{session_id}"


def log_agent_execution_to_langfuse(
    task,
    agent_role: str,
    prompt: str,
    response_text: str,
    thoughts: List[str],
    tool_calls: List[Any],
    tokens: int,
    cost: float,
    session_id: Optional[str] = None,
) -> Optional[str]:
    """
    Actively pushes an agent execution trace, reasoning thoughts, and tool call spans
    to Langfuse, ensuring real-time visibility in the Langfuse dashboard.
    """
    session_id = session_id or f"ticket-{task.id}"
    trace_url = generate_langfuse_trace_url(session_id)
    try:
        client = get_langfuse_client()
        if not client:
            return trace_url

        metadata = {
            "task_id": task.id,
            "task_title": task.title,
            "project_id": task.project_id if getattr(task, "project", None) else None,
            "agent_role": agent_role,
            "session_id": session_id,
            "tokens": tokens,
            "cost_usd": cost,
        }

        trace_kwargs = {
            "name": f"agent-{agent_role}",
            "session_id": session_id,
            "tags": [agent_role, "antigravity-sdk", "orchestration"],
            "metadata": metadata,
            "input": {"prompt": prompt, "task": task.title},
            "output": {"response": response_text},
        }
        user_id = getattr(getattr(task, "assignee", None), "email", "")
        if user_id:
            trace_kwargs["user_id"] = user_id
        trace = client.trace(
            **trace_kwargs,
        )

        trace.generation(
            name=f"{agent_role}-execution",
            input={"prompt": prompt},
            output={"response": response_text, "thoughts": thoughts},
            metadata={
                "tool_calls": [str(tc) for tc in tool_calls],
                "thoughts": thoughts,
                "cost_usd": cost,
            },
            usage={"total": tokens},
        )

        client.flush()
        logger.info(f"Successfully logged agent trace {session_id} to Langfuse")
        return trace_url
    except Exception as e:
        logger.warning(f"Langfuse trace logging exception: {e}")
        return trace_url
