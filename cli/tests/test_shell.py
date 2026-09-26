import contextlib
import io
import unittest

import typer
from prompt_toolkit import PromptSession
from prompt_toolkit.document import Document
from prompt_toolkit.input import create_pipe_input
from prompt_toolkit.output import DummyOutput

from teamflow_cli.hints import slash_hints, suggest
from teamflow_cli.main import app
from teamflow_cli.shell import Shell, SlashCompleter
from teamflow_cli.state import AppState

from .support import (
    TICKET,
    URL,
    USER,
    AgentTestCase,
    body,
    event,
    plain,
    temp_store,
    trace,
)


class ShellTests(AgentTestCase):
    """The shell reads commands from standard input when it is not a terminal, as in these tests."""

    def shell(self, *lines):
        return self.run_cli(input="".join(f"{line}\n" for line in lines))

    def select_ticket(self):
        self.api.on("GET", "/tasks/7", (200, TICKET))
        return "/task 7"

    def test_help_lists_the_commands(self):
        code, output = self.shell("/help")
        self.assertEqual(code, 0, output)
        for text in ("/tasks [status]", "/run [#id] [instruction]", "/approve <id> [note]", "Mention an agent"):
            self.assertIn(text, output)

    def test_a_lone_slash_shows_the_commands_too(self):
        code, output = self.shell("/")
        self.assertEqual(code, 0, output)
        self.assertIn("/watch [#id | session]", output)

    def test_help_for_one_command_shows_its_options(self):
        code, output = self.shell("/help tasks")
        self.assertEqual(code, 0, output)
        self.assertIn("It runs `teamflow tasks list`", output)
        self.assertIn("--priority", output)

    def test_unknown_commands_are_reported_and_fail_the_script(self):
        code, output = self.shell("/frobnicate")
        self.assertEqual(code, 1)
        self.assertIn("Unknown command /frobnicate. Type /help", output)

    def test_selecting_a_project_scopes_the_ticket_list(self):
        self.api.on("GET", "/projects/12", (200, {"id": 12, "name": "Storefront"}))
        self.api.on("GET", "/tasks", (200, []))

        code, output = self.shell("/project 12", "/tasks qa")

        self.assertEqual(code, 0, output)
        params = self.api.requests("GET", "/tasks")[-1].url.params
        self.assertEqual((params["project"], params["status"]), ("12", "qa"))
        self.assertIn("Tickets: /tasks", output)

    def test_list_commands_take_their_cli_options(self):
        self.api.on("GET", "/tasks", (200, []))
        code, output = self.shell("/tasks --priority urgent")
        self.assertEqual(code, 0, output)
        self.assertEqual(self.api.requests("GET", "/tasks")[0].url.params["priority"], "urgent")

    def test_run_works_on_the_selected_ticket(self):
        self.api.events = [event(1, kind="completed")]
        self.api.on("GET", "/agents/traces/7", (200, [trace("completed")]))

        code, output = self.shell(self.select_ticket(), "/run")

        self.assertEqual(code, 0, output)
        self.assertEqual(len(self.api.requests("POST", "/agents/dispatch/7")), 1)
        self.assertIn("Run finished.", output)

    def test_run_with_an_instruction_starts_the_swarm_chain(self):
        self.api.on("POST", "/agents/swarm-chain/9", (202, {"trace": trace("running")}))
        self.api.events = [event(1, kind="completed", task=9)]
        self.api.on("GET", "/agents/traces/9", (200, [trace("completed")]))

        code, output = self.shell("/run #9 Use argon2 for hashing")

        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.requests("POST", "/agents/swarm-chain/9")[0]), {"instruction": "Use argon2 for hashing"})

    def test_ticket_commands_need_a_ticket(self):
        code, output = self.shell("/run", "/move qa", "/comment hi")
        self.assertEqual(code, 1)
        self.assertEqual(output.count("No ticket selected. Pick one with /task <id>"), 3)
        self.assertEqual(self.api.calls, [])

    def test_plain_text_comments_and_a_mention_puts_the_agents_to_work(self):
        self.api.on("POST", "/tasks/7/comments", (201, {"id": 1}))
        self.api.on("POST", "/agents/swarm-chain/7", (202, {"trace": trace("running")}))
        self.api.events = [event(1, kind="completed")]
        self.api.on("GET", "/agents/traces/7", (200, [trace("completed")]))

        code, output = self.shell(self.select_ticket(), "Looks right to me", "@backend add rate limiting to the reset endpoint")

        self.assertEqual(code, 0, output)
        comments = [body(r)["body"] for r in self.api.requests("POST", "/tasks/7/comments")]
        self.assertEqual(comments, ["Looks right to me", "@backend add rate limiting to the reset endpoint"])
        chain = self.api.requests("POST", "/agents/swarm-chain/7")
        self.assertEqual([body(r)["instruction"] for r in chain], ["@backend add rate limiting to the reset endpoint"])

    def test_plain_text_without_a_ticket_explains_what_to_do(self):
        code, output = self.shell("hello there")
        self.assertEqual(code, 1)
        self.assertIn("Pick a ticket with /task <id> first", output)
        self.assertEqual(self.api.calls, [])

    def test_new_tickets_go_to_the_selected_project_and_become_selected(self):
        self.api.on("GET", "/projects/12", (200, {"id": 12, "name": "Storefront"}))
        self.api.on("GET", "/tasks", (200, []))
        self.api.on("POST", "/tasks", (201, {**TICKET, "id": 58, "title": "-v flag for exports"}))
        self.api.on("PATCH", "/tasks/58", (200, {"id": 58, "status": "in_progress"}))

        code, output = self.shell("/project 12", "/new -v flag for exports", "/move in_progress")

        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.requests("POST", "/tasks")[0]), {"project": 12, "title": "-v flag for exports"})
        self.assertEqual(body(self.api.requests("PATCH", "/tasks/58")[0]), {"status": "in_progress"})
        self.assertIn("Put the agents on it: /run", output)

    def test_errors_do_not_end_the_session(self):
        self.api.on("GET", "/tasks/404", (404, {"message": "Task with ID 404 not found"}))
        self.api.on("GET", "/projects", (200, []))

        code, output = self.shell("/task 404", "/projects")

        self.assertEqual(code, 1)
        self.assertIn("Error: Task with ID 404 not found (HTTP 404)", output)
        self.assertIn("No projects found.", output)

    def test_a_declined_confirmation_is_cancelled_quietly(self):
        self.api.on("GET", "/agents/approvals/8", (200, {"id": 8, "task": 7, "status": "pending", "title": "Release #7 to main"}))
        code, output = self.shell("/approve 8", "n")
        self.assertEqual(code, 1)
        self.assertIn("Cancelled.", output)
        self.assertEqual(self.api.requests("POST", "/agents/approvals/8/approve"), [])

    def test_exit_stops_reading(self):
        code, output = self.shell("/exit", "/projects")
        self.assertEqual(code, 0, output)
        self.assertEqual(self.api.calls, [])

    def test_login_in_the_shell_switches_server(self):
        self.api.on("POST", "/auth/login", (200, {"access": "a1", "refresh": "r1", "user": USER}))
        self.api.on("GET", "/auth/me", (200, USER))

        code, output = self.shell("/login https://tf.example.com", "ada@example.com", "s3cret", "/whoami")

        self.assertEqual(code, 0, output)
        self.assertEqual(self.api.requests("GET", "/auth/me")[-1].url.host, "tf.example.com")

    def test_password_stdin_takes_one_line_and_leaves_the_rest_of_the_script(self):
        self.api.on("POST", "/auth/login", (200, {"access": "a1", "refresh": "r1", "user": USER}))
        self.api.on("GET", "/auth/me", (200, USER))

        code, output = self.shell("/login -e ada@example.com --password-stdin", "s3cret", "/whoami")

        self.assertEqual(code, 0, output)
        self.assertEqual(body(self.api.requests("POST", "/auth/login")[0])["password"], "s3cret")
        self.assertIn("ada@example.com", output.split("> /whoami", 1)[1])

    def test_hints_name_slash_commands_only_inside_the_shell(self):
        self.store = temp_store(self)
        code, output = self.shell("/projects")
        self.assertIn(f"Run: /login {URL}", output)
        self.assertEqual(suggest("login", "/login"), "teamflow login")


