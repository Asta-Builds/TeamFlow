"""teamflow tasks: the board's tickets."""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Optional

import typer
from rich.text import Text

from ..errors import UsageError
from ..hints import suggest
from ..output import (
    as_list,
    console,
    details,
    label,
    person,
    print_json,
    priority,
    say,
    status,
    table,
    timestamp,
)
from ..state import JsonFlag, compact, get_state

app = typer.Typer(help="List, inspect, create and move tickets.", no_args_is_help=True)


class TaskStatus(str, Enum):
    todo = "todo"
    in_progress = "in_progress"
    in_review = "in_review"
    qa = "qa"
    done = "done"


class TaskType(str, Enum):
    feature = "feature"
    bug = "bug"
    task = "task"


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"


def _value(choice: Optional[Enum]) -> Optional[str]:
    return choice.value if choice is not None else None


def _percent(value: Any) -> Optional[str]:
    # Prisma serializes decimals as strings.
    try:
        return f"{float(value):.0f}% compliant"
    except (TypeError, ValueError):
        return None


@app.command("list")
def list_tasks(
    ctx: typer.Context,
    project: Annotated[Optional[int], typer.Option("--project", "-p", help="Project ID.")] = None,
    status_filter: Annotated[
        Optional[TaskStatus], typer.Option("--status", "-s", help="Board column.", case_sensitive=False)
    ] = None,
    priority_filter: Annotated[
        Optional[Priority], typer.Option("--priority", help="Priority.", case_sensitive=False)
    ] = None,
    task_type: Annotated[
        Optional[TaskType], typer.Option("--type", help="Ticket type.", case_sensitive=False)
    ] = None,
    assignee: Annotated[Optional[int], typer.Option("--assignee", help="Assignee user ID.")] = None,
    mine: Annotated[bool, typer.Option("--mine", help="Only tickets assigned to you.")] = False,
    search: Annotated[Optional[str], typer.Option("--search", "-q", help="Match the title or description.")] = None,
    as_json: JsonFlag = False,
) -> None:
    """List tickets, optionally filtered."""
    if mine and assignee is not None:
        raise UsageError("Use either --mine or --assignee, not both.")
    with get_state(ctx).client() as client:
        if mine:
            assignee = client.get("/auth/me")["id"]
        params = compact(
            {
                "project": project,
                "status": _value(status_filter),
                "priority": _value(priority_filter),
                "task_type": _value(task_type),
                "assignee": assignee,
                "search": search,
            }
        )
        tickets = as_list(client.get("/tasks", params=params))
    if as_json:
        print_json(tickets)
        return
    if not tickets:
        say("No tickets found.")
        return

    columns = ["ID", "Title", "Status", "Priority", "Type", "Assignee"]
    if project is None:
        columns.append("Project")
    grid = table(*columns)
    grid.columns[1].no_wrap = True
    grid.columns[1].overflow = "ellipsis"
    for ticket in tickets:
        row: list[Any] = [
            str(ticket["id"]),
            ticket.get("title") or "",
            status(ticket.get("status")),
            priority(ticket.get("priority")),
            label(ticket.get("task_type")),
            person(ticket.get("assignee_detail")),
        ]
        if project is None:
            row.append(ticket.get("project_name") or str(ticket.get("project") or "-"))
        grid.add_row(*row)
    console.print(grid)


@app.command("show")
def show_task(
    ctx: typer.Context,
    task_id: Annotated[int, typer.Argument(help="Ticket ID.")],
    comments: Annotated[int, typer.Option("--comments", help="How many recent comments to show.")] = 5,
    as_json: JsonFlag = False,
) -> dict[str, Any]:
    """Show a ticket with its validation contract and recent comments."""
    with get_state(ctx).client() as client:
        ticket = client.get(f"/tasks/{task_id}")
    if as_json:
        print_json(ticket)
    else:
        _show(ticket, comments)
    return ticket  # The interactive shell selects the ticket it shows.


