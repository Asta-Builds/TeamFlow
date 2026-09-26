"""teamflow deployments: releases of a project to an environment."""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Optional

import typer
from rich.text import Text

from ..output import (
    as_list,
    console,
    details,
    duration,
    print_json,
    say,
    short_sha,
    status,
    table,
    timestamp,
)
from ..state import JsonFlag, compact, get_state

app = typer.Typer(help="List, request and roll back deployments.", no_args_is_help=True)


class Environment(str, Enum):
    dev = "dev"
    staging = "staging"
    production = "production"


class DeploymentStatus(str, Enum):
    queued = "queued"
    in_progress = "in_progress"
    success = "success"
    failed = "failed"
    rolled_back = "rolled_back"
    cancelled = "cancelled"


@app.command("list")
def list_deployments(
    ctx: typer.Context,
    project: Annotated[Optional[int], typer.Option("--project", "-p", help="Project ID.")] = None,
    environment: Annotated[
        Optional[Environment], typer.Option("--env", "-e", help="Environment.", case_sensitive=False)
    ] = None,
    status_filter: Annotated[
        Optional[DeploymentStatus], typer.Option("--status", "-s", help="Status.", case_sensitive=False)
    ] = None,
    as_json: JsonFlag = False,
) -> None:
    """List deployments, newest first."""
    params = compact(
        {
            "project": project,
            "environment": environment.value if environment else None,
            "status": status_filter.value if status_filter else None,
        }
    )
    with get_state(ctx).client() as client:
        deployments = as_list(client.get("/deployments", params=params))
    if as_json:
        print_json(deployments)
        return
    if not deployments:
        say("No deployments found.")
        return
    grid = table("ID", "Project", "Env", "Status", "Branch", "Commit", "Started", "Duration")
    for deployment in deployments:
        grid.add_row(
            str(deployment["id"]),
            deployment.get("project_name") or str(deployment.get("project") or "-"),
            deployment.get("environment") or "-",
            status(deployment.get("status")),
            deployment.get("branch") or "-",
            short_sha(deployment.get("commit_sha")),
            timestamp(deployment.get("started_at")),
            duration(deployment.get("duration_seconds")),
        )
    console.print(grid)


@app.command("show")
def show_deployment(
    ctx: typer.Context,
    deployment_id: Annotated[int, typer.Argument(help="Deployment ID.")],
    as_json: JsonFlag = False,
) -> None:
    """Show a deployment and its logs."""
    with get_state(ctx).client() as client:
        deployment = client.get(f"/deployments/{deployment_id}")
    if as_json:
        print_json(deployment)
        return
    _summary(deployment)
    logs = (deployment.get("logs") or "").strip()
    if logs:
        console.print(Text("\nLogs", style="bold"))
        console.print(Text(logs))


@app.command("create")
def create_deployment(
    ctx: typer.Context,
    project: Annotated[int, typer.Option("--project", "-p", help="Project ID.")],
    environment: Annotated[
        Environment, typer.Option("--env", "-e", help="Environment.", case_sensitive=False)
    ] = Environment.staging,
    branch: Annotated[Optional[str], typer.Option("--branch", "-b", help="Branch to deploy.")] = None,
    commit: Annotated[Optional[str], typer.Option("--commit", help="Commit SHA to deploy.")] = None,
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Do not ask for confirmation.")] = False,
    as_json: JsonFlag = False,
) -> None:
    """Request a deployment from the configured provider."""
    if environment is Environment.production and not yes:
        typer.confirm(f"Deploy project #{project} to production?", abort=True)
    body = compact({"project": project, "environment": environment.value, "branch": branch, "commit_sha": commit})
    with get_state(ctx).client() as client:
        deployment = client.post("/deployments", json=body)
    if as_json:
        print_json(deployment)
        return
    say(f"Requested deployment #{deployment['id']} to {deployment.get('environment') or environment.value}.")
    _summary(deployment)


@app.command("rollback")
def rollback_deployment(
    ctx: typer.Context,
    deployment_id: Annotated[int, typer.Argument(help="The earlier successful deployment to redeploy.")],
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Do not ask for confirmation.")] = False,
    as_json: JsonFlag = False,
) -> None:
    """Redeploy an earlier successful release."""
    with get_state(ctx).client() as client:
        if not yes:
            target = client.get(f"/deployments/{deployment_id}")
            typer.confirm(
                f"Redeploy {short_sha(target.get('commit_sha'))} of "
                f"{target.get('project_name') or 'the project'} to {target.get('environment')}?",
                abort=True,
            )
        deployment = client.post(f"/deployments/{deployment_id}/rollback")
    if as_json:
        print_json(deployment)
        return
    say(f"Requested rollback deployment #{deployment['id']}.")
    _summary(deployment)


def _summary(deployment: dict[str, Any]) -> None:
    console.print(
        details(
            [
                ("Deployment", f"#{deployment.get('id')}"),
                ("Project", deployment.get("project_name") or deployment.get("project")),
                ("Environment", deployment.get("environment")),
                ("Status", status(deployment.get("status"))),
                ("Branch", deployment.get("branch")),
                ("Commit", deployment.get("commit_sha")),
                ("Requested by", deployment.get("triggered_by_name")),
                ("Started", timestamp(deployment.get("started_at"))),
                ("Finished", timestamp(deployment.get("finished_at")) if deployment.get("finished_at") else None),
                ("Duration", duration(deployment.get("duration_seconds")) if deployment.get("duration_seconds") else None),
            ]
        )
    )
