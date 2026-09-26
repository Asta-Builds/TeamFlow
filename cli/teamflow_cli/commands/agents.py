"""teamflow agents: put the swarm on a ticket and follow its work live."""

from __future__ import annotations

import contextlib
from typing import Annotated, Any, Optional

import typer
from rich.text import Text

from ..client import TeamflowClient
from ..errors import CliError, UsageError
from ..events import EventFeed, RunOutcome, approval_request, latest_event_id, watch_run
from ..hints import suggest
from ..output import (
    EventPrinter,
    as_list,
    console,
    details,
    duration,
    field,
    label,
    print_json,
    say,
    status,
    table,
    timestamp,
)
from ..state import JsonFlag, get_state

app = typer.Typer(help="Run the agent swarm and follow its work live.", no_args_is_help=True)

HEALTH_STYLES = {"ready": "green", "offline": "red"}


@app.command("run")
def run_agents(
    ctx: typer.Context,
    task_id: Annotated[int, typer.Argument(help="Ticket for the agents to work on.")],
    chain: Annotated[
        bool, typer.Option("--chain", help="Run the sequential swarm chain instead of the planning graph.")
    ] = False,
    instruction: Annotated[
        Optional[str],
        typer.Option("--instruction", "-m", help="Instruction for the swarm chain. Implies --chain."),
    ] = None,
    watch: Annotated[bool, typer.Option("--watch/--no-watch", help="Follow the run until it ends.")] = True,
) -> None:
    """Queue the agent swarm on a ticket and follow it live."""
    use_chain = chain or instruction is not None
    with get_state(ctx).client() as client:
        if use_chain:
            result = client.post(f"/agents/swarm-chain/{task_id}", json={"instruction": instruction or ""})
        else:
            result = client.post(f"/agents/dispatch/{task_id}")
        session_id = ((result or {}).get("trace") or {}).get("session_id")
        if not session_id:
            raise CliError(
                "The run was queued, but the server did not return its session. "
                f"Check it with: {suggest(f'agents traces --task {task_id}', '/traces')}"
            )
        say(f"Queued the {'swarm chain' if use_chain else 'agent swarm'} on task #{task_id} (session {session_id}).")
        if not watch:
            say(f"Follow it with: {_watch_hint(session_id)}", "dim")
            return
        _watch_session(client, session_id, task_id=task_id)


@app.command("watch")
def watch_events(
    ctx: typer.Context,
    session: Annotated[Optional[str], typer.Option("--session", "-s", help="Follow one run until it ends.")] = None,
    task: Annotated[Optional[int], typer.Option("--task", "-t", help="Follow the agents on one ticket.")] = None,
    project: Annotated[Optional[int], typer.Option("--project", "-p", help="Follow the agents on one project.")] = None,
    history: Annotated[
        int, typer.Option("--history", "-n", help="With --task: how many earlier events to show first.")
    ] = 10,
) -> None:
    """Follow agent events live: one run, a ticket, a project, or the whole workspace."""
    if session and (task or project):
        raise UsageError("--session cannot be combined with --task or --project.")
    with get_state(ctx).client() as client:
        if session:
            _watch_session(client, session)
            return

        printer = EventPrinter()
        feed = EventFeed(client, task=task, project=project)
        if task:
            earlier = feed.history()
            shown = earlier[-history:] if history > 0 else []
            for event in earlier[: len(earlier) - len(shown)]:
                printer.learn(event)
            for event in shown:
                printer(event)
        else:
            feed.after = latest_event_id(client)
        scope = f"task #{task}" if task else f"project #{project}" if project else "the workspace"
        say(f"Following agent activity in {scope}. Press Ctrl+C to stop.", "dim")
        with contextlib.suppress(KeyboardInterrupt), contextlib.closing(feed.follow(printer.retrying)) as events:
            for event in events:
                if event is not None:
                    printer(event)


@app.command("status")
def runtime_status(ctx: typer.Context, as_json: JsonFlag = False) -> None:
    """Check the agent runtime: model, workers, event bus and agent seats."""
    with get_state(ctx).client() as client:
        data = client.get("/agents/status")
    if as_json:
        print_json(data)
        return

    def health(value: Optional[str]) -> Text:
        return Text(value or "unknown", style=HEALTH_STYLES.get(value or "", "yellow"))

    console.print(
        details(
            [
                ("Orchestration", data.get("orchestration_framework")),
                ("Model", health(data.get("model_engine_status"))),
                ("Workers", health(data.get("worker_queue_status"))),
                ("Event bus", health(data.get("event_bus_status"))),
                ("Vector store", f"{data.get('vector_store')} ({data.get('rag_embeddings_count', 0)} embeddings)"),
                ("Observability", data.get("observability")),
                ("Runs", f"{data.get('successful_swarms', 0)} of {data.get('total_swarms_executed', 0)} completed"),
            ]
        )
    )
    seats = data.get("active_agents") or []
    if seats:
        grid = table("Seat", "Name", "Title", "Status")
        for seat in seats:
            grid.add_row(seat.get("key") or "", seat.get("name") or "", seat.get("title") or "", label(seat.get("status")))
        console.print(grid)


