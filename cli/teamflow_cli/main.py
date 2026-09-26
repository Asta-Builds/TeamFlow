"""The `teamflow` command."""

from __future__ import annotations

import contextlib
import io
import sys
from typing import Annotated, Any, Optional

import typer
from rich.text import Text
from typer.core import TyperGroup

from . import __version__
from .commands import agents, approvals, deployments, projects, tasks
from .config import Session
from .errors import CliError, NotLoggedInError
from .output import console, details, error_console, label, print_json, say
from .state import JsonFlag, get_state


class _Group(TyperGroup):
    """Shows a CliError from any command as one line instead of a traceback."""

    def invoke(self, ctx: typer.Context) -> Any:
        try:
            return super().invoke(ctx)
        except CliError as exc:
            error_console.print(Text.assemble(("Error: ", "bold red"), exc.message), soft_wrap=True)
            raise typer.Exit(exc.exit_code) from None


app = typer.Typer(
    cls=_Group,
    name="teamflow",
    help=(
        "Run TeamFlow from the terminal: projects, tickets, the agent swarm, releases and deployments. "
        "Without a command, opens an interactive prompt that takes /commands."
    ),
    pretty_exceptions_show_locals=False,  # Locals would include access tokens.
)
app.add_typer(projects.app, name="projects")
app.add_typer(tasks.app, name="tasks")
app.add_typer(agents.app, name="agents")
app.add_typer(approvals.app, name="approvals")
app.add_typer(deployments.app, name="deployments")


def _show_version(value: bool) -> None:
    if value:
        typer.echo(f"teamflow {__version__}")
        raise typer.Exit()


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    url: Annotated[
        Optional[str],
        typer.Option(
            "--url",
            envvar="TEAMFLOW_URL",
            help="TeamFlow server, such as https://teamflow.example.com. Defaults to the server you last logged in to.",
            show_default=False,
        ),
    ] = None,
    version: Annotated[
        Optional[bool],
        typer.Option("--version", callback=_show_version, is_eager=True, help="Show the version and exit."),
    ] = None,
) -> None:
    state = get_state(ctx)
    if url is not None:
        state.url_override = url
    if ctx.invoked_subcommand is None:
        # Imported here so that the other commands do not load prompt_toolkit.
        from .shell import run_shell

        run_shell(state, typer.main.get_command(app))


@app.command()
def login(
    ctx: typer.Context,
    server: Annotated[
        Optional[str],
        typer.Argument(
            help="Server URL. Defaults to --url, TEAMFLOW_URL, the last server, or http://localhost:8001.",
            show_default=False,
        ),
    ] = None,
    email: Annotated[Optional[str], typer.Option("--email", "-e", help="Account email.")] = None,
    password_stdin: Annotated[
        bool, typer.Option("--password-stdin", help="Read the password from the next line of standard input.")
    ] = False,
) -> None:
    """Log in with your TeamFlow email and password."""
    state = get_state(ctx)
    url = state.resolve_url(server)
    email = (email or typer.prompt("Email")).strip()
    if password_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
    elif sys.stdin.isatty():
        password = typer.prompt("Password", hide_input=True)
    else:
        # A hidden prompt reads the console itself, so it would wait forever on piped input.
        typer.echo("Password: ", nl=False, err=True)
        password = sys.stdin.readline().rstrip("\r\n")
    if not password:
        raise CliError("No password was given.")

    with state.client(url) as client:
        data = client.post("/auth/login", json={"email": email, "password": password}, auth=False)
        user = data.get("user") or {}
        previous = state.store.session(url)
        state.store.save_session(
            url,
            Session(access=data["access"], refresh=data["refresh"], email=user.get("email") or email),
            make_current=True,
        )
        if previous is not None:
            # End the session this login replaces; it would otherwise stay valid for a week.
            with contextlib.suppress(CliError):
                client.revoke(previous)

    workspace = user.get("organization_name") or "no workspace"
    say(f"Logged in to {url} as {user.get('name') or email} ({label(user.get('role'))}, {workspace}).")


@app.command()
def logout(ctx: typer.Context) -> None:
    """Log out and end the session on the server."""
    state = get_state(ctx)
    url = state.resolve_url()
    session = state.store.session(url)
    if session is None:
        say(f"You are not logged in on {url}.")
        return

    problem = ""
    with state.client(url) as client:
        try:
            if not client.revoke(session):
                # An expired access token cannot end the session, so renew it once first.
                client.refresh_session(session.access)
                renewed = state.store.session(url)
                if renewed is None or not client.revoke(renewed):
                    problem = "the server refused to end the session"
        except NotLoggedInError:
            pass  # The server had already ended the session.
        except CliError as exc:
            problem = exc.message
    state.store.clear_session(url)
    say(f"Logged out of {url}.")
    if problem:
        say(f"The session was removed here, but {problem}. It expires on its own within a week.", "yellow")


@app.command()
def whoami(ctx: typer.Context, as_json: JsonFlag = False) -> None:
    """Show who you are logged in as, and in which workspace."""
    with get_state(ctx).client() as client:
        user = client.get("/auth/me")
        server = client.url
    if as_json:
        print_json(user)
        return
    workspace = user.get("organization_name")
    tier = user.get("organization_tier")
    console.print(
        details(
            [
                ("Server", server),
                ("Name", user.get("name")),
                ("Email", user.get("email")),
                ("Role", label(user.get("role"))),
                ("Workspace", f"{workspace} ({tier})" if workspace and tier else workspace),
            ]
        )
    )


def run() -> None:
    """Console-script entry point."""
    for stream in (sys.stdout, sys.stderr):
        # Agent messages can hold characters that a redirected Windows console cannot encode.
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(errors="replace")
    app()
