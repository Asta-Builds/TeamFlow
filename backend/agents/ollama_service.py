"""
Ollama Local LLM Service for TeamFlow.
Runs high-speed local inference via Ollama API.
"""

import logging
import requests
from typing import Optional
from django.conf import settings

logger = logging.getLogger(__name__)


def is_ollama_available() -> bool:
    """Checks if Ollama is reachable."""
    if not settings.OLLAMA_BASE_URL:
        return False
    try:
        res = requests.get(f"{settings.OLLAMA_BASE_URL}/api/tags", timeout=2)
        return res.status_code == 200
    except Exception:
        return False


def query_ollama(
    prompt: str,
    system_prompt: str = "",
    model: Optional[str] = None,
    timeout: int = 120,
) -> Optional[str]:
    """
    Queries local Ollama instance.
    Returns generated response text or None if unreachable.
    """
    if not settings.OLLAMA_BASE_URL:
        return None
    target_model = model or settings.OLLAMA_MODEL
    try:
        payload = {
            "model": target_model,
            "prompt": prompt,
            "system": system_prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
                "num_predict": 1024,
            }
        }
        res = requests.post(
            f"{settings.OLLAMA_BASE_URL}/api/generate",
            json=payload,
            timeout=timeout
        )
        if res.status_code == 200:
            data = res.json()
            return data.get("response", "").strip()
        else:
            logger.warning(f"Ollama returned HTTP {res.status_code}: {res.text}")
            return None
    except Exception as e:
        logger.debug(f"Ollama query failed ({e}). Falling back to Antigravity SDK engine.")
        return None
