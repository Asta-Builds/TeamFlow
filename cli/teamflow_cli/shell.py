"""Interactive mode: `teamflow` on its own opens a prompt that takes /commands.

Each slash command runs the matching `teamflow` command in this process, filling
in the selected project or ticket when the command needs one. With a ticket
selected, plain text is posted on it like a comment in the web app, and an
@mention of an agent also puts the swarm to work with the text as instruction.
"""

from __future__ import annotations

import os
import re
import shlex
import sys
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Optional

import typer
from prompt_toolkit import PromptSession
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from prompt_toolkit.completion import Completer, Completion
from prompt_toolkit.document import Document
from prompt_toolkit.history import FileHistory
from prompt_toolkit.styles import Style
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from . import __version__
from .client import TeamflowClient
from .config import normalize_url
from .errors import CliError, NotLoggedInError
from .hints import slash_hints
from .output import console, error_console, label, say
from .state import AppState

# The mentions that make the web app's comment box start the agents.
AGENT_MENTION = re.compile(r"@(pm|tech_lead|backend|frontend|qa|devops|designer|seo|all)\b", re.IGNORECASE)
TASK_STATUSES = ("todo", "in_progress", "in_review", "qa", "done")
APPROVAL_STATUSES = ("pending", "approved", "executed", "rejected", "superseded", "failed", "all")
ENVIRONMENTS = ("dev", "staging", "production")
EXIT_PRESS_WINDOW = 2.0  # Seconds within which a second Ctrl+C leaves the prompt.
SIGNED_OUT = "not logged in"

STYLE = Style.from_dict({"prompt": "ansimagenta bold", "bottom-toolbar": "noreverse ansibrightblack"})


@dataclass
class Focus:
    """The project and ticket that commands apply to when none is named."""

    project_id: Optional[int] = None
    project_name: str = ""
    task_id: Optional[int] = None
    task_title: str = ""

    def select_project(self, project: dict[str, Any]) -> None:
        if project.get("id") != self.project_id:
            self.task_id, self.task_title = None, ""
        self.project_id, self.project_name = project.get("id"), project.get("name") or ""

    def select_task(self, ticket: dict[str, Any]) -> None:
        self.task_id, self.task_title = ticket.get("id"), ticket.get("title") or ""
        if ticket.get("project") and ticket["project"] != self.project_id:
            self.project_id, self.project_name = ticket["project"], ticket.get("project_name") or ""


@dataclass(frozen=True)
class SlashCommand:
    name: str
    summary: str
    run: Callable[[Shell, str], None]
    usage: str = ""
    choices: tuple[str, ...] = ()  # Completions for the first argument.
    aliases: tuple[str, ...] = ()
    cli: tuple[str, ...] = ()  # The teamflow command it runs, whose help /help <name> shows.

    @property
    def signature(self) -> str:
        return f"/{self.name} {self.usage}".rstrip()


