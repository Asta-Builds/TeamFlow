"""Terminal rendering: tables, detail views, and the live agent event lines."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Iterable, Optional

import typer
from rich import box
from rich.console import Console
from rich.table import Table
from rich.text import Text

from .events import Event, approval_request
from .hints import suggest

# Everything printed comes from the API, so Rich must not read it as markup or emoji codes.
console = Console(highlight=False, markup=False, emoji=False)
error_console = Console(stderr=True, highlight=False, markup=False, emoji=False)

STATUS_STYLES = {
    # Tickets
    "todo": "dim",
    "in_progress": "blue",
    "in_review": "magenta",
    "qa": "yellow",
    "done": "green",
    # Projects
    "active": "green",
    "on_hold": "yellow",
    "archived": "dim",
    # Agent runs
    "running": "blue",
    "awaiting_approval": "yellow",
    "completed": "green",
    "failed": "red",
    # Release approvals
    "pending": "yellow",
    "approved": "blue",
    "executed": "green",
    "rejected": "red",
    "superseded": "dim",
    # Deployments
    "queued": "dim",
    "success": "green",
    "rolled_back": "magenta",
    "cancelled": "dim",
}
PRIORITY_STYLES = {"urgent": "bold red", "high": "red", "medium": "yellow", "low": "dim"}
EVENT_STYLES = {
    "queued": "dim",
    "started": "cyan",
    "thought": "dim",
    "tool_call": "magenta",
    "progress": "blue",
    "handoff": "cyan",
    "blocked": "yellow",
    "completed": "green",
    "failed": "red",
}


def say(message: str, style: str = "") -> None:
    """Print one message line as-is.

    Text from the API must not be read as Rich markup. Soft wrapping leaves line
    breaks to the terminal, so piped output keeps one message per line.
    """
    console.print(Text(message, style=style), soft_wrap=True)


def print_json(data: Any) -> None:
    typer.echo(json.dumps(data, indent=2))


def as_list(data: Any) -> list[dict[str, Any]]:
    """A list response, whether bare or wrapped in a paginated `results` object."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("results"), list):
        return data["results"]
    return []


def label(value: Optional[str]) -> str:
    return (value or "-").replace("_", " ")


def status(value: Optional[str]) -> Text:
    return Text(label(value), style=STATUS_STYLES.get(value or "", ""))


def priority(value: Optional[str]) -> Text:
    return Text(label(value), style=PRIORITY_STYLES.get(value or "", ""))


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone()
    except ValueError:
        return None


def timestamp(value: Optional[str]) -> str:
    parsed = _parse_time(value)
    return parsed.strftime("%Y-%m-%d %H:%M") if parsed else "-"


def clock_time(value: Optional[str]) -> str:
    parsed = _parse_time(value)
    return parsed.strftime("%H:%M:%S") if parsed else "--:--:--"


def person(detail: Optional[dict[str, Any]], fallback: str = "-") -> str:
    if not detail:
        return fallback
    return detail.get("name") or detail.get("email") or fallback


def short_sha(sha: Optional[str]) -> str:
    return sha[:7] if sha else "-"


def duration(seconds: Optional[float]) -> str:
    if not seconds:
        return "-"
    minutes, secs = divmod(round(seconds), 60)
    return f"{minutes}m {secs:02d}s" if minutes else f"{secs}s"


def table(*columns: str) -> Table:
    grid = Table(box=box.SIMPLE_HEAD, show_edge=False, pad_edge=False, header_style="bold")
    for column in columns:
        grid.add_column(column)
    return grid


def details(rows: Iterable[tuple[str, Any]]) -> Table:
    """Label/value rows, skipping empty values."""
    grid = Table.grid(padding=(0, 2))
    grid.add_column(style="bold", no_wrap=True)
    grid.add_column(overflow="fold")
    for name, value in rows:
        if value not in (None, "", []):
            grid.add_row(name, value if isinstance(value, Text) else str(value))
    return grid


class EventPrinter:
    """Prints agent events one per line, like the web app's live stream."""

    def __init__(self, target: Optional[Console] = None):
        self.console = target or console
        self.names: dict[str, str] = {}  # Agent key -> display name, learned from events.

    def learn(self, event: Event) -> None:
        """Remember the sender's name so later handoffs to that agent can show it."""
        if event.get("sender_key") and event.get("sender_name"):
            self.names[event["sender_key"]] = event["sender_name"]

    def __call__(self, event: Event) -> None:
        self.learn(event)
        sender_key = event.get("sender_key") or ""
        kind = event.get("event_type") or ""
        style = EVENT_STYLES.get(kind, "")

        line = Text()
        line.append(f"[{clock_time(event.get('created_at'))}] ", style="dim")
        line.append(self.names.get(sender_key) or sender_key or "TeamFlow", style=f"bold {style}".strip())
        recipient = event.get("recipient_key") or ""
        if recipient and recipient != "system":
            line.append(" -> ")
            line.append(self.names.get(recipient, recipient), style="bold")
        line.append(": ")
        if kind in ("blocked", "failed"):
            line.append(f"{kind}: ", style=style)
        message = (event.get("message") or event.get("current_work") or label(kind)).strip()
        line.append(message, style="dim" if kind == "thought" else "")
        self.console.print(line, soft_wrap=True)

        approval_id = approval_request(event)
        if approval_id is not None:
            approve = suggest(f"approvals approve {approval_id}", f"/approve {approval_id}")
            reject = suggest(f"approvals reject {approval_id} --reason ...", f"/reject {approval_id} <reason>")
            self.console.print(
                Text(f"  Approve with: {approve}  (or reject: {reject})", style="yellow"),
                soft_wrap=True,
            )

    def retrying(self, delay: float, error: Exception) -> None:
        reason = str(error) or type(error).__name__
        self.console.print(
            Text(f"  Event stream interrupted ({reason}); reconnecting in {delay:.0f}s", style="dim"),
            soft_wrap=True,
        )
