import json
import os
import time
import logging
from typing import Dict, Any, Optional

try:
    from django.conf import settings
except ImportError:
    settings = None

logger = logging.getLogger(__name__)

def _get_redis_client():
    try:
        import redis
        url = (getattr(settings, "REDIS_URL", "") if settings else "") or os.environ.get("REDIS_URL", "")
        if not url:
            return None
        return redis.Redis.from_url(url, decode_responses=True)
    except Exception as e:
        logger.warning(f"Redis initialization failed: {e}")
        return None

redis_client = _get_redis_client()

def is_event_bus_available() -> bool:
    """Return whether Redis is reachable across web and worker processes."""
    try:
        return bool(redis_client and redis_client.ping())
    except Exception:
        return False


def save_short_term_memory(key: str, data: Any, ttl_seconds: int = 3600) -> bool:
    """Redis Tool: Stores agent conversation buffer and ticket working memory."""
    if not is_event_bus_available():
        logger.info("Redis is not configured. Memory not saved.")
        return False
    try:
        redis_client.setex(f"agent_mem:{key}", ttl_seconds, json.dumps(data))
        return True
    except Exception as e:
        logger.error(f"Redis save failed: {e}")
        return False


def get_short_term_memory(key: str) -> Optional[Any]:
    """Redis Tool: Retrieves short-term memory buffer for an agent/ticket."""
    if not is_event_bus_available():
        logger.info("Redis is not configured. Cannot retrieve memory.")
        return None
    try:
        raw = redis_client.get(f"agent_mem:{key}")
        if raw:
            return json.loads(raw)
    except Exception as e:
        logger.error(f"Redis get failed: {e}")
    return None


def publish_agent_event(channel: str, event_data: Dict[str, Any]) -> bool:
    """Redis Tool: Publishes agent task handoff events (e.g. 'PR ready for QA')."""
    if not is_event_bus_available():
        logger.info("Redis is not configured. Event not published.")
        return False
    payload = {
        "timestamp": time.time(),
        "event": event_data,
    }
    try:
        redis_client.publish(f"agent_events:{channel}", json.dumps(payload))
        return True
    except Exception as e:
        logger.error(f"Redis publish failed: {e}")
        return False

