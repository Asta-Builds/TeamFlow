import logging
import time
import asyncio
import hashlib
import os
import random
import re
from typing import Optional
from dataclasses import dataclass

from django.conf import settings
import rest_framework.exceptions

logger = logging.getLogger(__name__)


class ModelUnavailable(rest_framework.exceptions.APIException):
    status_code = 503
    default_detail = "No language model is configured. Set GEMINI_API_KEY, OPENAI_API_KEY or OLLAMA_BASE_URL."
    default_code = "model_unavailable"


class ModelCallFailed(rest_framework.exceptions.APIException):
    status_code = 502
    default_detail = "The language model provider could not be reached."
    default_code = "model_call_failed"


class ModelResponseInvalid(rest_framework.exceptions.APIException):
    status_code = 502
    default_detail = "The language model returned an unusable plan."
    default_code = "model_response_invalid"


@dataclass
class LLMResult:
    text: Optional[str] = None
    provider: Optional[str] = None      # "gemini" | "ollama" | "openai" | "fixture"
    model: Optional[str] = None
    duration_s: float = 0.0
    attempts: int = 0
    error: Optional[str] = None         # last provider error, already sanitised
    prompt_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None

    @property
    def ok(self) -> bool:
        return bool(self.text and self.text.strip())


def model_available() -> bool:
    """Returns True if any model provider is configured and available."""
    if settings.GEMINI_API_KEY or settings.OPENAI_API_KEY or getattr(settings, 'LLM_FIXTURE_DIR', ''):
        return True
    from .ollama_service import is_ollama_available
    return is_ollama_available()


def _sanitize_error(error_msg: str) -> str:
    if settings.GEMINI_API_KEY:
        error_msg = error_msg.replace(settings.GEMINI_API_KEY, "***")
    if settings.OPENAI_API_KEY:
        error_msg = error_msg.replace(settings.OPENAI_API_KEY, "***")
    return error_msg


def _is_transient_error(error_str: str, exception_type: type) -> bool:
    if issubclass(exception_type, TimeoutError) or issubclass(exception_type, asyncio.TimeoutError):
        return True
    if exception_type.__name__ in ("TimeoutError", "Timeout"):
        return True
        
    err_lower = error_str.lower()
    
    if any(name in err_lower for name in ("resource_exhausted", "unavailable", "deadline_exceeded", "internal", "aborted")):
        return True
        
    if "timeout" in err_lower:
        return True
        
    if re.search(r'\b(429|500|502|503|504)\b', err_lower):
        return True
        
    return False

