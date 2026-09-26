import json
from unittest import mock

import httpx
import typer

from teamflow_cli.config import Session

from .support import (
    SESSION,
    URL,
    USER,
    AgentTestCase,
    CommandTestCase,
    body,
    event,
    raising,
    sse,
    temp_store,
    trace,
)


class AuthCommandTests(CommandTestCase):
    def setUp(self):
        super().setUp()
        self.store = temp_store(self)

    def accept_login(self):
        self.api.on("POST", "/auth/login", (200, {"access": "a1", "refresh": "r1", "user": USER}))

    def test_login_saves_the_session_and_remembers_the_server(self):
        self.accept_login()

        code, output = self.run_cli("login", "https://tf.example.com/", input="ada@example.com\nsecret\n")

        self.assertEqual(code, 0, output)
        self.assertIn("Logged in to https://tf.example.com as Ada (ceo, Acme).", output)
        self.assertEqual(self.store.current_url(), "https://tf.example.com")
        self.assertEqual(self.store.session("https://tf.example.com"), Session("a1", "r1", "ada@example.com"))
        request = self.api.requests("POST", "/auth/login")[0]
        self.assertEqual(request.url.host, "tf.example.com")
        self.assertEqual(body(request), {"email": "ada@example.com", "password": "secret"})

    def test_login_reads_the_password_from_stdin(self):
        self.accept_login()
        code, output = self.run_cli("login", "-e", "ada@example.com", "--password-stdin", input="secret\n")
        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.calls[0])["password"], "secret")
        self.assertEqual(self.store.current_url(), URL)

    def test_piped_input_supplies_the_password_without_a_hidden_prompt(self):
        # A hidden prompt reads the console itself, so it would wait forever on piped input.
        self.accept_login()
        with mock.patch.object(typer, "prompt", wraps=typer.prompt) as prompt:
            code, output = self.run_cli("login", input="ada@example.com\nsecret\n")
        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.calls[0])["password"], "secret")
        self.assertFalse([c for c in prompt.call_args_list if c.kwargs.get("hide_input")])

    def test_failed_login_saves_nothing(self):
        self.api.on("POST", "/auth/login", (401, {"message": "Invalid email or password", "statusCode": 401}))
        code, output = self.run_cli("login", "-e", "ada@example.com", "--password-stdin", input="wrong\n")
        self.assertEqual(code, 1)
        self.assertIn("Error: Invalid email or password (HTTP 401)", output)
        self.assertIsNone(self.store.session(URL))

    def test_logging_in_again_ends_the_replaced_session(self):
        self.store.save_session(URL, Session("old-access", "old-refresh"), make_current=True)
        self.accept_login()
        self.api.on("POST", "/auth/logout", (200, {"detail": "Successfully logged out."}))

        code, output = self.run_cli("login", "-e", "ada@example.com", "--password-stdin", input="secret\n")

        self.assertEqual(code, 0, output)
        logout = self.api.requests("POST", "/auth/logout")[0]
        self.assertEqual(logout.headers["Authorization"], "Bearer old-access")
        self.assertEqual(body(logout), {"refresh": "old-refresh"})
        self.assertEqual(self.store.session(URL).access, "a1")

    def test_logout_ends_the_session_on_the_server(self):
        self.store.save_session(URL, Session("a1", "r1"), make_current=True)
        self.api.on("POST", "/auth/logout", (200, {"detail": "Successfully logged out."}))

        code, output = self.run_cli("logout")

        self.assertEqual(code, 0, output)
        self.assertIn(f"Logged out of {URL}.", output)
        self.assertEqual(self.api.requests("POST", "/auth/logout")[0].headers["Authorization"], "Bearer a1")
        self.assertIsNone(self.store.session(URL))

    def test_logout_with_an_expired_token_renews_it_first(self):
        self.store.save_session(URL, Session("a1", "r1"), make_current=True)
        self.api.on("POST", "/auth/logout", (401, {"message": "Unauthorized"}), (200, {"detail": "ok"}))
        self.api.on("POST", "/auth/refresh", (200, {"access": "a2", "refresh": "r2"}))

        code, output = self.run_cli("logout")

        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.requests("POST", "/auth/logout")[1]), {"refresh": "r2"})
        self.assertNotIn("expires on its own", output)
        self.assertIsNone(self.store.session(URL))

    def test_logout_offline_still_forgets_the_session(self):
        self.store.save_session(URL, Session("a1", "r1"), make_current=True)
        self.api.on("POST", "/auth/logout", raising(httpx.ConnectError("connection refused")))

        code, output = self.run_cli("logout")

        self.assertEqual(code, 0, output)
        self.assertIn("expires on its own within a week", output)
        self.assertIsNone(self.store.session(URL))

    def test_commands_ask_to_log_in_first(self):
        code, output = self.run_cli("projects", "list")
        self.assertEqual(code, 1)
        self.assertIn(f"You are not logged in on {URL}. Run: teamflow login {URL}", output)

    def test_whoami(self):
        self.store.save_session(URL, Session("a1", "r1"), make_current=True)
        self.api.on("GET", "/auth/me", (200, USER))
        code, output = self.run_cli("whoami")
        self.assertEqual(code, 0, output)
        for text in (URL, "Ada", "ada@example.com", "Acme (pro)"):
            self.assertIn(text, output)

    def test_url_option_selects_another_server(self):
        self.store.save_session("https://tf.example.com", Session("remote", "r"), make_current=False)
        self.store.save_session(URL, Session("local", "r"), make_current=True)
        self.api.on("GET", "/auth/me", (200, USER))

        code, output = self.run_cli("--url", "https://tf.example.com/api", "whoami", "--json")

        self.assertEqual(code, 0, output)
        self.assertEqual(self.api.calls[0].headers["Authorization"], "Bearer remote")