@app.command("traces")
def list_traces(
    ctx: typer.Context,
    task: Annotated[Optional[int], typer.Option("--task", "-t", help="Only runs on this ticket.")] = None,
    as_json: JsonFlag = False,
) -> None:
    """List recent agent runs."""
    with get_state(ctx).client() as client:
        runs = as_list(client.get(f"/agents/traces/{task}" if task else "/agents/traces"))
    if as_json:
        print_json(runs)
        return
    if not runs:
        say("No agent runs yet.")
        return
    grid = table("Run", "Task", "Session", "Status", "Started", "Duration", "Tokens")
    for run in runs:
        grid.add_row(
            str(run.get("id")),
            f"#{run.get('task')} {run.get('task_title') or ''}".strip(),
            run.get("session_id") or "",
            status(run.get("status")),
            timestamp(run.get("created_at")),
            duration(run.get("duration_seconds")),
            f"{run.get('tokens_used') or 0:,}",
        )
    console.print(grid)


def _watch_session(client: TeamflowClient, session_id: str, *, task_id: Optional[int] = None) -> None:
    printer = EventPrinter()
    blocks: list[str] = []  # What agents reported as blocking them, apart from the release gate.

    def show(event: dict[str, Any]) -> None:
        printer(event)
        if event.get("event_type") == "blocked" and approval_request(event) is None:
            blocks.append((event.get("message") or event.get("current_work") or "").strip())

    say("Following the run. Ctrl+C stops watching, not the run.", "dim")
    try:
        outcome = watch_run(client, session_id, show=show, task_id=task_id, on_retry=printer.retrying)
    except KeyboardInterrupt:
        say(f"Stopped watching. The run goes on; resume with: {_watch_hint(session_id)}", "yellow")
        raise typer.Exit(130) from None
    _report(client, outcome, blocks)
    if not outcome.ok:
        raise typer.Exit(1)


def _watch_hint(session_id: str) -> str:
    return suggest(f"agents watch --session {session_id}", f"/watch {session_id}")


def _report(client: TeamflowClient, outcome: RunOutcome, blocks: list[str]) -> None:
    trace = outcome.trace
    approval = outcome.approval or {}
    facts = [
        duration(trace.get("duration_seconds")) if trace.get("duration_seconds") else "",
        f"{trace['tokens_used']:,} tokens" if trace.get("tokens_used") else "",
        _cost(trace.get("cost_usd")),
    ]
    summary = ", ".join(fact for fact in facts if fact)
    suffix = f" ({summary})" if summary else ""

    if outcome.state == "completed" and blocks:
        # The server records such runs as completed, so say plainly that work was held up.
        more = f" (and {len(blocks) - 1} more)" if len(blocks) > 1 else ""
        say(f"Run finished{suffix}, but an agent was blocked: {blocks[-1]}{more}", "yellow")
    elif outcome.state == "completed":
        say(f"Run finished{suffix}.", "green")
    elif outcome.state == "release_failed":
        say(f"Run finished{suffix}, but the release was not merged. See the events above.", "red")
    elif outcome.state == "failed":
        error = (trace.get("graph_state") or {}).get("error")
        say(f"Run failed{suffix}: {error}" if error else f"Run failed{suffix}.", "red")
    elif outcome.state == "awaiting_approval":
        say(f"Run finished{suffix}. The release now waits for a workspace owner or admin.", "yellow")
        approval_id = approval.get("id")
        if approval_id:
            say(f"  Approve: {suggest(f'approvals approve {approval_id}', f'/approve {approval_id}')}")
            say(f"  Reject:  {suggest(f'approvals reject {approval_id} --reason ...', f'/reject {approval_id} <reason>')}")
    elif outcome.state == "rejected":
        reason = approval.get("decision_reason")
        say(f"Release #{approval.get('id')} was rejected" + (f": {reason}" if reason else "."), "red")
    else:
        say(f"Release #{approval.get('id')} was superseded by a newer run.", "yellow")

    ticket = _ticket(client, trace.get("task"))
    if ticket:
        line = Text(f"#{ticket['id']} {ticket.get('title') or ''}  ")
        line.append_text(status(ticket.get("status")))
        field("Ticket", line)
    field("Pull request", (ticket or {}).get("pr_url") or (trace.get("graph_state") or {}).get("pr_url"))
    field("Trace", trace.get("langfuse_url"))


def _ticket(client: TeamflowClient, task_id: Any) -> Optional[dict[str, Any]]:
    if not isinstance(task_id, int):
        return None
    try:
        return client.get(f"/tasks/{task_id}")
    except CliError:
        return None  # The summary is still useful without the ticket.


def _cost(value: Any) -> str:
    try:
        cost = float(value)
    except (TypeError, ValueError):
        return ""
    return f"${cost:.2f}" if cost > 0 else ""