class Shell:
    def __init__(self, state: AppState, command: Any):
        self.state = state
        self.command = command  # The click command behind `teamflow`.
        self.server = state.resolve_url()
        self.focus = Focus()
        self.account: Optional[dict[str, Any]] = None
        self.account_problem = ""
        self.running = True
        self.failed = False

    def cli(self, *argv: str) -> tuple[bool, Any]:
        """Run a `teamflow` command in this process, against the shell's server.

        Commands that show or create one project or ticket return it; that is how
        the shell follows what later commands apply to.
        """
        try:
            result = self.command.main(
                args=["--url", self.server, *argv],
                prog_name="teamflow",
                standalone_mode=False,
                obj=self.state,
            )
        except typer.Abort:
            say("Cancelled.", "dim")
            result = 1
        except KeyboardInterrupt:
            result = 130
        except Exception as exc:
            # Click reports bad arguments with exceptions that can describe themselves.
            describe = getattr(exc, "format_message", None)
            if not callable(describe):
                raise
            error_console.print(Text(f"Error: {describe()}", style="red"), soft_wrap=True)
            result = 2
        if isinstance(result, int):  # An exit code: the command has already reported any problem.
            self.failed |= result != 0
            return result == 0, None
        return True, result

    def handle(self, line: str) -> None:
        """Run one line of input: a /command, or text for the selected ticket."""
        line = line.strip()
        if not line:
            return
        try:
            if line.startswith("/"):
                name, _, args = line[1:].partition(" ")
                command = find_command(name) if name else HELP
                if command is None:
                    raise CliError(f"Unknown command /{name}. Type /help to see the commands.")
                command.run(self, args.strip())
            else:
                _talk(self, line)
        except CliError as exc:
            self.failed = True
            say(exc.message, "yellow")

    def interact(self, session: Optional[PromptSession] = None) -> None:
        self.refresh_account()
        self.banner()
        session = session or self._session()
        last_interrupt = -EXIT_PRESS_WINDOW
        while self.running:
            try:
                line = session.prompt([("class:prompt", "> ")])
            except KeyboardInterrupt:
                now = time.monotonic()
                if now - last_interrupt < EXIT_PRESS_WINDOW:
                    break
                last_interrupt = now
                say("Press Ctrl+C again to exit, or type /exit.", "dim")
                continue
            except EOFError:
                break
            try:
                self.handle(line)
            except Exception as exc:  # A bug in one command must not end the session.
                error_console.print(Text(f"Unexpected error: {exc!r}", style="red"), soft_wrap=True)

    def run_lines(self, lines: Iterable[str]) -> None:
        """Run commands read from a file or pipe, echoing each one."""
        for line in lines:
            if not self.running:
                break
            if line.strip():
                say(f"> {line.strip()}", "dim")
                self.handle(line)

    def refresh_account(self) -> None:
        """Look up who is logged in, for the banner and the status bar."""
        self.account, self.account_problem = None, ""
        try:
            with TeamflowClient(self.server, self.state.store, transport=self.state.transport, timeout=5.0) as client:
                self.account = client.get("/auth/me")
        except NotLoggedInError:
            self.account_problem = SIGNED_OUT
        except CliError as exc:
            self.account_problem = exc.message

    def banner(self) -> None:
        body = Text()
        body.append("TeamFlow", style="bold magenta")
        body.append(f" {__version__}\n\n", style="dim")
        if self.account:
            body.append(self.account.get("name") or self.account.get("email") or "", style="bold")
            body.append(f" ({label(self.account.get('role'))})")
            if self.account.get("organization_name"):
                body.append(f" in {self.account['organization_name']}")
            body.append(f"\n{self.server}\n\n", style="dim")
        elif self.account_problem == SIGNED_OUT:
            body.append(f"Not logged in on {self.server}. Start with /login.\n\n", style="yellow")
        else:
            body.append(f"{self.account_problem}\nTo use another server: /login <url>\n\n", style="yellow")
        body.append(
            "Type / to see the commands. Pick a ticket with /task <id>, then write to\n"
            "comment on it; @mention an agent (like @backend or @all) to put it to work.",
            style="dim",
        )
        console.print(Panel(body, border_style="magenta", expand=False, padding=(1, 2)))

    def toolbar(self) -> list[tuple[str, str]]:
        if self.account:
            who = self.account.get("name") or self.account.get("email") or ""
            if self.account.get("organization_name"):
                who += f" · {self.account['organization_name']}"
        else:
            who = SIGNED_OUT if self.account_problem == SIGNED_OUT else "offline"
        project = f"{self.focus.project_name} #{self.focus.project_id}" if self.focus.project_id else "no project"
        ticket = f"#{self.focus.task_id} {_shorten(self.focus.task_title)}" if self.focus.task_id else "no ticket"
        return [("class:bottom-toolbar", f" {who} | {project} | {ticket} | {self.server} ")]

    def need_project(self) -> int:
        if self.focus.project_id is None:
            raise CliError("No project selected. Pick one with /project <id>; /projects lists them.")
        return self.focus.project_id

    def need_task(self) -> int:
        if self.focus.task_id is None:
            raise CliError("No ticket selected. Pick one with /task <id>; /tasks lists them.")
        return self.focus.task_id

    def ticket_and_text(self, args: str) -> tuple[int, str]:
        """A leading #57, or a lone 57, names the ticket; otherwise it is the selected one."""
        if re.fullmatch(r"#?\d+", args):
            return int(args.lstrip("#")), ""
        match = re.match(r"#(\d+)\s+(.*)", args, re.DOTALL)
        if match:
            return int(match[1]), match[2].strip()
        return self.need_task(), args

    def _session(self) -> PromptSession:
        directory = self.state.store.directory
        directory.mkdir(parents=True, exist_ok=True)
        return PromptSession(
            history=FileHistory(str(directory / "history")),
            completer=SlashCompleter(),
            complete_while_typing=True,
            auto_suggest=AutoSuggestFromHistory(),
            bottom_toolbar=self.toolbar,
            style=STYLE,
        )


