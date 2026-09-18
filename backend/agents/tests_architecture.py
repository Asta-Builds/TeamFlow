"""
Architecture & SOLID Compliance Tests for Agent Domain & LLM Strategy Engine.
Validates:
1. Result Monad (Ok / Err typing).
2. Strategy Pattern & Factory Resolution.
3. Composable Pipeline Decorators (Retry, Secret Sanitization).
"""

from unittest.mock import Mock, patch
from django.test import SimpleTestCase
from agents.domain.result import Ok, Err
from agents.domain.strategy import (
    LLMRequest,
    LLMResponse,
    LLMError,
    LLMProviderStrategy,
)
from agents.domain.pipeline import (
    ResilientRetryDecorator,
    ErrorSanitizationDecorator,
    FixtureRecordingDecorator,
)
from agents.domain.factory import LLMProviderFactory


class ResultMonadTests(SimpleTestCase):
    """Test the typed Result Monad for domain error handling."""

    def test_ok_behavior(self):
        res = Ok(42)
        self.assertTrue(res.is_ok)
        self.assertFalse(res.is_err)
        self.assertEqual(res.unwrap(), 42)
        self.assertEqual(res.unwrap_or(0), 42)
        self.assertEqual(res.map(lambda x: x * 2).unwrap(), 84)

    def test_err_behavior(self):
        err = Err("database_timeout")
        self.assertFalse(err.is_ok)
        self.assertTrue(err.is_err)
        self.assertEqual(err.error, "database_timeout")
        self.assertEqual(err.unwrap_or(100), 100)
        self.assertTrue(err.map(lambda x: x * 2).is_err)
        with self.assertRaises(ValueError):
            err.unwrap()


class MockStrategy:
    """Mock strategy implementing LLMProviderStrategy protocol."""
    def __init__(self, provider_name: str = "mock"):
        self._provider = provider_name
        self.calls = 0

    @property
    def provider_name(self) -> str:
        return self._provider

    def is_available(self) -> bool:
        return True

    def execute(self, request: LLMRequest):
        self.calls += 1
        return Ok(LLMResponse(text="Success", provider=self.provider_name, model="mock-v1"))


class LLMPipelineDecoratorTests(SimpleTestCase):
    """Test composable pipeline decorators."""

    def test_error_sanitization_masks_api_keys(self):
        """ErrorSanitizationDecorator strips sensitive API credentials from error messages."""
        failing_mock = Mock()
        failing_mock.provider_name = "gemini"
        failing_mock.is_available.return_value = True
        failing_mock.execute.return_value = Err(
            LLMError(
                provider="gemini",
                message="Failed connecting with key AIzaSyFakeSecretKey123456",
            )
        )

        with patch("django.conf.settings.GEMINI_API_KEY", "AIzaSyFakeSecretKey123456"):
            sanitizer = ErrorSanitizationDecorator(failing_mock)
            result = sanitizer.execute(LLMRequest(system_prompt="sys", user_prompt="user"))
            self.assertTrue(result.is_err)
            self.assertNotIn("AIzaSyFakeSecretKey123456", result.error.message)
            self.assertIn("***", result.error.message)

    def test_resilient_retry_decorator_retries_transient_errors(self):
        """ResilientRetryDecorator retries transient errors up to max_retries."""
        mock_strategy = Mock()
        mock_strategy.provider_name = "test"
        mock_strategy.is_available.return_value = True

        # First call fails with transient error, second call succeeds
        mock_strategy.execute.side_effect = [
            Err(LLMError(provider="test", message="429 Rate Limit", is_transient=True)),
            Ok(LLMResponse(text="Recovered", provider="test", model="test-model")),
        ]

        with patch("time.sleep"):  # Avoid test delays
            resilient = ResilientRetryDecorator(mock_strategy, max_retries=3)
            result = resilient.execute(LLMRequest(system_prompt="sys", user_prompt="user"))
            self.assertTrue(result.is_ok)
            self.assertEqual(result.unwrap().text, "Recovered")
            self.assertEqual(result.unwrap().attempts, 2)

    def test_resilient_retry_decorator_aborts_on_non_transient_errors(self):
        """ResilientRetryDecorator does not retry non-transient fatal errors (e.g. invalid auth)."""
        mock_strategy = Mock()
        mock_strategy.provider_name = "test"
        mock_strategy.is_available.return_value = True
        mock_strategy.execute.return_value = Err(
            LLMError(provider="test", message="401 Invalid Auth", is_transient=False)
        )

        resilient = ResilientRetryDecorator(mock_strategy, max_retries=3)
        result = resilient.execute(LLMRequest(system_prompt="sys", user_prompt="user"))
        self.assertTrue(result.is_err)
        # Should only have been called once
        self.assertEqual(mock_strategy.execute.call_count, 1)


class LLMFactoryTests(SimpleTestCase):
    """Test Factory Pattern dynamic resolution."""

    def test_factory_returns_decorated_pipeline(self):
        """Factory returns decorated strategies adhering to the protocol contract."""
        with patch("django.conf.settings.GEMINI_API_KEY", "test-key"):
            strategies = LLMProviderFactory.get_available_strategies()
            self.assertGreater(len(strategies), 0)
            # The returned strategy implements the LLMProviderStrategy protocol
            primary = strategies[0]
            self.assertTrue(hasattr(primary, "execute"))
            self.assertTrue(hasattr(primary, "provider_name"))
