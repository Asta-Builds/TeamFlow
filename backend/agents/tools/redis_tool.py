import json
import os
import time
from typing import Dict, Any, Optional

try:
    import redis
    REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
except Exception:
    redis_client = None

# In-memory fallback if Redis is unreachable
_MEMORY_STORE: Dict[str, Any] = {}


def is_event_bus_available() -> bool:
    """Return whether Redis is reachable across web and worker processes."""
    try:
        return bool(redis_client and redis_client.ping())
    except Exception:
        return False


def save_short_term_memory(key: str, data: Any, ttl_seconds: int = 3600) -> bool:
    """Redis Tool: Stores agent conversation buffer and ticket working memory."""
    try:
        if redis_client:
            redis_client.setex(f"agent_mem:{key}", ttl_seconds, json.dumps(data))
            return True
    except Exception:
        pass
    _MEMORY_STORE[key] = data
    return True


def get_short_term_memory(key: str) -> Optional[Any]:
    """Redis Tool: Retrieves short-term memory buffer for an agent/ticket."""
    try:
        if redis_client:
            raw = redis_client.get(f"agent_mem:{key}")
            if raw:
                return json.loads(raw)
    except Exception:
        pass
    return _MEMORY_STORE.get(key)


def publish_agent_event(channel: str, event_data: Dict[str, Any]) -> bool:
    """Redis Tool: Publishes agent task handoff events (e.g. 'PR ready for QA')."""
    payload = {
        "timestamp": time.time(),
        "event": event_data,
    }
    try:
        if redis_client:
            redis_client.publish(f"agent_events:{channel}", json.dumps(payload))
            return True
    except Exception:
        pass
    return True
