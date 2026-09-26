import json
import unittest

import httpx

from teamflow_cli.client import TeamflowClient
from teamflow_cli.errors import ApiError, CliError
from teamflow_cli.events import (
    EventFeed,
    SSEParser,
    latest_event_id,
    sse_lines,
    watch_run,
)

from .support import (
    SESSION,
    URL,
    FakeApi,
    bounded_sleep,
    event,
    logged_in_store,
    sse,
    trace,
)


class SSELinesTests(unittest.TestCase):
    def test_crlf_split_across_chunks_is_one_break(self):
        self.assertEqual(list(sse_lines(["data: a\r", "\n\r\n"])), ["data: a", ""])

    def test_lone_carriage_returns_end_lines(self):
        self.assertEqual(list(sse_lines(["a\rb", "\r"])), ["a", "b"])

    def test_only_cr_and_lf_break_lines(self):
        text = 'data: {"message": "one two\x85three"}\n\n'
        self.assertEqual(list(sse_lines([text])), [text[:-2], ""])

    def test_an_unterminated_last_line_is_dropped(self):
        self.assertEqual(list(sse_lines(["a\nb"])), ["a"])


class SSEParserTests(unittest.TestCase):
    def parse(self, text):
        parser = SSEParser()
        return [m for m in (parser.feed(line) for line in text.split("\n")) if m is not None]

    def test_messages_comments_and_multiline_data(self):
        messages = self.parse(": keep-alive\n\nid: 4\nevent: agent_event\ndata: {\"a\":\ndata: 1}\n\ndata: plain\n\n")
        self.assertEqual([(m.event, m.data, m.id) for m in messages], [("agent_event", '{"a":\n1}', "4"), ("message", "plain", "4")])

    def test_a_blank_line_without_data_dispatches_nothing(self):
        self.assertEqual(self.parse("event: agent_event\n\n\n"), [])


class FeedTestCase(unittest.TestCase):
    def setUp(self):
        self.api = FakeApi()
        self.client = TeamflowClient(URL, logged_in_store(self), transport=self.api.transport)
        self.addCleanup(self.client.close)
        self.sleep, self.sleeps = bounded_sleep()

    def feed(self, **filters):
        return EventFeed(self.client, sleep=self.sleep, **filters)

    def take(self, events, count):
        found = []
        for item in events:
            if item is not None:
                found.append(item)
                if len(found) == count:
                    events.close()
                    return found
        return found


class EventFeedTests(FeedTestCase):
    def test_history_pages_through_every_matching_event(self):
        self.api.events = [event(i) for i in range(1, 451)]
        feed = self.feed(session=SESSION)

        self.assertEqual([e["id"] for e in feed.history()], list(range(1, 451)))
        self.assertEqual(feed.after, 450)
        self.assertEqual(len(self.api.requests("GET", "/agents/events")), 3)

    def test_follow_resumes_after_the_last_event_when_the_stream_ends(self):
        self.api.events = [event(1), event(2)]

        def stream(request):
            response = self.api._events_stream(request)
            self.api.events.append(event(len(self.api.events) + 1))  # Arrives after this stream closes.
            return response

        self.api.on("GET", "/agents/events/stream", stream)

        found = self.take(self.feed(task=7).follow(), 3)

        self.assertEqual([e["id"] for e in found], [1, 2, 3])
        afters = [r.url.params["after"] for r in self.api.requests("GET", "/agents/events/stream")]
        self.assertEqual(afters, ["0", "2"])
        self.assertEqual(self.sleeps, [0.5])

    def test_messages_with_unicode_line_separators_arrive_whole(self):
        message = "Step one step two"
        payload = json.dumps(event(1, message), ensure_ascii=False)  # As JSON.stringify sends it.
        self.api.on("GET", "/agents/events/stream", lambda r: httpx.Response(200, content=f"id: 1\ndata: {payload}\n\n".encode()))
        self.assertEqual(self.take(self.feed().follow(), 1)[0]["message"], message)

    def test_follow_skips_events_it_already_delivered(self):
        self.api.on("GET", "/agents/events/stream", lambda r: httpx.Response(200, content=sse(event(5), event(5), event(4), event(6))))
        self.assertEqual([e["id"] for e in self.take(self.feed().follow(), 2)], [5, 6])

    def test_follow_retries_server_errors_with_backoff(self):
        self.api.events = [event(1)]
        self.api.on("GET", "/agents/events/stream", (502, {"message": "Bad gateway"}), (503, {"message": "Unavailable"}), self.api._events_stream)
        retries = []

        found = self.take(self.feed().follow(lambda delay, error: retries.append(delay)), 1)

        self.assertEqual(found[0]["id"], 1)
        self.assertEqual(retries, [1.0, 2.0])

    def test_follow_reconnects_after_a_dropped_connection(self):
        class Dropped(httpx.SyncByteStream):
            def __iter__(self):
                yield sse(event(1), keepalives=0)
                raise httpx.ReadError("connection reset")

        self.api.events = [event(1), event(2)]
        self.api.on("GET", "/agents/events/stream", lambda r: httpx.Response(200, stream=Dropped()), self.api._events_stream)

        found = self.take(self.feed().follow(), 2)

        self.assertEqual([e["id"] for e in found], [1, 2])
        self.assertEqual(self.api.requests("GET", "/agents/events/stream")[1].url.params["after"], "1")

    def test_follow_gives_up_on_client_errors(self):
        self.api.on("GET", "/agents/events/stream", (403, {"message": "An organization is required for agent operations"}))
        with self.assertRaises(ApiError):
            next(self.feed().follow())

    def test_latest_event_id_reads_the_swarm_feed(self):
        self.api.on("GET", "/agents/swarm-feed", (200, [{"id": 41}, {"id": 44}, {"id": 43}]))
        self.assertEqual(latest_event_id(self.client), 44)