class ProjectAndTaskCommandTests(CommandTestCase):
    PROJECT = {"id": 12, "name": "Storefront", "status": "active", "task_count": 4, "done_task_count": 1, "progress_percentage": 25, "github_repo": "acme/shop"}

    def test_projects_list_json_is_the_api_response(self):
        self.api.on("GET", "/projects", (200, [self.PROJECT]))
        code, output = self.run_cli("projects", "list", "--json")
        self.assertEqual(code, 0, output)
        self.assertEqual(json.loads(output), [self.PROJECT])

    def test_projects_list_table(self):
        self.api.on("GET", "/projects", (200, [self.PROJECT]))
        code, output = self.run_cli("projects", "list", "--status", "active")
        self.assertEqual(code, 0, output)
        self.assertEqual(self.api.calls[0].url.params["status"], "active")
        for text in ("Storefront", "1/4", "25%", "acme/shop"):
            self.assertIn(text, output)

    def test_project_show_counts_tickets_per_column(self):
        self.api.on("GET", "/projects/12", (200, self.PROJECT))
        self.api.on("GET", "/tasks", (200, [{"status": "qa"}, {"status": "qa"}, {"status": "done"}, {"status": "todo"}]))
        code, output = self.run_cli("projects", "show", "12")
        self.assertEqual(code, 0, output)
        self.assertIn("todo 1   in progress 0   in review 0   qa 2   done 1", output)

    def test_tasks_create_sends_only_the_given_fields(self):
        self.api.on("POST", "/tasks", (201, {"id": 57, "title": "Add password reset", "project_name": "Storefront"}))

        code, output = self.run_cli("tasks", "create", "Add password reset", "-p", "12", "--priority", "high")

        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.requests("POST", "/tasks")[0]), {"project": 12, "title": "Add password reset", "priority": "high"})
        self.assertIn("Created task #57 in Storefront: Add password reset", output)
        self.assertIn("teamflow agents run 57", output)

    def test_tasks_list_mine_filters_on_the_current_user(self):
        self.api.on("GET", "/auth/me", (200, {"id": 5}))
        self.api.on("GET", "/tasks", (200, []))

        code, output = self.run_cli("tasks", "list", "--mine", "--status", "qa")

        self.assertEqual(code, 0, output)
        params = self.api.requests("GET", "/tasks")[0].url.params
        self.assertEqual((params["assignee"], params["status"]), ("5", "qa"))
        self.assertIn("No tickets found.", output)

    def test_mine_and_assignee_together_is_a_usage_error(self):
        code, output = self.run_cli("tasks", "list", "--mine", "--assignee", "3")
        self.assertEqual(code, 2)
        self.assertIn("Use either --mine or --assignee", output)
        self.assertEqual(self.api.calls, [])

    def test_tasks_move(self):
        self.api.on("PATCH", "/tasks/57", (200, {"id": 57, "status": "qa"}))
        code, output = self.run_cli("tasks", "move", "57", "QA")
        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.requests("PATCH", "/tasks/57")[0]), {"status": "qa"})
        self.assertIn("Task #57 is now qa.", output)

    def test_an_unknown_column_is_refused_before_calling_the_api(self):
        code, _ = self.run_cli("tasks", "move", "57", "shipped")
        self.assertEqual(code, 2)
        self.assertEqual(self.api.calls, [])

    def test_tasks_update_needs_a_change(self):
        code, output = self.run_cli("tasks", "update", "57")
        self.assertEqual(code, 2)
        self.assertIn("Nothing to change", output)

    def test_tasks_show_prints_api_text_verbatim(self):
        ticket = {
            "id": 57,
            "title": "Fix [bold]login[/bold]",
            "status": "qa",
            "project": 12,
            "project_name": "Storefront",
            "task_type": "bug",
            "priority": "urgent",
            "assignee_detail": {"name": "Marcus Aurelius (AI)"},
            "validation_contract": [{"id": "VC-1", "status": "PASSED", "assertion": "Reset links expire after an hour"}],
            "contract_compliance_score": "80",
            "comments": [{"created_at": "2026-09-26T14:02:11Z", "author_detail": {"name": "Alan Turing (AI)"}, "body": "Looks good :smile:"}],
        }
        self.api.on("GET", "/tasks/57", (200, ticket))

        code, output = self.run_cli("tasks", "show", "57")

        self.assertEqual(code, 0, output)
        for text in ("#57 Fix [bold]login[/bold]", "VC-1", "PASSED", "80% compliant", "Alan Turing (AI): Looks good :smile:"):
            self.assertIn(text, output)

    def test_tasks_show_has_no_compliance_score_without_a_contract(self):
        self.api.on("GET", "/tasks/57", (200, {"id": 57, "title": "New", "status": "todo", "contract_compliance_score": 0, "validation_contract": []}))
        code, output = self.run_cli("tasks", "show", "57")
        self.assertEqual(code, 0, output)
        self.assertNotIn("compliant", output)

    def test_server_errors_are_reported_without_a_traceback(self):
        self.api.on("GET", "/projects", (503, {"message": "Service Unavailable"}))
        code, output = self.run_cli("projects", "list")
        self.assertEqual(code, 1)
        self.assertIn("Error: Service Unavailable (HTTP 503)", output)
        self.assertNotIn("Traceback", output)