def _show(ticket: dict[str, Any], comments: int) -> None:
    header = Text(f"#{ticket['id']} {ticket.get('title') or ''}  ", style="bold")
    header.append_text(status(ticket.get("status")))
    console.print(header)
    qa = None
    if ticket.get("qa_rejected"):
        qa = Text(f"rejected: {ticket.get('qa_rejection_reason') or 'see the comments'}", style="red")
    console.print(
        details(
            [
                ("Project", f"{ticket.get('project_name') or '-'} (#{ticket.get('project')})"),
                ("Type", label(ticket.get("task_type"))),
                ("Priority", priority(ticket.get("priority"))),
                ("Assignee", person(ticket.get("assignee_detail"), fallback="unassigned")),
                ("Due", ticket.get("due_date")),
                ("Pull request", ticket.get("pr_url")),
                ("QA", qa),
                ("Contract", _percent(ticket.get("contract_compliance_score"))),
            ]
        )
    )

    contract = ticket.get("validation_contract") or []
    if contract:
        console.print(Text("\nValidation contract", style="bold"))
        grid = table("ID", "Status", "Assertion")
        for clause in contract:
            verdict = str(clause.get("status") or "PENDING")
            style = {"PASSED": "green", "FAILED": "red"}.get(verdict.upper(), "yellow")
            grid.add_row(str(clause.get("id") or ""), Text(verdict, style=style), str(clause.get("assertion") or ""))
        console.print(grid)

    description = (ticket.get("description") or "").strip()
    if description:
        console.print(Text("\nDescription", style="bold"))
        console.print(Text(description))

    thread = ticket.get("comments") or []
    if thread and comments > 0:
        recent = thread[-comments:]
        console.print(Text(f"\nComments ({len(recent)} of {len(thread)})", style="bold"))
        for comment in recent:
            line = Text(f"{timestamp(comment.get('created_at'))}  ", style="dim")
            line.append(person(comment.get("author_detail"), fallback="someone"), style="bold")
            line.append(": " + (comment.get("body") or "").strip())
            console.print(line)


@app.command("create")
def create_task(
    ctx: typer.Context,
    title: Annotated[str, typer.Argument(help="Ticket title.")],
    project: Annotated[int, typer.Option("--project", "-p", help="Project ID.")],
    description: Annotated[Optional[str], typer.Option("--description", "-d", help="What needs to be done.")] = None,
    task_type: Annotated[
        Optional[TaskType], typer.Option("--type", help="Ticket type.", case_sensitive=False)
    ] = None,
    priority_value: Annotated[
        Optional[Priority], typer.Option("--priority", help="Priority.", case_sensitive=False)
    ] = None,
    assignee: Annotated[Optional[int], typer.Option("--assignee", help="Assignee user ID.")] = None,
    as_json: JsonFlag = False,
) -> dict[str, Any]:
    """Create a ticket."""
    body = compact(
        {
            "project": project,
            "title": title,
            "description": description,
            "task_type": _value(task_type),
            "priority": _value(priority_value),
            "assignee": assignee,
        }
    )
    with get_state(ctx).client() as client:
        ticket = client.post("/tasks", json=body)
    if as_json:
        print_json(ticket)
    else:
        task_id = ticket["id"]
        where = ticket.get("project_name") or f"project #{project}"
        say(f"Created task #{task_id} in {where}: {ticket.get('title') or title}")
        say(f"Put the agents on it: {suggest(f'agents run {task_id}', '/run')}", "dim")
    return ticket  # The interactive shell selects the ticket it creates.


@app.command("move")
def move_task(
    ctx: typer.Context,
    task_id: Annotated[int, typer.Argument(help="Ticket ID.")],
    new_status: Annotated[TaskStatus, typer.Argument(help="Board column to move it to.", case_sensitive=False)],
) -> None:
    """Move a ticket to another board column."""
    with get_state(ctx).client() as client:
        ticket = client.patch(f"/tasks/{task_id}", json={"status": new_status.value})
    say(f"Task #{task_id} is now {label(ticket.get('status') or new_status.value)}.")


@app.command("update")
def update_task(
    ctx: typer.Context,
    task_id: Annotated[int, typer.Argument(help="Ticket ID.")],
    title: Annotated[Optional[str], typer.Option("--title", help="New title.")] = None,
    description: Annotated[Optional[str], typer.Option("--description", "-d", help="New description.")] = None,
    task_type: Annotated[
        Optional[TaskType], typer.Option("--type", help="Ticket type.", case_sensitive=False)
    ] = None,
    priority_value: Annotated[
        Optional[Priority], typer.Option("--priority", help="Priority.", case_sensitive=False)
    ] = None,
    assignee: Annotated[Optional[int], typer.Option("--assignee", help="Assignee user ID.")] = None,
    as_json: JsonFlag = False,
) -> None:
    """Change a ticket's title, description, type, priority or assignee."""
    changes = compact(
        {
            "title": title,
            "description": description,
            "task_type": _value(task_type),
            "priority": _value(priority_value),
            "assignee": assignee,
        }
    )
    if not changes:
        raise UsageError("Nothing to change. Pass at least one option, such as --priority.")
    with get_state(ctx).client() as client:
        ticket = client.patch(f"/tasks/{task_id}", json=changes)
    if as_json:
        print_json(ticket)
        return
    say(f"Updated task #{task_id}.")


@app.command("comment")
def comment_on_task(
    ctx: typer.Context,
    task_id: Annotated[int, typer.Argument(help="Ticket ID.")],
    message: Annotated[str, typer.Argument(help="Comment text.")],
) -> None:
    """Add a comment to a ticket.

    Comments do not start agents. To give the agents an instruction, run:
    teamflow agents run TASK_ID -m "..."
    """
    with get_state(ctx).client() as client:
        client.post(f"/tasks/{task_id}/comments", json={"body": message})
    say(f"Commented on task #{task_id}.")
