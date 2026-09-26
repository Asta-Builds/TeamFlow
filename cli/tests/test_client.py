import signal
import unittest

import httpx

from teamflow_cli.client import TeamflowClient, error_detail
from teamflow_cli.config import Session
from teamflow_cli.errors import ApiError, ConnectionFailedError, NotLoggedInError

from .support import URL, FakeApi, body, logged_in_store, temp_store


class ErrorDetailTests(unittest.TestCase):
    def detail(self, status, **kwargs):
        return error_detail(httpx.Response(status, **kwargs))

    def test_nest_messages(self):
        self.assertEqual(
            self.detail(400, json={"message": ["title should not be empty", "project must be an integer"]}),
            "title should not be empty, project must be an integer",
        )
        self.assertEqual(self.detail(404, json={"message": "Task #9 not found", "statusCode": 404}), "Task #9 not found")

    def test_drf_detail_and_field_errors(self):
        self.assertEqual(self.detail(409, json={"detail": "Approval #3 is executed, not pending."}), "Approval #3 is executed, not pending.")
        self.assertEqual(self.detail(400, json={"title": ["This field is required."]}), "title: This field is required.")

    def test_html_error_page_falls_back_to_the_status_reason(self):
        self.assertEqual(self.detail(502, text="<html><body>Bad gateway</body></html>"), "Bad Gateway")


class ClientTests(unittest.TestCase):
    def client(self, api, store):
        client = TeamflowClient(URL, store, transport=api.transport)
        self.addCleanup(client.close)
        return client

    def test_requests_carry_the_saved_access_token(self):
        api = FakeApi()
        api.on("GET", "/projects", (200, [{"id": 1}]))
        self.assertEqual(self.client(api, logged_in_store(self)).get("/projects"), [{"id": 1}])
        self.assertEqual(api.calls[0].headers["Authorization"], "Bearer access-1")

    def test_rejected_token_is_refreshed_once_and_saved(self):
        api = FakeApi()
        api.on("GET", "/projects", (401, {"message": "Unauthorized"}), (200, []))
        api.on("POST", "/auth/refresh", (200, {"access": "access-2", "refresh": "refresh-2"}))
        store = logged_in_store(self)

        self.client(api, store).get("/projects")

        self.assertEqual(body(api.requests("POST", "/auth/refresh")[0]), {"refresh": "refresh-1"})
        self.assertEqual(api.requests("GET", "/projects")[1].headers["Authorization"], "Bearer access-2")
        self.assertEqual(store.session(URL), Session("access-2", "refresh-2", "ceo@example.com"))

    def test_tokens_refreshed_by_another_process_are_reused(self):
        # Presenting the old refresh token again would sign the user out everywhere.
        store = logged_in_store(self)

        def rejected_after_another_refresh(request):
            store.save_session(URL, Session("access-2", "refresh-2"), make_current=False)
            return httpx.Response(401, json={"message": "Unauthorized"})

        api = FakeApi()
        api.on("GET", "/projects", rejected_after_another_refresh, (200, []))

        self.client(api, store).get("/projects")

        self.assertEqual(api.requests("POST", "/auth/refresh"), [])
        self.assertEqual(api.requests("GET", "/projects")[1].headers["Authorization"], "Bearer access-2")

    def test_ctrl_c_during_a_refresh_waits_until_the_new_tokens_are_saved(self):
        # The server has spent the old refresh token by now; losing the new one would sign the user out.
        def rotate_then_interrupt(request):
            signal.raise_signal(signal.SIGINT)
            return httpx.Response(200, json={"access": "access-2", "refresh": "refresh-2"})

        api = FakeApi()
        api.on("GET", "/projects", (401, {"message": "Unauthorized"}))
        api.on("POST", "/auth/refresh", rotate_then_interrupt)
        store = logged_in_store(self)
        handler = signal.getsignal(signal.SIGINT)

        with self.assertRaises(KeyboardInterrupt):
            self.client(api, store).get("/projects")

        self.assertEqual(store.session(URL).refresh, "refresh-2")
        self.assertIs(signal.getsignal(signal.SIGINT), handler)

    def test_rejected_refresh_ends_the_local_session(self):
        api = FakeApi()
        api.on("GET", "/projects", (401, {"message": "Unauthorized"}))
        api.on("POST", "/auth/refresh", (401, {"message": "Refresh token reuse detected"}))
        store = logged_in_store(self)

        with self.assertRaises(NotLoggedInError) as caught:
            self.client(api, store).get("/projects")

        self.assertIn("session has expired", caught.exception.message)
        self.assertIsNone(store.session(URL))

    def test_api_errors_carry_the_server_reason(self):
        api = FakeApi()
        api.on("POST", "/agents/dispatch/7", (403, {"message": "Only Tech Lead, CEO or Admin can run autonomous agents"}))
        with self.assertRaises(ApiError) as caught:
            self.client(api, logged_in_store(self)).post("/agents/dispatch/7")
        self.assertEqual(caught.exception.status, 403)
        self.assertIn("Only Tech Lead", caught.exception.message)

    def test_login_request_sends_no_token(self):
        api = FakeApi()
        api.on("POST", "/auth/login", (200, {"access": "a", "refresh": "r"}))
        self.client(api, temp_store(self)).post("/auth/login", json={"email": "e", "password": "p"}, auth=False)
        self.assertNotIn("Authorization", api.calls[0].headers)

    def test_missing_session_asks_to_log_in(self):
        with self.assertRaises(NotLoggedInError) as caught:
            self.client(FakeApi(), temp_store(self)).get("/projects")
        self.assertIn(f"teamflow login {URL}", caught.exception.message)

    def test_unreachable_server(self):
        def refuse(request):
            raise httpx.ConnectError("connection refused", request=request)

        client = TeamflowClient(URL, logged_in_store(self), transport=httpx.MockTransport(refuse))
        self.addCleanup(client.close)
        with self.assertRaises(ConnectionFailedError) as caught:
            client.get("/projects")
        self.assertIn(f"Cannot reach TeamFlow at {URL}", caught.exception.message)
        with self.assertRaises(ConnectionFailedError) as caught:
            client.post("/agents/dispatch/7")
        self.assertIn("may still have been applied", caught.exception.message)

    def test_stream_refreshes_a_rejected_token(self):
        api = FakeApi()
        api.on("GET", "/agents/events/stream", (401, {"message": "Unauthorized"}), lambda r: httpx.Response(200, content=b": keep-alive\n\n"))
        api.on("POST", "/auth/refresh", (200, {"access": "access-2", "refresh": "refresh-2"}))

        with self.client(api, logged_in_store(self)).stream("/agents/events/stream") as response:
            self.assertEqual(list(response.iter_lines()), [": keep-alive", ""])
        self.assertEqual(api.requests("GET", "/agents/events/stream")[1].headers["Authorization"], "Bearer access-2")

    def test_revoke_reports_an_expired_access_token(self):
        api = FakeApi()
        api.on("POST", "/auth/logout", (401, {"message": "Unauthorized"}), (200, {"detail": "Successfully logged out."}))
        client = self.client(api, temp_store(self))
        self.assertFalse(client.revoke(Session("old", "r")))
        self.assertTrue(client.revoke(Session("new", "r")))
