"""teamflow projects: list, inspect and create projects."""

from __future__ import annotations

from collections import Counter
from enum import Enum
from typing import Annotated, Any, Optional

import typer

from ..hints import suggest
from ..output import (
    as_list,
    console,
    details,
    label,
    person,
    print_json,
    say,
    status,
    table,
    timestamp,
)
from ..state import JsonFlag, compact, get_state

app = typer.Typer(help="List, inspect and create projects.", no_args_is_help=True)

BOARD_COLUMNS = ("todo", "in_progress", "in_review", "qa", "done")


class ProjectStatus(str, Enum):
    active = "active"
    on_hold = "on_hold"
    completed = "completed"
    archived = "archived"


@app.command("list")
def list_projects(
    ctx: typer.Context,
    status_filter: Annotated[
        Optional[ProjectStatus],
        typer.Option("--status", help="Only projects with this status.", case_sensitive=False),
    ] = None,
    search: Annotated[Optional[str], typer.Option("--search", "-q", help="Match the name or description.")] = None,
    as_json: JsonFlag = False,
) -> None:
    """List the projects you can see."""
    params = compact({"status": status_filter.value if status_filter else None, "search": search})
    with get_state(ctx).client() as client:
        projects = as_list(client.get("/projects", params=params))
    if as_json:
        print_json(projects)
        return
    if not projects:
        say("No projects found.")
        return
    grid = table("ID", "Name", "Status", "Done", "Progress", "Repository")
    for project in projects:
        grid.add_row(
            str(project["id"]),
            project.get("name") or "",
            status(project.get("status")),
            f"{project.get('done_task_count', 0)}/{project.get('task_count', 0)}",
            f"{project.get('progress_percentage', 0)}%",
            project.get("github_repo") or "-",
        )
    console.print(grid)


@app.command("show")
def show_project(
    ctx: typer.Context,
    project_id: Annotated[int, typer.Argument(help="Project ID.")],
    as_json: JsonFlag = False,
) -> dict[str, Any]:
    """Show a project and where its tickets stand."""
    with get_state(ctx).client() as client:
        project = client.get(f"/projects/{project_id}")
        if as_json:
            print_json(project)
        else:
            tickets = as_list(client.get("/tasks", params={"project": project_id}))
            _show(project, tickets)
    return project  # The interactive shell selects the project it shows.


def _show(project: dict[str, Any], tickets: list[dict[str, Any]]) -> None:
    counts = Counter(ticket.get("status") for ticket in tickets)
    say(f"#{project['id']} {project.get('name') or ''}", "bold")
    console.print(
        details(
            [
                ("Status", status(project.get("status"))),
                ("Description", project.get("description")),
                ("Repository", project.get("github_repo")),
                ("Owner", person(project.get("owner_detail"), fallback="")),
                ("Members", ", ".join(person(member) for member in project.get("members_detail") or [])),
                ("Tickets", "   ".join(f"{label(column)} {counts[column]}" for column in BOARD_COLUMNS)),
                ("Progress", f"{project.get('progress_percentage', 0)}% done"),
                ("Created", timestamp(project.get("created_at"))),
            ]
        )
    )
    project_id = project["id"]
    say(f"Tickets: {suggest(f'tasks list --project {project_id}', '/tasks')}", "dim")


@app.command("create")
def create_project(
    ctx: typer.Context,
    name: Annotated[str, typer.Argument(help="Project name.")],
    description: Annotated[Optional[str], typer.Option("--description", "-d", help="What the project is for.")] = None,
    repo: Annotated[Optional[str], typer.Option("--repo", help="GitHub repository, as owner/name.")] = None,
    as_json: JsonFlag = False,
) -> dict[str, Any]:
    """Create a project."""
    body = compact({"name": name, "description": description, "github_repo": repo})
    with get_state(ctx).client() as client:
        project = client.post("/projects", json=body)
    if as_json:
        print_json(project)
    else:
        say(f"Created project #{project['id']}: {project.get('name') or name}")
    return project  # The interactive shell selects the project it creates.
