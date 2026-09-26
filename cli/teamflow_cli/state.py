"""State shared by the commands of one invocation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Any, Optional

import httpx
import typer

from .client import TeamflowClient
from .config import DEFAULT_URL, HostStore, normalize_url

JsonFlag = Annotated[bool, typer.Option("--json", help="Print the API response as JSON.")]


@dataclass
class AppState:
    url_override: Optional[str] = None
    store: HostStore = field(default_factory=HostStore)
    # Tests replace the network with an httpx.MockTransport.
    transport: Optional[httpx.BaseTransport] = None

    def resolve_url(self, explicit: Optional[str] = None) -> str:
        """The server to use: explicit, --url or TEAMFLOW_URL, the last login, then the local default."""
        return normalize_url(explicit or self.url_override or self.store.current_url() or DEFAULT_URL)

    def client(self, url: Optional[str] = None) -> TeamflowClient:
        return TeamflowClient(self.resolve_url(url), self.store, transport=self.transport)


def get_state(ctx: typer.Context) -> AppState:
    return ctx.ensure_object(AppState)


def compact(values: dict[str, Any]) -> dict[str, Any]:
    """Drop unset values so the API applies its own defaults."""
    return {name: value for name, value in values.items() if value is not None}
