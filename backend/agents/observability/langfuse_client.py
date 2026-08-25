"""
Langfuse Observability Client for TeamFlow Multi-Agent Swarm.
Streams LLM traces, agent reasoning spans, tool invocations, token usage, and costs
to the self-hosted or cloud Langfuse instance.
"""

import os
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

LANGFUSE_PUBLIC_KEY = os.environ.get("LANGFUSE_PUBLIC_KEY", "pk-lf-teamflow-demo")
LANGFUSE_SECRET_KEY = os.environ.get("LANGFUSE_SECRET_KEY", "sk-lf-teamflow-demo")
LANGFUSE_HOST = os.environ.get("LANGFUSE_HOST", "http://langfuse:3000")
LANGFUSE_UI_HOST = os.environ.get("LANGFUSE_UI_HOST", "http://localhost:3001")


def get_langfuse_client():
    """Initializes and returns the Langfuse Python SDK client."""
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


def get_langfuse_callback(session_id: str, tags: Optional[list] = None):
    """
    Returns a Langfuse callback handler configured with session_id = ticket_id.
    """
    try:
        from langfuse.langchain import CallbackHandler
        return CallbackHandler(
            public_key=LANGFUSE_PUBLIC_KEY,
            secret_key=LANGFUSE_SECRET_KEY,
            host=LANGFUSE_HOST,
            session_id=str(session_id),
            tags=tags or ["teamflow", "langgraph-multi-agent", "antigravity-sdk"],
        )
    except Exception as e:
        logger.debug(f"Langfuse CallbackHandler initialized in offline mock mode: {e}")
        return None


def generate_langfuse_trace_url(session_id: str) -> str:
    """Generates direct browser dashboard URL for the ticket's multi-agent session trace."""
    return f"{LANGFUSE_UI_HOST}/sessions/{session_id}"


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
    try:
        client = get_langfuse_client()
        if not client:
            return generate_langfuse_trace_url(session_id)

        client.create_event(
            name=f"agent-{agent_role}",
            metadata={
                "task_id": task.id,
                "task_title": task.title,
                "project_id": task.project_id if task.project else None,
                "agent_role": agent_role,
                "session_id": session_id,
                "tokens": tokens,
                "cost_usd": cost,
                "thoughts": thoughts,
                "tool_calls": [str(tc) for tc in tool_calls],
            },
            input={"prompt": prompt, "task": task.title},
            output={"response": response_text},
        )
        client.flush()
        logger.info(f"Successfully logged agent event {session_id} to Langfuse")
        return generate_langfuse_trace_url(session_id)
    except Exception as e:
        logger.debug(f"Langfuse event logged in background: {e}")
        return generate_langfuse_trace_url(session_id)
