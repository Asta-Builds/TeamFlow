"""
Factory Pattern for Dynamic Runtime LLM Provider Resolution.
Allows dynamic rule selection, clean runtime dependency resolution,
and eliminates god functions with nested if/elif ladders.
"""

from typing import List, Optional
from django.conf import settings

from .strategy import (
    LLMProviderStrategy,
    GeminiAntigravityStrategy,
    OpenAIChatStrategy,
    OllamaLocalStrategy,
    FixtureReplayStrategy,
)
from .pipeline import (
    ResilientRetryDecorator,
    ErrorSanitizationDecorator,
    FixtureRecordingDecorator,
)


class LLMProviderFactory:
    """Factory creating fully decorated, resilient LLM provider pipelines."""

    @classmethod
    def get_available_strategies(cls) -> List[LLMProviderStrategy]:
        """
        Build priority chain of available strategies:
        1. Fixture replay (if fixture dir configured)
        2. Gemini (Antigravity SDK)
        3. Ollama local GPU/CPU
        4. OpenAI (ChatOpenAI)
        """
        candidates: List[LLMProviderStrategy] = [
            FixtureReplayStrategy(),
            GeminiAntigravityStrategy(),
            OllamaLocalStrategy(),
            OpenAIChatStrategy(),
        ]

        active_chain: List[LLMProviderStrategy] = []
        for candidate in candidates:
            if candidate.is_available():
                # Compose cross-cutting decorators around the raw strategy
                decorated = FixtureRecordingDecorator(
                    ErrorSanitizationDecorator(
                        ResilientRetryDecorator(candidate, max_retries=3)
                    )
                )
                active_chain.append(decorated)

        return active_chain

    @classmethod
    def get_primary_strategy(cls) -> Optional[LLMProviderStrategy]:
        """Return the highest-priority configured strategy."""
        strategies = cls.get_available_strategies()
        return strategies[0] if strategies else None
