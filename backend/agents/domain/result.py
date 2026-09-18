"""
Result Monad for Explicit, Fail-Fast Domain Error Handling.
Enforces typed error returns over unexpected runtime exceptions.
"""

from typing import TypeVar, Generic, Union, Callable, Any

T = TypeVar("T")
E = TypeVar("E")
U = TypeVar("U")


class Ok(Generic[T]):
    """Represents a successful computation containing a value."""
    __slots__ = ("_value",)

    def __init__(self, value: T):
        self._value = value

    @property
    def value(self) -> T:
        return self._value

    @property
    def is_ok(self) -> bool:
        return True

    @property
    def is_err(self) -> bool:
        return False

    def unwrap(self) -> T:
        return self._value

    def unwrap_or(self, default: T) -> T:
        return self._value

    def map(self, fn: Callable[[T], U]) -> "Ok[U]":
        return Ok(fn(self._value))

    def __repr__(self) -> str:
        return f"Ok({self._value!r})"


class Err(Generic[E]):
    """Represents a failed computation containing an error."""
    __slots__ = ("_error",)

    def __init__(self, error: E):
        self._error = error

    @property
    def error(self) -> E:
        return self._error

    @property
    def is_ok(self) -> bool:
        return False

    @property
    def is_err(self) -> bool:
        return True

    def unwrap(self) -> Any:
        raise ValueError(f"Called unwrap on Err: {self._error}")

    def unwrap_or(self, default: T) -> T:
        return default

    def map(self, fn: Callable[[Any], Any]) -> "Err[E]":
        return self

    def __repr__(self) -> str:
        return f"Err({self._error!r})"


Result = Union[Ok[T], Err[E]]