def run_shell(state: AppState, command: Any) -> None:
    """Open the interactive prompt, or run commands from standard input when it is not a terminal."""
    shell = Shell(state, command)
    with slash_hints():
        if sys.stdin.isatty() and sys.stdout.isatty():
            shell.interact()
            return
        if os.environ.get("MSYSTEM"):
            # Git Bash's mintty is not a Windows console, so the prompt cannot draw there.
            error_console.print(
                Text("Reading commands from standard input. For the interactive prompt in Git Bash, run: winpty teamflow", style="dim"),
                soft_wrap=True,
            )
        shell.run_lines(sys.stdin)
    if shell.failed:
        raise typer.Exit(1)


class SlashCompleter(Completer):
    """Lists the commands as soon as a line starts with /, then the choices for their first argument."""

    def get_completions(self, document: Document, complete_event: Any) -> Iterable[Completion]:
        text = document.text_before_cursor
        if not text.startswith("/"):
            return
        name, space, rest = text[1:].partition(" ")
        if not space:
            for command in COMMANDS:
                if command.name.startswith(name.lower()):
                    yield Completion(
                        f"/{command.name}",
                        start_position=-len(text),
                        display=command.signature,
                        display_meta=command.summary,
                    )
            return
        command = find_command(name)
        if command is None or " " in rest:
            return
        for choice in command.choices:
            if choice.startswith(rest.lower()):
                yield Completion(choice, start_position=-len(rest))


def find_command(name: str) -> Optional[SlashCommand]:
    name = name.lower()
    return next((c for c in COMMANDS if name == c.name or name in c.aliases), None)


def _shorten(text: str, width: int = 40) -> str:
    return text if len(text) <= width else text[: width - 3] + "..."


def _split(args: str) -> list[str]:
    try:
        return shlex.split(args)
    except ValueError:  # An unmatched quote: fall back to plain words.
        return args.split()


def _id(text: str, what: str = "an id") -> int:
    match = re.fullmatch(r"#?(\d+)", text.strip())
    if not match:
        raise CliError(f"Expected {what} such as 57, got {text!r}.")
    return int(match[1])


def _leading_id(parts: list[str], fallback: Callable[[], int]) -> int:
    """Take an id from the front of the arguments, leaving any options behind it."""
    if parts and not parts[0].startswith("-"):
        return _id(parts.pop(0))
    return fallback()


def _talk(shell: Shell, text: str) -> None:
    """Plain text is a comment on the selected ticket; an @mention also puts the agents to work."""
    if shell.focus.task_id is None:
        raise CliError(
            "Pick a ticket with /task <id> first: text you type is posted on it, and an @mention "
            "(like @backend) puts the agents to work. Type / to see the commands."
        )
    task_id = str(shell.focus.task_id)
    ok, _ = shell.cli("tasks", "comment", task_id, "--", text)
    if ok and AGENT_MENTION.search(text):
        shell.cli("agents", "run", task_id, "--instruction", text)


def _help(shell: Shell, args: str) -> None:
    name = args.lstrip("/")
    if name:
        command = find_command(name)
        if command is None:
            raise CliError(f"Unknown command /{name}. Type /help to see the commands.")
        say(command.signature, "bold")
        say(command.summary)
        if command.cli:
            say(f"It runs `teamflow {' '.join(command.cli)}`:", "dim")
            shell.cli(*command.cli, "--help")
        return
    grid = Table.grid(padding=(0, 3))
    for command in COMMANDS:
        grid.add_row(Text(command.signature, style="bold"), command.summary)
    console.print(grid)
    say(
        "\nWith a ticket selected, plain text is posted on it as a comment. Mention an agent "
        "(@pm, @tech_lead, @backend, @frontend, @qa, @devops, @designer, @seo or @all) to put "
        "the swarm to work on it. List commands also take their CLI options, as in /tasks --priority urgent.",
        "dim",
    )


