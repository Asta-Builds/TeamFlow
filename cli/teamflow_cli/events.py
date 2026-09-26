"""Agent events: the SSE stream, a resumable feed, and watching one run to its end."""

from __future__ import annotations

import contextlib
import json
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Iterator, Optional

import httpx

from .client import TeamflowClient
from .errors import ApiError, CliError, ConnectionFailedError

PAGE_SIZE = 200  # The largest page /agents/events returns.
RECONNECT_DELAY = 0.5
MAX_BACKOFF = 10.0

Event = dict[str, Any]
RetryCallback = Callable[[float, Exception], None]

_LINE_BREAK = re.compile(r"\r\n|\r|\n")


def sse_lines(chunks: Iterable[str]) -> Iterator[str]:
    """Split a text stream into lines at CR, LF or CRLF only, as the SSE format defines them.

    str.splitlines() also breaks at characters such as U+2028, which JSON.stringify
    leaves unescaped in agent messages and which would cut an event in two.
    """
    pending = ""
    for chunk in chunks:
        pending += chunk
        # A trailing CR may be the first half of a CRLF split across chunks.
        end = len(pending) - 1 if pending.endswith("\r") else len(pending)
        start = 0
        for match in _LINE_BREAK.finditer(pending, 0, end):
            yield pending[start : match.start()]
            start = match.end()
        pending = pending[start:]
    if pending.endswith("\r"):
        yield pending[:-1]
    # Any other unterminated text at the end of the stream is discarded, as the format requires.


@dataclass
class SSEMessage:
    event: str
    data: str
    id: Optional[str]


class SSEParser:
    """Incremental text/event-stream parser, fed one line at a time."""

    def __init__(self) -> None:
        self._event = ""
        self._data: list[str] = []
        self.last_id: Optional[str] = None

    def feed(self, line: str) -> Optional[SSEMessage]:
        if not line:
            if not self._data:
                self._event = ""
                return None
            message = SSEMessage(self._event or "message", "\n".join(self._data), self.last_id)
            self._event, self._data = "", []
            return message
        if line.startswith(":"):
            return None
        name, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if name == "data":
            self._data.append(value)
        elif name == "event":
            self._event = value
        elif name == "id":
            self.last_id = value
        return None