class AgentCommandTests(AgentTestCase):
    def test_run_without_watching_prints_the_session(self):
        code, output = self.run_cli("agents", "run", "7", "--no-watch")
        self.assertEqual(code, 0, output)
        self.assertIn(f"teamflow agents watch --session {SESSION}", output)
        self.assertEqual(self.api.requests("GET", "/agents/events/stream"), [])

    def test_run_streams_the_agents_until_the_run_finishes(self):
        self.api.events = [
            event(1, "The autonomous graph run is queued and waiting for an agent worker.", kind="queued", sender="", name=""),
            event(2, "Backend plan ready", kind="handoff", recipient="backend_core"),
            event(3, "Committed 3 files", sender="backend_core", name="Marcus Aurelius (AI)", recipient="qa"),
        ]
        self.api.on("GET", "/agents/traces/7", (200, [trace("running")]), (200, [trace("completed", duration_seconds=175, tokens_used=48211)]))

        code, output = self.run_cli("agents", "run", "7")

        self.assertEqual(code, 0, output)
        self.assertIn("TeamFlow: The autonomous graph run is queued", output)
        self.assertIn("Sarah Jenkins (AI) -> backend_core: Backend plan ready", output)
        self.assertIn("Marcus Aurelius (AI) -> qa: Committed 3 files", output)
        self.assertIn("Run finished (2m 55s, 48,211 tokens).", output)
        self.assertIn("https://github.com/acme/shop/pull/42", output)

    def test_a_blocked_agent_is_called_out_even_when_the_run_completes(self):
        # Without a model the server records the run as completed although no code was written.
        url = "http://localhost:3001/project/cmtuisfno0006oihvk2oqcrrv/sessions/graph-task-7-3f9c2a1b7e"
        self.api.events = [event(1, "No code was generated.", kind="blocked", sender="backend_core", name="Marcus Aurelius (AI)")]
        self.api.on("GET", "/agents/traces/7", (200, [trace("completed", langfuse_url=url)]))

        code, output = self.run_cli("agents", "run", "7")

        self.assertEqual(code, 0, output)
        self.assertIn("Run finished, but an agent was blocked: No code was generated.", output)
        self.assertIn(f"Trace         {url}\n", output)

    def test_a_failed_run_exits_with_1(self):
        self.api.events = [event(1, "The orchestration run stopped because: model offline", kind="failed", sender="", name="")]
        self.api.on("GET", "/agents/traces/7", (200, [trace("failed", graph_state={"error": "model offline"})]))

        code, output = self.run_cli("agents", "run", "7")

        self.assertEqual(code, 1)
        self.assertIn("TeamFlow: failed: The orchestration run stopped because: model offline", output)
        self.assertIn("Run failed: model offline", output)

    def test_a_release_waiting_for_approval_shows_how_to_decide(self):
        gate = {"requires_confirmation": True, "approval_id": 8}
        self.api.events = [event(1, "The release is waiting for approval by a workspace owner or admin.", kind="blocked", sender="devops", name="Joan of Arc (AI)", metadata=gate)]
        self.api.on("GET", "/agents/traces/7", (200, [trace("awaiting_approval")]))
        self.api.on("GET", "/agents/approvals/8", (200, {"id": 8, "status": "pending"}))

        code, output = self.run_cli("agents", "run", "7")

        self.assertEqual(code, 0, output)
        self.assertIn("Joan of Arc (AI): blocked: The release is waiting", output)
        self.assertIn("Approve: teamflow approvals approve 8", output)

    def test_chain_runs_send_the_instruction(self):
        self.api.on("POST", "/agents/swarm-chain/7", (202, {"trace": trace("running")}))

        code, output = self.run_cli("agents", "run", "7", "-m", "Use argon2 for hashing", "--no-watch")

        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.requests("POST", "/agents/swarm-chain/7")[0]), {"instruction": "Use argon2 for hashing"})
        self.assertEqual(self.api.requests("POST", "/agents/dispatch/7"), [])
        self.assertIn("Queued the swarm chain on task #7", output)

    def test_watching_a_ticket_shows_recent_events_then_follows(self):
        self.api.events = [event(1, "one"), event(2, "two"), event(3, "three")]

        class ThenCtrlC(httpx.SyncByteStream):
            def __iter__(self):
                yield sse(event(4, "four"), keepalives=0)
                raise KeyboardInterrupt

        self.api.on("GET", "/agents/events/stream", lambda r: httpx.Response(200, stream=ThenCtrlC()))

        code, output = self.run_cli("agents", "watch", "--task", "7", "-n", "1")

        self.assertEqual(code, 0, output)
        self.assertNotIn(": two", output)
        self.assertIn(": three", output)
        self.assertIn(": four", output)
        self.assertEqual(self.api.requests("GET", "/agents/events/stream")[0].url.params["after"], "3")

    def test_watching_the_workspace_starts_from_now(self):
        self.api.on("GET", "/agents/swarm-feed", (200, [{"id": 44}, {"id": 40}]))
        self.api.on("GET", "/agents/events/stream", raising(KeyboardInterrupt()))

        code, output = self.run_cli("agents", "watch")

        self.assertEqual(code, 0, output)
        self.assertEqual(self.api.requests("GET", "/agents/events/stream")[0].url.params["after"], "44")

    def test_session_cannot_be_combined_with_task(self):
        code, _ = self.run_cli("agents", "watch", "--session", SESSION, "--task", "7")
        self.assertEqual(code, 2)