def generate_text_detailed(system_prompt: str, user_prompt: str, *, timeout: int = 120) -> LLMResult:
    start_time = time.monotonic()
    
    # 0. Fixture replay
    if getattr(settings, 'LLM_FIXTURE_DIR', ''):
        os.makedirs(settings.LLM_FIXTURE_DIR, exist_ok=True)
        digest = hashlib.sha256(f"{system_prompt}\n---\n{user_prompt}".encode('utf-8')).hexdigest()
        fixture_path = os.path.join(settings.LLM_FIXTURE_DIR, f"{digest}.txt")
        if os.path.exists(fixture_path):
            with open(fixture_path, "r", encoding="utf-8") as f:
                content = f.read()
            return LLMResult(
                text=content,
                provider="fixture",
                model="fixture",
                duration_s=time.monotonic() - start_time,
                attempts=1
            )
        else:
            return LLMResult(
                error=f"Fixture digest {digest} not found in {settings.LLM_FIXTURE_DIR}",
                duration_s=time.monotonic() - start_time,
                attempts=1
            )

    def save_record(text: str):
        if getattr(settings, 'LLM_RECORD_DIR', ''):
            os.makedirs(settings.LLM_RECORD_DIR, exist_ok=True)
            digest = hashlib.sha256(f"{system_prompt}\n---\n{user_prompt}".encode('utf-8')).hexdigest()
            record_path = os.path.join(settings.LLM_RECORD_DIR, f"{digest}.txt")
            with open(record_path, "w", encoding="utf-8") as f:
                f.write(text)

    last_error_result = None
    total_attempts = 0

    # 1. Antigravity SDK (Gemini)
    if settings.GEMINI_API_KEY:
        try:
            from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig, AgentBehavior
            
            async def _run_agy():
                # Text generation only; never give the model tools or a workspace
                config = LocalAgentConfig(
                    api_key=settings.GEMINI_API_KEY,
                    system_instructions=system_prompt,
                    workspaces=[],
                    capabilities=CapabilitiesConfig(
                        enable_subagents=False,
                        agent_behavior=AgentBehavior.MINIMAL,
                        enabled_tools=[],
                    ),
                    model=settings.GEMINI_MODEL,
                )
                async with Agent(config) as agy_agent:
                    resp = await agy_agent.chat(user_prompt)
                    text = await resp.text()
                    usage = getattr(resp, 'usage_metadata', None)
                    prompt_tokens = usage.prompt_token_count if usage else None
                    output_tokens = usage.candidates_token_count if usage else None
                    total_tokens = usage.total_token_count if usage else None
                    return text, prompt_tokens, output_tokens, total_tokens
            
            attempts = 0
            while attempts < 3:
                attempts += 1
                total_attempts += 1
                try:
                    text, prompt_tokens, output_tokens, total_tokens = asyncio.run(
                        asyncio.wait_for(_run_agy(), timeout=timeout)
                    )
                    save_record(text)
                    return LLMResult(
                        text=text, provider="gemini", model=settings.GEMINI_MODEL,
                        duration_s=time.monotonic() - start_time, attempts=total_attempts,
                        prompt_tokens=prompt_tokens, output_tokens=output_tokens, total_tokens=total_tokens
                    )
                except Exception as agy_err:
                    err_str = _sanitize_error(str(agy_err))
                    if attempts < 3 and _is_transient_error(err_str, type(agy_err)):
                        backoff = 0.5 * (2 ** (attempts - 1)) + random.uniform(0, 0.3)
                        elapsed = time.monotonic() - start_time
                        if elapsed + backoff < timeout:
                            time.sleep(backoff)
                            continue
                    logger.warning(f"Gemini ({settings.GEMINI_MODEL}) failed: {err_str}", exc_info=True)
                    last_error_result = LLMResult(
                        error=f"Gemini ({settings.GEMINI_MODEL}) failed: {err_str}", provider="gemini", model=settings.GEMINI_MODEL,
                        duration_s=time.monotonic() - start_time, attempts=total_attempts
                    )
                    break
        except Exception as e:
            total_attempts += 1
            err_str = _sanitize_error(str(e))
            logger.warning(f"Antigravity SDK import or configuration failed: {e}", exc_info=True)
            last_error_result = LLMResult(
                error=f"Antigravity SDK import or configuration failed: {err_str}", provider="gemini", model=settings.GEMINI_MODEL,
                duration_s=time.monotonic() - start_time, attempts=total_attempts
            )

    # 2. Local Ollama GPU
    try:
        from .ollama_service import query_ollama, is_ollama_available
        if is_ollama_available():
            attempts = 0
            while attempts < 3:
                attempts += 1
                total_attempts += 1
                try:
                    ollama_out = query_ollama(prompt=user_prompt, system_prompt=system_prompt, timeout=timeout)
                    if ollama_out:
                        save_record(ollama_out)
                        return LLMResult(
                            text=ollama_out, provider="ollama", model=getattr(settings, "OLLAMA_MODEL", "ollama"),
                            duration_s=time.monotonic() - start_time, attempts=total_attempts
                        )
                    break
                except Exception as e:
                    err_str = _sanitize_error(str(e))
                    if attempts < 3 and _is_transient_error(err_str, type(e)):
                        backoff = 0.5 * (2 ** (attempts - 1)) + random.uniform(0, 0.3)
                        elapsed = time.monotonic() - start_time
                        if elapsed + backoff < timeout:
                            time.sleep(backoff)
                            continue
                    logger.warning(f"Ollama ({getattr(settings, 'OLLAMA_MODEL', 'ollama')}) failed: {err_str}", exc_info=True)
                    last_error_result = LLMResult(
                        error=f"Ollama ({getattr(settings, 'OLLAMA_MODEL', 'ollama')}) failed: {err_str}", provider="ollama", model=getattr(settings, 'OLLAMA_MODEL', 'ollama'),
                        duration_s=time.monotonic() - start_time, attempts=total_attempts
                    )
                    break
    except Exception as e:
        logger.debug(f"Ollama decomposition bypassed: {e}")

    # 3. OpenAI ChatOpenAI
    if settings.OPENAI_API_KEY:
        try:
            from langchain_openai import ChatOpenAI
            from langchain_core.messages import SystemMessage, HumanMessage

            attempts = 0
            while attempts < 3:
                attempts += 1
                total_attempts += 1
                try:
                    llm = ChatOpenAI(model=settings.OPENAI_MODEL, temperature=0.2, openai_api_key=settings.OPENAI_API_KEY, timeout=timeout)
                    res = llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)])
                    save_record(res.content)
                    return LLMResult(
                        text=res.content, provider="openai", model=settings.OPENAI_MODEL,
                        duration_s=time.monotonic() - start_time, attempts=total_attempts
                    )
                except Exception as e:
                    err_str = _sanitize_error(str(e))
                    if attempts < 3 and _is_transient_error(err_str, type(e)):
                        backoff = 0.5 * (2 ** (attempts - 1)) + random.uniform(0, 0.3)
                        elapsed = time.monotonic() - start_time
                        if elapsed + backoff < timeout:
                            time.sleep(backoff)
                            continue
                    logger.warning(f"OpenAI ({settings.OPENAI_MODEL}) failed: {err_str}", exc_info=True)
                    last_error_result = LLMResult(
                        error=f"OpenAI ({settings.OPENAI_MODEL}) failed: {err_str}", provider="openai", model=settings.OPENAI_MODEL,
                        duration_s=time.monotonic() - start_time, attempts=total_attempts
                    )
                    break
        except Exception as e:
            logger.warning(f"OpenAI decomposition call failed: {e}")

    if last_error_result:
        return last_error_result
        
    return LLMResult(
        error="No model provider configured or available.",
        duration_s=time.monotonic() - start_time, attempts=0
    )


def generate_text(system_prompt: str, user_prompt: str, *, timeout: int = 120) -> Optional[str]:
    """
    Attempts to generate text using configured model providers in order:
    Gemini -> Ollama -> OpenAI.
    Returns the generated text or None if all fail or none are configured.
    """
    return generate_text_detailed(system_prompt, user_prompt, timeout=timeout).text


def require_text(system_prompt: str, user_prompt: str, *, timeout: int = 120) -> str:
    """
    Calls generate_text_detailed and raises ModelUnavailable if it returns None without attempts.
    """
    result = generate_text_detailed(system_prompt, user_prompt, timeout=timeout)
    if result.ok:
        return result.text
        
    if result.attempts == 0:
        raise ModelUnavailable()
        
    raise ModelCallFailed(result.error)
