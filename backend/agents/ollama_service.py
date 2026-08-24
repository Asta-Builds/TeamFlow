"""
Ollama Local LLM Service for TeamFlow.
Runs high-speed local inference on NVIDIA GeForce RTX 3060 via Ollama API.
"""

import os
import logging
import requests
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5-coder:7b")


def is_ollama_available() -> bool:
    """Checks if Ollama is reachable."""
    try:
        res = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2)
        return res.status_code == 200
    except Exception:
        return False


def query_ollama(
    prompt: str,
    system_prompt: str = "",
    model: Optional[str] = None,
    timeout: int = 45,
) -> Optional[str]:
    """
    Queries local Ollama instance running on NVIDIA RTX 3060.
    Returns generated response text or None if unreachable.
    """
    target_model = model or OLLAMA_MODEL
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
            f"{OLLAMA_BASE_URL}/api/generate",
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