class ApprovalCommandTests(CommandTestCase):
    PENDING = {
        "id": 8,
        "task": 7,
        "task_title": "Add password reset",
        "status": "pending",
        "title": "Release #7 to main",
        "description": "Merge feature/7 at 3f9c2a1 into main, then request a staging deployment.",
        "branch": "feature/7",
        "head_sha": "3f9c2a1b7e",
        "pr_url": "https://github.com/acme/shop/pull/42",
    }

    def test_list_defaults_to_pending(self):
        self.api.on("GET", "/agents/approvals", (200, [self.PENDING]))
        code, output = self.run_cli("approvals", "list")
        self.assertEqual(code, 0, output)
        self.assertEqual(self.api.calls[0].url.params["status"], "pending")
        for text in ("feature/7", "3f9c2a1", "#7 Add password reset"):
            self.assertIn(text, output)

    def test_approve_asks_before_merging(self):
        self.api.on("GET", "/agents/approvals/8", (200, self.PENDING))
        self.api.on("POST", "/agents/approvals/8/approve", (202, {**self.PENDING, "status": "approved"}))

        code, output = self.run_cli("approvals", "approve", "8", input="n\n")
        self.assertEqual(code, 1)
        self.assertIn("Merge feature/7 at 3f9c2a1 into main", output)
        self.assertEqual(self.api.requests("POST", "/agents/approvals/8/approve"), [])

        code, output = self.run_cli("approvals", "approve", "8", "--reason", "Looks right", input="y\n")
        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.requests("POST", "/agents/approvals/8/approve")[0]), {"reason": "Looks right"})
        self.assertIn("Approved release #8", output)
        self.assertIn("teamflow agents watch --task 7", output)

    def test_only_pending_releases_can_be_approved(self):
        self.api.on("GET", "/agents/approvals/8", (200, {**self.PENDING, "status": "executed"}))
        code, output = self.run_cli("approvals", "approve", "8", "--yes")
        self.assertEqual(code, 1)
        self.assertIn("Approval #8 is executed, not pending.", output)
        self.assertEqual(self.api.requests("POST", "/agents/approvals/8/approve"), [])

    def test_reject_requires_a_reason(self):
        code, output = self.run_cli("approvals", "reject", "8", "--reason", "   ")
        self.assertEqual(code, 1)
        self.assertIn("A reason is required", output)
        self.assertEqual(self.api.calls, [])

    def test_reject_sends_the_reason(self):
        self.api.on("POST", "/agents/approvals/8/reject", (200, {**self.PENDING, "status": "rejected"}))
        code, output = self.run_cli("approvals", "reject", "8", "-r", "Missing tests")
        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.calls[0]), {"reason": "Missing tests"})
        self.assertIn("The ticket stays in QA.", output)


