"""
Strategy Pattern for Language Model Providers.
Enforces Open/Closed (OCP) and Dependency Inversion (DIP).
Allows dynamic runtime switching and addition of new model providers
without modifying core agent orchestration or execution graphs.
"""

from __future__ import annotations
import asyncio
import hashlib
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional, Protocol, Tuple

from django.conf import settings
from .result import Result, Ok, Err

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LLMRequest:
    """Immutable domain request object."""
    system_prompt: str
    user_prompt: str
    timeout: int = 120
    temperature: float = 0.2
    model_override: Optional[str] = None


@dataclass
class LLMResponse:
    """Standardized response across all LLM provider strategies (LSP)."""
    text: str
    provider: str
    model: str
    duration_s: float = 0.0
    prompt_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    attempts: int = 1


@dataclass
class LLMError:
    """Standardized error across all LLM provider strategies."""
    provider: str
    message: str
    is_transient: bool = False
    status_code: int = 502


class LLMProviderStrategy(Protocol):
    """ISP-compliant protocol for language model providers."""

    @property
    def provider_name(self) -> str:
        ...

    def is_available(self) -> bool:
        """Return True if this provider is configured and reachable."""
        ...

    def execute(self, request: LLMRequest) -> Result[LLMResponse, LLMError]:
        """Execute a text generation call under the provider's API."""
        ...


class GeminiAntigravityStrategy:
    """Google Antigravity SDK (Gemini) strategy."""

    @property
    def provider_name(self) -> str:
        return "gemini"

    def is_available(self) -> bool:
        return bool(settings.GEMINI_API_KEY)

    def execute(self, request: LLMRequest) -> Result[LLMResponse, LLMError]:
        start = time.monotonic()
        model_name = request.model_override or settings.GEMINI_MODEL

        try:
            from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig, AgentBehavior

            async def _run():
                config = LocalAgentConfig(
                    api_key=settings.GEMINI_API_KEY,
                    system_instructions=request.system_prompt,
                    workspaces=[],
                    capabilities=CapabilitiesConfig(
                        enable_subagents=False,
                        agent_behavior=AgentBehavior.MINIMAL,
                        enabled_tools=[],
                    ),
                    model=model_name,
                )
                async with Agent(config) as agy_agent:
                    resp = await agy_agent.chat(request.user_prompt)
                    text = await resp.text()
                    usage = getattr(resp, "usage_metadata", None)
                    p_tok = usage.prompt_token_count if usage else None
                    o_tok = usage.candidates_token_count if usage else None
                    t_tok = usage.total_token_count if usage else None
                    return text, p_tok, o_tok, t_tok

            text, prompt_tok, out_tok, total_tok = asyncio.run(
                asyncio.wait_for(_run(), timeout=request.timeout)
            )

            return Ok(
                LLMResponse(
                    text=text,
                    provider="gemini",
                    model=model_name,
                    duration_s=time.monotonic() - start,
                    prompt_tokens=prompt_tok,
                    output_tokens=out_tok,
                    total_tokens=total_tok,
                )
            )
        except Exception as exc:
            err_msg = str(exc)
            is_transient = any(c in err_msg.lower() for c in ("429", "resource_exhausted", "503", "timeout"))
            return Err(
                LLMError(
                    provider="gemini",
                    message=f"Gemini ({model_name}) failed: {err_msg}",
                    is_transient=is_transient,
                )
            )


class OpenAIChatStrategy:
    """OpenAI / LangChain ChatOpenAI strategy."""

    @property
    def provider_name(self) -> str:
        return "openai"

    def is_available(self) -> bool:
        return bool(settings.OPENAI_API_KEY)

    def execute(self, request: LLMRequest) -> Result[LLMResponse, LLMError]:
        start = time.monotonic()
        model_name = request.model_override or settings.OPENAI_MODEL

        try:
            from langchain_openai import ChatOpenAI
            from langchain_core.messages import SystemMessage, HumanMessage

            llm = ChatOpenAI(
                model=model_name,
                temperature=request.temperature,
                openai_api_key=settings.OPENAI_API_KEY,
                timeout=request.timeout,
            )
            res = llm.invoke([
                SystemMessage(content=request.system_prompt),
                HumanMessage(content=request.user_prompt),
            ])

            return Ok(
                LLMResponse(
                    text=str(res.content),
                    provider="openai",
                    model=model_name,
                    duration_s=time.monotonic() - start,
                )
            )
        except Exception as exc:
            err_msg = str(exc)
            is_transient = any(c in err_msg.lower() for c in ("429", "rate limit", "503", "timeout"))
            return Err(
                LLMError(
                    provider="openai",
                    message=f"OpenAI ({model_name}) failed: {err_msg}",
                    is_transient=is_transient,
                )
            )


class OllamaLocalStrategy:
    """Self-hosted Ollama local GPU/CPU strategy."""

    @property
    def provider_name(self) -> str:
        return "ollama"

    def is_available(self) -> bool:
        try:
            from agents.ollama_service import is_ollama_available
            return is_ollama_available()
        except Exception:
            return False

    def execute(self, request: LLMRequest) -> Result[LLMResponse, LLMError]:
        start = time.monotonic()
        model_name = request.model_override or getattr(settings, "OLLAMA_MODEL", "ollama")

        try:
            from agents.ollama_service import query_ollama

            text = query_ollama(
                prompt=request.user_prompt,
                system_prompt=request.system_prompt,
                timeout=request.timeout,
            )
            if not text:
                return Err(LLMError(provider="ollama", message="Ollama returned an empty response."))

            return Ok(
                LLMResponse(
                    text=text,
                    provider="ollama",
                    model=model_name,
                    duration_s=time.monotonic() - start,
                )
            )
        except Exception as exc:
            return Err(
                LLMError(
                    provider="ollama",
                    message=f"Ollama ({model_name}) failed: {exc}",
                    is_transient=True,
                )
            )


class FixtureReplayStrategy:
    """Hermetic test replay strategy using SHA256 hashed fixtures."""

    @property
    def provider_name(self) -> str:
        return "fixture"

    def is_available(self) -> bool:
        return bool(getattr(settings, "LLM_FIXTURE_DIR", ""))

    def execute(self, request: LLMRequest) -> Result[LLMResponse, LLMError]:
        start = time.monotonic()
        fixture_dir = getattr(settings, "LLM_FIXTURE_DIR", "")
        digest = hashlib.sha256(f"{request.system_prompt}\n---\n{request.user_prompt}".encode("utf-8")).hexdigest()
        fixture_path = os.path.join(fixture_dir, f"{digest}.txt")

        if os.path.exists(fixture_path):
            with open(fixture_path, "r", encoding="utf-8") as fh:
                content = fh.read()
            return Ok(
                LLMResponse(
                    text=content,
                    provider="fixture",
                    model="fixture",
                    duration_s=time.monotonic() - start,
                )
            )
        return Err(
            LLMError(
                provider="fixture",
                message=f"Fixture digest {digest} not found in {fixture_dir}",
            )
        )