class EventFeed:
    """Agent events that match a filter, replayed and then followed live.

    The API ends each stream after a minute, and connections drop. The feed
    reconnects after the last event it delivered, so events are neither
    repeated nor skipped.
    """

    def __init__(
        self,
        client: TeamflowClient,
        *,
        task: Optional[int] = None,
        project: Optional[int] = None,
        session: Optional[str] = None,
        after: int = 0,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.client = client
        self.filters = {
            name: value
            for name, value in (("task", task), ("project", project), ("session", session))
            if value
        }
        self.after = after
        self._sleep = sleep

    def history(self) -> list[Event]:
        """Every matching event after the cursor, oldest first. Moves the cursor past them."""
        events: list[Event] = []
        while True:
            page = self.client.get(
                "/agents/events", params={**self.filters, "after": self.after, "limit": PAGE_SIZE}
            )
            batch = [
                event
                for event in (page or {}).get("events") or []
                if isinstance(event.get("id"), int) and event["id"] > self.after
            ]
            if not batch:
                return events
            events.extend(batch)
            self.after = max(event["id"] for event in batch)
            if len(batch) < PAGE_SIZE:
                return events

    def follow(self, on_retry: Optional[RetryCallback] = None) -> Iterator[Optional[Event]]:
        """Yield events as they arrive, and None for every other line.

        The server sends a keep-alive several times a second, so the None values
        give callers regular chances to check timers.
        """
        failures = 0
        while True:
            error: Exception
            try:
                with self.client.stream(
                    "/agents/events/stream", params={**self.filters, "after": self.after}
                ) as response:
                    failures = 0
                    parser = SSEParser()
                    for line in sse_lines(response.iter_text()):
                        yield self._accept(parser.feed(line))
            except ApiError as exc:
                if exc.status < 500:
                    raise
                error = exc
            except (ConnectionFailedError, httpx.HTTPError) as exc:
                error = exc
            else:
                self._sleep(RECONNECT_DELAY)
                continue
            failures += 1
            delay = min(MAX_BACKOFF, 2.0 ** (failures - 1))
            if on_retry is not None:
                on_retry(delay, error)
            self._sleep(delay)

    def _accept(self, message: Optional[SSEMessage]) -> Optional[Event]:
        if message is None or message.event not in ("agent_event", "message"):
            return None
        try:
            event = json.loads(message.data)
        except ValueError:
            return None
        if not isinstance(event, dict) or not isinstance(event.get("id"), int):
            return None
        if event["id"] <= self.after:
            return None
        self.after = event["id"]
        return event


def latest_event_id(client: TeamflowClient) -> int:
    """The newest event id in the workspace, so a feed can start from now."""
    data = client.get("/agents/swarm-feed")
    items = data.get("feed") if isinstance(data, dict) else data
    ids = [item["id"] for item in items or [] if isinstance(item.get("id"), int)]
    return max(ids, default=0)


def approval_request(event: Event) -> Optional[int]:
    """The approval id when the event asks a human to approve a release."""
    metadata = event.get("metadata")
    if not isinstance(metadata, dict) or not metadata.get("requires_confirmation"):
        return None
    try:
        return int(metadata["approval_id"])
    except (KeyError, TypeError, ValueError):
        return None


@dataclass
class RunOutcome:
    """How a run ended, as far as anyone watching it is concerned."""

    # completed, release_failed, failed, awaiting_approval, rejected or superseded
    state: str
    trace: dict[str, Any]
    approval: Optional[dict[str, Any]] = None

    @property
    def ok(self) -> bool:
        return self.state in ("completed", "awaiting_approval")


@dataclass
class _Run:
    session_id: str
    task_id: Optional[int] = None
    approval_id: Optional[int] = None

    def learn(self, event: Event) -> None:
        if self.task_id is None and isinstance(event.get("task"), int):
            self.task_id = event["task"]
        self.approval_id = approval_request(event) or self.approval_id


def watch_run(
    client: TeamflowClient,
    session_id: str,
    *,
    show: Callable[[Event], None],
    task_id: Optional[int] = None,
    on_retry: Optional[RetryCallback] = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    poll_every: float = 3.0,
    grace: float = 3.0,
) -> RunOutcome:
    """Show a run's events until it ends, then return how it ended.

    The run's trace records when it ends. Events written just after that still
    arrive during a short grace period.
    """
    run = _Run(session_id, task_id)
    feed = EventFeed(client, session=session_id, sleep=sleep)

    def deliver(event: Event) -> None:
        run.learn(event)
        show(event)

    for event in feed.history():
        deliver(event)
    if run.task_id is None:
        raise CliError(f"No agent run was found with session {session_id}.")

    outcome = _outcome(client, run)
    if outcome is None:
        outcome = _follow_until_ended(
            client, run, feed, deliver, on_retry, clock, poll_every, grace
        )
    for event in feed.history():
        deliver(event)
    return outcome


def _follow_until_ended(
    client: TeamflowClient,
    run: _Run,
    feed: EventFeed,
    deliver: Callable[[Event], None],
    on_retry: Optional[RetryCallback],
    clock: Callable[[], float],
    poll_every: float,
    grace: float,
) -> RunOutcome:
    outcome: Optional[RunOutcome] = None
    stop_at = 0.0
    next_poll = clock() + poll_every
    with contextlib.closing(feed.follow(on_retry)) as events:
        for event in events:
            if event is not None:
                deliver(event)
            now = clock()
            if outcome is None and now >= next_poll:
                next_poll = now + poll_every
                outcome = _outcome(client, run)
                stop_at = now + grace
            if outcome is not None and now >= stop_at:
                return outcome
    raise CliError("The agent event stream ended unexpectedly.")


def _outcome(client: TeamflowClient, run: _Run) -> Optional[RunOutcome]:
    """How the run ended, or None while it is still going (including while a release merges)."""
    try:
        traces = client.get(f"/agents/traces/{run.task_id}") or []
        trace = next((t for t in traces if t.get("session_id") == run.session_id), None)
        if trace is None:
            return None
        status = trace.get("status")
        if status == "failed":
            return RunOutcome("failed", trace)
        if status == "completed":
            phase = (trace.get("graph_state") or {}).get("phase")
            return RunOutcome("release_failed" if phase == "release_failed" else "completed", trace)
        if status != "awaiting_approval":
            return None
        approval = _run_approval(client, run)
    except ConnectionFailedError:
        return None
    except ApiError as exc:
        if exc.status < 500:
            raise
        return None
    # The trace stays awaiting approval through the merge, and for good after a rejection,
    # so the approval tells where the release stands.
    decision = (approval or {}).get("status", "pending")
    if decision == "pending":
        return RunOutcome("awaiting_approval", trace, approval)
    if decision == "executed":
        return RunOutcome("completed", trace, approval)
    if decision == "failed":
        return RunOutcome("release_failed", trace, approval)
    if decision in ("rejected", "superseded"):
        return RunOutcome(decision, trace, approval)
    return None  # Approved: the merge is still running.


def _run_approval(client: TeamflowClient, run: _Run) -> Optional[dict[str, Any]]:
    if run.approval_id is not None:
        return client.get(f"/agents/approvals/{run.approval_id}")
    approvals = client.get("/agents/approvals", params={"task": run.task_id}) or []
    return approvals[0] if approvals else None
