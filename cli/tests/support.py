"""A scripted TeamFlow API behind httpx.MockTransport, and other test helpers."""

from __future__ import annotations

import functools
import json
import re
import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable, Union
from unittest import mock

import httpx
from typer.testing import CliRunner

from teamflow_cli import events
from teamflow_cli.commands import agents as agent_commands
from teamflow_cli.config import HostStore, Session
from teamflow_cli.main import app
from teamflow_cli.state import AppState

URL = "http://localhost:8001"
SESSION = "graph-task-7-3f9c2a1b7e"
USER = {"id": 1, "name": "Ada", "email": "ada@example.com", "role": "ceo", "organization_name": "Acme", "organization_tier": "pro"}
TICKET = {"id": 7, "title": "Add password reset", "status": "qa", "project": 12, "project_name": "Storefront", "pr_url": "https://github.com/acme/shop/pull/42"}

Responder = Union[tuple[int, Any], Callable[[httpx.Request], httpx.Response]]


class FakeApi:
    """Answers /api routes from queued responses; the last response of a route repeats.

    `events` is served like the real API: /agents/events pages through it and
    /agents/events/stream sends what is newer than `after`, then ends the stream.
    """

    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], list[Responder]] = {}
        self.calls: list[httpx.Request] = []
        self.events: list[dict[str, Any]] = []
        self.on("GET", "/agents/events", self._events_page)
        self.on("GET", "/agents/events/stream", self._events_stream)

    def on(self, method: str, path: str, *responses: Responder) -> None:
        self.routes[(method, "/api" + path)] = list(responses)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def requests(self, method: str, path: str) -> list[httpx.Request]:
        return [r for r in self.calls if r.method == method and r.url.path == "/api" + path]

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        queue = self.routes.get((request.method, request.url.path))
        if not queue:
            return httpx.Response(404, json={"message": f"No route for {request.method} {request.url.path}"})
        responder = queue.pop(0) if len(queue) > 1 else queue[0]
        if callable(responder):
            return responder(request)
        status, body = responder
        return httpx.Response(status, json=body)

    def _matching(self, request: httpx.Request) -> list[dict[str, Any]]:
        params = request.url.params
        after = int(params.get("after", "0"))
        found = [e for e in self.events if e["id"] > after]
        if "session" in params:
            found = [e for e in found if e["session_id"] == params["session"]]
        if "task" in params:
            found = [e for e in found if e["task"] == int(params["task"])]
        return found

    def _events_page(self, request: httpx.Request) -> httpx.Response:
        limit = int(request.url.params.get("limit", "100"))
        page = self._matching(request)[:limit]
        last = page[-1]["id"] if page else int(request.url.params.get("after", "0"))
        return httpx.Response(200, json={"events": page, "last_event_id": last})

    def _events_stream(self, request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=sse(*self._matching(request)), headers={"content-type": "text/event-stream"}
        )


def bounded_sleep(limit: int = 200) -> tuple[Callable[[float], None], list[float]]:
    """A sleep that records its delays, and fails instead of hanging when a feed never gets what it waits for."""
    delays: list[float] = []

    def sleep(seconds: float) -> None:
        delays.append(seconds)
        if len(delays) > limit:
            raise AssertionError(f"Still reconnecting after {limit} attempts")

    return sleep, delays


def raising(error: BaseException) -> Callable[[httpx.Request], httpx.Response]:
    """A responder that fails the request, as a dropped network or a Ctrl+C would."""

    def respond(request: httpx.Request) -> httpx.Response:
        raise error

    return respond


def sse(*events: dict[str, Any], keepalives: int = 3) -> bytes:
    body = "".join(f"id: {e['id']}\nevent: agent_event\ndata: {json.dumps(e)}\n\n" for e in events)
    return (body + ": keep-alive\n\n" * keepalives).encode()


def event(
    event_id: int,
    message: str = "Working on it",
    *,
    kind: str = "progress",
    sender: str = "tech_lead",
    name: str = "Sarah Jenkins (AI)",
    recipient: str = "",
    session: str = SESSION,
    task: int = 7,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": event_id,
        "session_id": session,
        "event_type": kind,
        "sender_key": sender,
        "sender_name": name,
        "sender_role": sender,
        "recipient_key": recipient,
        "message": message,
        "current_work": "",
        "remaining_work": [],
        "metadata": metadata or {},
        "task": task,
        "task_title": "Add password reset",
        "project": 3,
        "project_name": "Storefront",
        "trace": 11,
        "created_at": "2026-09-26T14:02:11.000Z",
    }


def trace(status: str, **extra: Any) -> dict[str, Any]:
    return {"id": 11, "task": 7, "session_id": SESSION, "status": status, "graph_state": {}, **extra}


def temp_store(test: unittest.TestCase) -> HostStore:
    directory = tempfile.TemporaryDirectory()
    test.addCleanup(directory.cleanup)
    return HostStore(Path(directory.name))


def logged_in_store(test: unittest.TestCase, url: str = URL) -> HostStore:
    store = temp_store(test)
    store.save_session(url, Session(access="access-1", refresh="refresh-1", email="ceo@example.com"), make_current=True)
    return store


def body(request: httpx.Request) -> Any:
    return json.loads(request.content) if request.content else None


def plain(text: str) -> str:
    """Output without ANSI styling, in case the tests run in a color terminal."""
    return re.sub(r"\x1b\[[0-9;]*m", "", text)


class CommandTestCase(unittest.TestCase):
    """Runs `teamflow` in-process against a FakeApi, logged in on URL."""

    def setUp(self):
        self.api = FakeApi()
        self.store = logged_in_store(self)
        self.runner = CliRunner()

    def run_cli(self, *args, input=None):
        state = AppState(store=self.store, transport=self.api.transport)
        result = self.runner.invoke(app, list(args), input=input, obj=state)
        if result.exception is not None and not isinstance(result.exception, SystemExit):
            raise result.exception
        return result.exit_code, plain(result.output)


class AgentTestCase(CommandTestCase):
    """Agent runs on ticket 7, watched without the real polling delays."""

    def setUp(self):
        super().setUp()
        fast = functools.partial(events.watch_run, poll_every=0, grace=0, sleep=bounded_sleep()[0])
        patcher = mock.patch.object(agent_commands, "watch_run", fast)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.api.on("POST", "/agents/dispatch/7", (202, {"message": "Multi-agent swarm queued.", "trace": trace("running"), "task_status": "todo"}))
        self.api.on("GET", "/tasks/7", (200, TICKET))
