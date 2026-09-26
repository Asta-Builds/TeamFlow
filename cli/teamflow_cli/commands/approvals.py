"""teamflow approvals: the human gate before an agent release reaches main."""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Optional

import typer
from rich.text import Text

from ..errors import CliError
from ..hints import suggest
from ..output import (
    as_list,
    console,
    details,
    label,
    person,
    print_json,
    say,
    short_sha,
    status,
    table,
    timestamp,
)
from ..state import JsonFlag, compact, get_state

app = typer.Typer(help="Review, approve and reject agent releases.", no_args_is_help=True)


class ApprovalStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    executed = "executed"
    rejected = "rejected"
    superseded = "superseded"
    failed = "failed"
    all = "all"


@app.command("list")
def list_approvals(
    ctx: typer.Context,
    status_filter: Annotated[
        ApprovalStatus, typer.Option("--status", "-s", help="Which approvals to list.", case_sensitive=False)
    ] = ApprovalStatus.pending,
    task: Annotated[Optional[int], typer.Option("--task", "-t", help="Only approvals for this ticket.")] = None,
    as_json: JsonFlag = False,
) -> None:
    """List release approvals, pending ones by default."""
    wanted = None if status_filter is ApprovalStatus.all else status_filter.value
    with get_state(ctx).client() as client:
        approvals = as_list(client.get("/agents/approvals", params=compact({"task": task, "status": wanted})))
    if as_json:
        print_json(approvals)
        return
    if not approvals:
        say("Nothing is waiting for approval." if wanted == "pending" else "No approvals found.")
        return
    grid = table("ID", "Ticket", "Branch", "Commit", "Status", "Requested", "Pull request")
    for approval in approvals:
        grid.add_row(
            str(approval["id"]),
            f"#{approval.get('task')} {approval.get('task_title') or ''}".strip(),
            approval.get("branch") or "-",
            short_sha(approval.get("head_sha")),
            status(approval.get("status")),
            timestamp(approval.get("requested_at")),
            approval.get("pr_url") or "-",
        )
    console.print(grid)


@app.command("show")
def show_approval(
    ctx: typer.Context,
    approval_id: Annotated[int, typer.Argument(help="Approval ID.")],
    as_json: JsonFlag = False,
) -> None:
    """Show what a release would merge, and any decision taken."""
    with get_state(ctx).client() as client:
        approval = client.get(f"/agents/approvals/{approval_id}")
    if as_json:
        print_json(approval)
        return
    _describe(approval)


@app.command("approve")
def approve_release(
    ctx: typer.Context,
    approval_id: Annotated[int, typer.Argument(help="Approval ID.")],
    reason: Annotated[Optional[str], typer.Option("--reason", "-r", help="Note recorded with the decision.")] = None,
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Do not ask for confirmation.")] = False,
) -> None:
    """Approve a release: merge the approved commit into main, then request a staging deployment."""
    with get_state(ctx).client() as client:
        approval = _pending(client.get(f"/agents/approvals/{approval_id}"))
        _describe(approval)
        if not yes:
            typer.confirm("Merge this release into main?", abort=True)
        client.post(f"/agents/approvals/{approval_id}/approve", json={"reason": reason or ""})
    task = approval.get("task")
    say(f"Approved release #{approval_id}. The merge is running now.", "green")
    say(f"Follow it with: {suggest(f'agents watch --task {task}', f'/watch #{task}')}", "dim")


@app.command("reject")
def reject_release(
    ctx: typer.Context,
    approval_id: Annotated[int, typer.Argument(help="Approval ID.")],
    reason: Annotated[Optional[str], typer.Option("--reason", "-r", help="Why the release is rejected.")] = None,
) -> None:
    """Reject a release. The ticket stays in QA, with your reason as a comment."""
    reason = (reason if reason is not None else typer.prompt("Reason")).strip()
    if not reason:
        raise CliError("A reason is required to reject a release.")
    with get_state(ctx).client() as client:
        client.post(f"/agents/approvals/{approval_id}/reject", json={"reason": reason})
    say(f"Rejected release #{approval_id}. The ticket stays in QA.")


def _pending(approval: dict[str, Any]) -> dict[str, Any]:
    if approval.get("status") != "pending":
        raise CliError(f"Approval #{approval.get('id')} is {label(approval.get('status'))}, not pending.")
    return approval


def _describe(approval: dict[str, Any]) -> None:
    header = Text(f"Approval #{approval.get('id')}: {approval.get('title') or 'Release'}  ", style="bold")
    header.append_text(status(approval.get("status")))
    console.print(header)
    decided = None
    if approval.get("decided_at"):
        decided = f"{timestamp(approval['decided_at'])} by {person(approval.get('decided_by'), fallback='someone')}"
    result = approval.get("result") or {}
    console.print(
        details(
            [
                ("Ticket", f"#{approval.get('task')} {approval.get('task_title') or ''}".strip()),
                ("Change", approval.get("description")),
                ("Repository", approval.get("repo")),
                ("Branch", approval.get("branch")),
                ("Commit", approval.get("head_sha")),
                ("Pull request", approval.get("pr_url")),
                ("Requested", timestamp(approval.get("requested_at"))),
                ("Decided", decided),
                ("Reason", approval.get("decision_reason")),
                ("Result", result.get("detail") if isinstance(result, dict) else None),
            ]
        )
    )
