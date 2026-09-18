"""
Decorator & Pipeline Pattern for LLM Provider Strategies.
Encapsulates cross-cutting concerns (Resilience/Retries, Error Sanitization,
Telemetry, and Recording) without polluting concrete provider strategies.
"""

import hashlib
import logging
import os
import random
import time
from typing import List

from django.conf import settings
from .result import Result, Ok, Err
from .strategy import LLMProviderStrategy, LLMRequest, LLMResponse, LLMError

logger = logging.getLogger(__name__)


class ResilientRetryDecorator:
    """Decorator adding jittered exponential backoff retries for transient errors."""

    def __init__(self, inner: LLMProviderStrategy, max_retries: int = 3):
        self.inner = inner
        self.max_retries = max_retries

    @property
    def provider_name(self) -> str:
        return self.inner.provider_name

    def is_available(self) -> bool:
        return self.inner.is_available()

    def execute(self, request: LLMRequest) -> Result[LLMResponse, LLMError]:
        start = time.monotonic()
        attempts = 0
        last_error = None

        while attempts < self.max_retries:
            attempts += 1
            res = self.inner.execute(request)
            if res.is_ok:
                resp = res.unwrap()
                resp.attempts = attempts
                return Ok(resp)

            err = res.error
            last_error = err
            if not err.is_transient:
                break

            if attempts < self.max_retries:
                backoff = 0.5 * (2 ** (attempts - 1)) + random.uniform(0, 0.3)
                if time.monotonic() - start + backoff < request.timeout:
                    time.sleep(backoff)

        return Err(last_error or LLMError(provider=self.provider_name, message="Unknown execution failure."))


class ErrorSanitizationDecorator:
    """Decorator masking secrets and API keys from error outputs."""

    def __init__(self, inner: LLMProviderStrategy):
        self.inner = inner

    @property
    def provider_name(self) -> str:
        return self.inner.provider_name

    def is_available(self) -> bool:
        return self.inner.is_available()

    def execute(self, request: LLMRequest) -> Result[LLMResponse, LLMError]:
        res = self.inner.execute(request)
        if res.is_err:
            err = res.error
            sanitized_msg = err.message
            for key in (getattr(settings, "GEMINI_API_KEY", ""), getattr(settings, "OPENAI_API_KEY", "")):
                if key:
                    sanitized_msg = sanitized_msg.replace(key, "***")
            err.message = sanitized_msg
        return res


class FixtureRecordingDecorator:
    """Decorator recording successful outputs to LLM_RECORD_DIR for fixture capture."""

    def __init__(self, inner: LLMProviderStrategy):
        self.inner = inner

    @property
    def provider_name(self) -> str:
        return self.inner.provider_name

    def is_available(self) -> bool:
        return self.inner.is_available()

    def execute(self, request: LLMRequest) -> Result[LLMResponse, LLMError]:
        res = self.inner.execute(request)
        if res.is_ok and getattr(settings, "LLM_RECORD_DIR", ""):
            text = res.unwrap().text
            os.makedirs(settings.LLM_RECORD_DIR, exist_ok=True)
            digest = hashlib.sha256(f"{request.system_prompt}\n---\n{request.user_prompt}".encode("utf-8")).hexdigest()
            record_path = os.path.join(settings.LLM_RECORD_DIR, f"{digest}.txt")
            try:
                with open(record_path, "w", encoding="utf-8") as fh:
                    fh.write(text)
            except Exception as exc:
                logger.warning(f"Could not record LLM fixture: {exc}")
        return res