class DeploymentCommandTests(CommandTestCase):
    DEPLOYMENT = {"id": 31, "project": 12, "project_name": "Storefront", "environment": "production", "status": "queued", "branch": "main", "commit_sha": "3f9c2a1b7e", "started_at": "2026-09-26T14:10:00Z"}

    def test_production_deploys_need_confirmation(self):
        self.api.on("POST", "/deployments", (202, self.DEPLOYMENT))

        code, _ = self.run_cli("deployments", "create", "-p", "12", "--env", "production", input="n\n")
        self.assertEqual(code, 1)
        self.assertEqual(self.api.requests("POST", "/deployments"), [])

        code, output = self.run_cli("deployments", "create", "-p", "12", "--env", "production", "--yes")
        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.requests("POST", "/deployments")[0]), {"project": 12, "environment": "production"})
        self.assertIn("Requested deployment #31 to production.", output)

    def test_staging_is_the_default_and_needs_no_confirmation(self):
        self.api.on("POST", "/deployments", (202, {**self.DEPLOYMENT, "environment": "staging"}))
        code, output = self.run_cli("deployments", "create", "-p", "12", "-b", "release/1.2")
        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.calls[0]), {"project": 12, "environment": "staging", "branch": "release/1.2"})

    def test_rollback_confirms_what_it_redeploys(self):
        self.api.on("GET", "/deployments/31", (200, {**self.DEPLOYMENT, "status": "success"}))
        self.api.on("POST", "/deployments/31/rollback", (202, {**self.DEPLOYMENT, "id": 32}))

        code, output = self.run_cli("deployments", "rollback", "31", input="y\n")

        self.assertEqual(code, 0, output)
        self.assertIn("Redeploy 3f9c2a1 of Storefront to production?", output)
        self.assertIn("Requested rollback deployment #32.", output)

    def test_list_shows_short_commits(self):
        self.api.on("GET", "/deployments", (200, [self.DEPLOYMENT]))
        code, output = self.run_cli("deployments", "list", "-p", "12")
        self.assertEqual(code, 0, output)
        self.assertIn("3f9c2a1", output)
        self.assertNotIn("3f9c2a1b7e", output)
