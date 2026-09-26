"""The next command to suggest, written the way the user would type it."""

from __future__ import annotations

import contextlib
from typing import Iterator

_slash = False


@contextlib.contextmanager
def slash_hints() -> Iterator[None]:
    """Inside the interactive shell, suggest /commands instead of `teamflow ...` commands."""
    global _slash
    previous, _slash = _slash, True
    try:
        yield
    finally:
        _slash = previous


def suggest(cli: str, slash: str) -> str:
    return slash if _slash else f"teamflow {cli}"