def _login(shell: Shell, args: str) -> None:
    parts = _split(args)
    ok, _ = shell.cli("login", *parts)
    if ok:
        if parts and not parts[0].startswith("-"):
            shell.server = normalize_url(parts[0])
        shell.focus = Focus()
        shell.refresh_account()


def _logout(shell: Shell, args: str) -> None:
    ok, _ = shell.cli("logout")
    if ok:
        shell.focus = Focus()
        shell.refresh_account()


def _whoami(shell: Shell, args: str) -> None:
    shell.cli("whoami", *_split(args))


def _projects(shell: Shell, args: str) -> None:
    shell.cli("projects", "list", *_split(args))


def _project(shell: Shell, args: str) -> None:
    parts = _split(args)
    project_id = _leading_id(parts, shell.need_project)
    ok, project = shell.cli("projects", "show", str(project_id), *parts)
    if ok and isinstance(project, dict):
        shell.focus.select_project(project)


def _tasks(shell: Shell, args: str) -> None:
    parts = _split(args)
    argv = ["tasks", "list"]
    if parts and parts[0].lower() in TASK_STATUSES:
        argv += ["--status", parts.pop(0).lower()]
    if shell.focus.project_id is not None and not {"-p", "--project"} & set(parts):
        argv += ["--project", str(shell.focus.project_id)]
    shell.cli(*argv, *parts)


def _task(shell: Shell, args: str) -> None:
    parts = _split(args)
    task_id = _leading_id(parts, shell.need_task)
    ok, ticket = shell.cli("tasks", "show", str(task_id), *parts)
    if ok and isinstance(ticket, dict):
        shell.focus.select_task(ticket)


def _new(shell: Shell, args: str) -> None:
    if not args:
        raise CliError("Give the ticket a title: /new <title>")
    ok, ticket = shell.cli("tasks", "create", "--project", str(shell.need_project()), "--", args)
    if ok and isinstance(ticket, dict):
        shell.focus.select_task(ticket)


def _move(shell: Shell, args: str) -> None:
    parts = args.split()
    if len(parts) == 1:
        task_id, column = shell.need_task(), parts[0]
    elif len(parts) == 2:
        task_id, column = _id(parts[0]), parts[1]
    else:
        raise CliError(f"Usage: /move [#id] <status>, where status is one of {', '.join(TASK_STATUSES)}.")
    shell.cli("tasks", "move", str(task_id), column)


def _comment(shell: Shell, args: str) -> None:
    if not args:
        raise CliError("Write the comment after the command: /comment <text>")
    shell.cli("tasks", "comment", str(shell.need_task()), "--", args)


def _run(shell: Shell, args: str) -> None:
    task_id, instruction = shell.ticket_and_text(args)
    argv = ["agents", "run", str(task_id)]
    if instruction:
        argv += ["--instruction", instruction]
    shell.cli(*argv)


def _watch(shell: Shell, args: str) -> None:
    if re.fullmatch(r"#?\d+", args):
        scope = ["--task", args.lstrip("#")]
    elif args:
        scope = ["--session", args]
    elif shell.focus.task_id is not None:
        scope = ["--task", str(shell.focus.task_id)]
    elif shell.focus.project_id is not None:
        scope = ["--project", str(shell.focus.project_id)]
    else:
        scope = []
    shell.cli("agents", "watch", *scope)


def _traces(shell: Shell, args: str) -> None:
    scope = ["--task", str(shell.focus.task_id)] if shell.focus.task_id is not None else []
    shell.cli("agents", "traces", *scope, *_split(args))


def _status(shell: Shell, args: str) -> None:
    shell.cli("agents", "status", *_split(args))


def _approvals(shell: Shell, args: str) -> None:
    parts = _split(args)
    argv = ["approvals", "list"]
    if parts and parts[0].lower() in APPROVAL_STATUSES:
        argv += ["--status", parts.pop(0).lower()]
    shell.cli(*argv, *parts)


