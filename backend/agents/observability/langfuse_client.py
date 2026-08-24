import os
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

LANGFUSE_PUBLIC_KEY = os.environ.get("LANGFUSE_PUBLIC_KEY", "pk-lf-teamflow-demo")
LANGFUSE_SECRET_KEY = os.environ.get("LANGFUSE_SECRET_KEY", "sk-lf-teamflow-demo")
LANGFUSE_HOST = os.environ.get("LANGFUSE_HOST", "http://localhost:3001")


def get_langfuse_callback(session_id: str, tags: Optional[list] = None):
    """
    Returns a Langfuse callback handler configured with session_id = ticket_id.
    Captures LLM prompts, completions, tool invocations, token costs, and latencies.
    """
    try:
        from langfuse.callback import CallbackHandler
        return CallbackHandler(
            public_key=LANGFUSE_PUBLIC_KEY,
            secret_key=LANGFUSE_SECRET_KEY,
            host=LANGFUSE_HOST,
            session_id=str(session_id),
            tags=tags or ["teamflow", "langgraph-multi-agent"],
        )
    except Exception as e:
        logger.debug(f"Langfuse CallbackHandler initialized in offline mock mode: {e}")
        return None


def generate_langfuse_trace_url(session_id: str) -> str:
    """Generates direct dashboard URL for the ticket's multi-agent session trace."""
    return f"{LANGFUSE_HOST}/project/teamflow-prod/sessions/{session_id}"
