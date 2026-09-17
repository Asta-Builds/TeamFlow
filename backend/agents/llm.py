import logging
import json
import re
from typing import Optional

from django.conf import settings
import rest_framework.exceptions

logger = logging.getLogger(__name__)


class ModelUnavailable(rest_framework.exceptions.APIException):
    status_code = 503
    default_detail = "No language model is configured. Set GEMINI_API_KEY, OPENAI_API_KEY or OLLAMA_BASE_URL."
    default_code = "model_unavailable"


class ModelResponseInvalid(rest_framework.exceptions.APIException):
    status_code = 502
    default_detail = "The language model returned an unusable plan."
    default_code = "model_response_invalid"


def model_available() -> bool:
    """Returns True if any model provider is configured and available."""
    if settings.GEMINI_API_KEY or settings.OPENAI_API_KEY:
        return True
    from .ollama_service import is_ollama_available
    return is_ollama_available()


def generate_text(system_prompt: str, user_prompt: str, *, timeout: int = 120) -> Optional[str]:
    """
    Attempts to generate text using configured model providers in order:
    Gemini -> Ollama -> OpenAI.
    Returns the generated text or None if all fail or none are configured.
    """
    # 1. Antigravity SDK (Gemini)
    if settings.GEMINI_API_KEY:
        try:
            import asyncio
            from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig

            async def _run_agy():
                config = LocalAgentConfig(
                    api_key=settings.GEMINI_API_KEY,
                    system_instructions=system_prompt,
                    capabilities=CapabilitiesConfig(),
                    model=settings.GEMINI_MODEL,
                )
                async with Agent(config) as agy_agent:
                    resp = await agy_agent.chat(user_prompt)
                    tokens = []
                    async for token in resp:
                        tokens.append(token)
                    return "".join(tokens)

            return asyncio.run(_run_agy())
        except Exception as agy_err:
            logger.info(f"Antigravity SDK decomposition bypassed: {agy_err}")

    # 2. Local Ollama GPU
    try:
        from .ollama_service import query_ollama, is_ollama_available
        if is_ollama_available():
            ollama_out = query_ollama(prompt=user_prompt, system_prompt=system_prompt, timeout=timeout)
            if ollama_out:
                return ollama_out
    except Exception as e:
        logger.debug(f"Ollama decomposition bypassed: {e}")

    # 3. OpenAI ChatOpenAI
    if settings.OPENAI_API_KEY:
        try:
            from langchain_openai import ChatOpenAI
            from langchain_core.messages import SystemMessage, HumanMessage

            llm = ChatOpenAI(model=settings.OPENAI_MODEL, temperature=0.2, openai_api_key=settings.OPENAI_API_KEY)
            res = llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)])
            return res.content
        except Exception as e:
            logger.warning(f"OpenAI decomposition call failed: {e}")

    return None


def require_text(system_prompt: str, user_prompt: str, *, timeout: int = 120) -> str:
    """
    Calls generate_text and raises ModelUnavailable if it returns None.
    """
    result = generate_text(system_prompt, user_prompt, timeout=timeout)
    if result is None:
        raise ModelUnavailable()
    return result