class CompleterTests(unittest.TestCase):
    def complete(self, text):
        return [c.text for c in SlashCompleter().get_completions(Document(text), None)]

    def test_a_slash_offers_every_command(self):
        found = self.complete("/")
        self.assertIn("/run", found)
        self.assertIn("/exit", found)

    def test_command_names_complete_by_prefix(self):
        self.assertEqual(self.complete("/ta"), ["/tasks", "/task"])

    def test_first_arguments_complete_from_their_choices(self):
        self.assertEqual(self.complete("/move q"), ["qa"])
        self.assertEqual(self.complete("/deploy p"), ["production"])
        self.assertEqual(self.complete("/move qa x"), [])

    def test_plain_text_gets_no_completions(self):
        self.assertEqual(self.complete("hello /ta"), [])


class InteractivePromptTests(AgentTestCase):
    def test_banner_command_and_double_ctrl_c(self):
        self.api.on("GET", "/auth/me", (200, USER))
        shell = Shell(AppState(store=self.store, transport=self.api.transport), typer.main.get_command(app))
        output = io.StringIO()

        with create_pipe_input() as keys, slash_hints(), contextlib.redirect_stdout(output):
            keys.send_text("/whoami\r\x03\x03")
            shell.interact(PromptSession(input=keys, output=DummyOutput()))

        text = plain(output.getvalue())
        self.assertIn("Ada (ceo) in Acme", text)
        self.assertIn("Press Ctrl+C again to exit", text)
        self.assertEqual(len(self.api.requests("GET", "/auth/me")), 2)