class WatchRunTests(FeedTestCase):
    def watch(self, **kwargs):
        shown = []
        outcome = watch_run(self.client, SESSION, show=shown.append, sleep=self.sleep, poll_every=0, grace=0, **kwargs)
        return outcome, [e["id"] for e in shown]

    def progress_then(self, *statuses):
        """Traces report `statuses` in turn; each poll also records one more event."""
        remaining = list(statuses)

        def respond(request):
            self.api.events.append(event(len(self.api.events) + 1))
            status = remaining.pop(0) if len(remaining) > 1 else remaining[0]
            return httpx.Response(200, json=[trace(status, duration_seconds=12, tokens_used=900)])

        self.api.on("GET", "/agents/traces/7", respond)

    def test_shows_every_event_until_the_run_completes(self):
        self.api.events = [event(1, "The autonomous graph run is queued", kind="queued")]
        self.progress_then("running", "running", "completed")

        outcome, shown = self.watch(task_id=7)

        self.assertEqual(outcome.state, "completed")
        self.assertTrue(outcome.ok)
        self.assertEqual(shown, list(range(1, len(self.api.events) + 1)))

    def test_a_finished_run_is_replayed_without_streaming(self):
        self.api.events = [event(1), event(2, kind="completed")]
        self.api.on("GET", "/agents/traces/7", (200, [trace("completed")]))

        outcome, shown = self.watch()

        self.assertEqual((outcome.state, shown), ("completed", [1, 2]))
        self.assertEqual(self.api.requests("GET", "/agents/events/stream"), [])

    def test_a_pending_release_ends_the_watch(self):
        gate = {"requires_confirmation": True, "approval_id": 8}
        self.api.events = [event(1), event(2, kind="blocked", sender="devops", metadata=gate)]
        self.api.on("GET", "/agents/traces/7", (200, [trace("awaiting_approval")]))
        self.api.on("GET", "/agents/approvals/8", (200, {"id": 8, "status": "pending"}))

        outcome, _ = self.watch()

        self.assertEqual(outcome.state, "awaiting_approval")
        self.assertEqual(outcome.approval["id"], 8)
        self.assertTrue(outcome.ok)

    def test_an_approved_release_is_followed_until_it_merges(self):
        gate = {"requires_confirmation": True, "approval_id": 8}
        self.api.events = [event(1, kind="blocked", sender="devops", metadata=gate)]
        self.progress_then("awaiting_approval", "awaiting_approval", "completed")
        self.api.on("GET", "/agents/approvals/8", (200, {"id": 8, "status": "approved"}))

        outcome, _ = self.watch()

        self.assertEqual(outcome.state, "completed")
        self.assertGreaterEqual(len(self.api.requests("GET", "/agents/approvals/8")), 2)

    def test_the_approval_reports_a_finished_release_before_the_trace_does(self):
        self.api.events = [event(1)]
        self.api.on("GET", "/agents/traces/7", (200, [trace("awaiting_approval")]))
        for decision, state in (("executed", "completed"), ("failed", "release_failed")):
            with self.subTest(decision=decision):
                self.api.on("GET", "/agents/approvals", (200, [{"id": 8, "status": decision}]))
                outcome, _ = self.watch()
                self.assertEqual(outcome.state, state)

    def test_a_rejected_release_is_not_ok(self):
        self.api.events = [event(1)]
        self.api.on("GET", "/agents/traces/7", (200, [trace("awaiting_approval")]))
        self.api.on("GET", "/agents/approvals", (200, [{"id": 8, "status": "rejected", "decision_reason": "Missing tests"}]))

        outcome, _ = self.watch()

        self.assertEqual(outcome.state, "rejected")
        self.assertFalse(outcome.ok)

    def test_a_release_that_did_not_merge_is_not_ok(self):
        self.api.events = [event(1)]
        self.api.on("GET", "/agents/traces/7", (200, [trace("completed", graph_state={"phase": "release_failed"})]))
        outcome, _ = self.watch()
        self.assertEqual(outcome.state, "release_failed")
        self.assertFalse(outcome.ok)

    def test_the_trace_endpoint_being_down_does_not_end_the_watch(self):
        self.api.events = [event(1)]
        self.api.on("GET", "/agents/traces/7", (503, {"message": "Unavailable"}), (503, {"message": "Unavailable"}), (200, [trace("failed")]))
        outcome, _ = self.watch()
        self.assertEqual(outcome.state, "failed")

    def test_an_unknown_session_is_an_error(self):
        with self.assertRaises(CliError):
            self.watch()