def _decide(decision: str) -> Callable[[Shell, str], None]:
    def run(shell: Shell, args: str) -> None:
        match = re.fullmatch(r"#?(\d+)(?:\s+(.*))?", args, re.DOTALL)
        if not match:
            raise CliError(f"Usage: /{decision} <approval id> [{'note' if decision == 'approve' else 'reason'}]")
        argv = ["approvals", decision, match[1]]
        if match[2]:
            argv += ["--reason", match[2].strip()]
        shell.cli(*argv)  # Rejecting without a reason asks for one.

    return run


def _deployments(shell: Shell, args: str) -> None:
    parts = _split(args)
    if shell.focus.project_id is not None and not {"-p", "--project"} & set(parts):
        parts = ["--project", str(shell.focus.project_id), *parts]
    shell.cli("deployments", "list", *parts)


def _deploy(shell: Shell, args: str) -> None:
    parts = _split(args)
    environment = parts.pop(0) if parts and not parts[0].startswith("-") else "staging"
    shell.cli("deployments", "create", "--project", str(shell.need_project()), "--env", environment, *parts)


def _rollback(shell: Shell, args: str) -> None:
    parts = _split(args)
    if not parts:
        raise CliError("Usage: /rollback <deployment id>")
    shell.cli("deployments", "rollback", str(_id(parts[0], "a deployment id")), *parts[1:])


def _clear(shell: Shell, args: str) -> None:
    console.clear()


def _exit(shell: Shell, args: str) -> None:
    shell.running = False


HELP = SlashCommand("help", "Show the commands, or one command's options", _help, "[command]")
COMMANDS = (
    HELP,
    SlashCommand("login", "Log in to a TeamFlow server", _login, "[url]", cli=("login",)),
    SlashCommand("logout", "Log out and end the session on the server", _logout, cli=("logout",)),
    SlashCommand("whoami", "Show your account and workspace", _whoami, cli=("whoami",)),
    SlashCommand("projects", "List projects", _projects, cli=("projects", "list")),
    SlashCommand("project", "Select a project and show it", _project, "[id]", cli=("projects", "show")),
    SlashCommand(
        "tasks", "List the tickets of the selected project", _tasks, "[status]",
        choices=TASK_STATUSES, cli=("tasks", "list"),
    ),
    SlashCommand("task", "Select a ticket and show it", _task, "[id]", cli=("tasks", "show")),
    SlashCommand("new", "Create a ticket in the selected project", _new, "<title>", cli=("tasks", "create")),
    SlashCommand(
        "move", "Move the ticket to another board column", _move, "[#id] <status>",
        choices=TASK_STATUSES, cli=("tasks", "move"),
    ),
    SlashCommand("comment", "Comment on the ticket", _comment, "<text>", cli=("tasks", "comment")),
    SlashCommand(
        "run", "Put the agent swarm on the ticket and follow it live", _run, "[#id] [instruction]",
        cli=("agents", "run"),
    ),
    SlashCommand(
        "watch", "Follow agent activity live (Ctrl+C stops)", _watch, "[#id | session]", cli=("agents", "watch")
    ),
    SlashCommand("traces", "List recent agent runs", _traces, cli=("agents", "traces")),
    SlashCommand("status", "Check the agent runtime and seats", _status, cli=("agents", "status")),
    SlashCommand(
        "approvals", "List releases waiting for approval", _approvals, "[status]",
        choices=APPROVAL_STATUSES, cli=("approvals", "list"),
    ),
    SlashCommand(
        "approve", "Approve a release: merge it, then deploy to staging", _decide("approve"), "<id> [note]",
        cli=("approvals", "approve"),
    ),
    SlashCommand("reject", "Reject a release", _decide("reject"), "<id> <reason>", cli=("approvals", "reject")),
    SlashCommand(
        "deployments", "List the deployments of the selected project", _deployments, cli=("deployments", "list")
    ),
    SlashCommand(
        "deploy", "Deploy the selected project", _deploy, "[env]", choices=ENVIRONMENTS, cli=("deployments", "create")
    ),
    SlashCommand("rollback", "Redeploy an earlier deployment", _rollback, "<id>", cli=("deployments", "rollback")),
    SlashCommand("clear", "Clear the screen", _clear),
    SlashCommand("exit", "Leave TeamFlow", _exit, aliases=("quit",)),
)
