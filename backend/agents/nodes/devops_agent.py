import time
from typing import Dict, Any
from agents.state import TicketState
from agents.tools.github_tool import merge_pull_request
from agents.tools.app_tool import trigger_app_deployment, update_ticket_status, add_ticket_comment, log_task_activity
from agents.events import emit_state_event


def devops_agent_node(state: TicketState) -> Dict[str, Any]:
    """
    DevOps Specialist Agent:
    - Merges verified PR into main
    - Triggers CI/CD deployment pipeline to staging/prod
    - Closes ticket upon deployment verification
    """
    ticket_id = state.get("ticket_id")
    project_id = state.get("project_id", 1)
    pr_url = state.get("pr_url", "")
    history = list(state.get("history", []))
    total_tokens = state.get("total_tokens", 0) + 390
    total_cost = state.get("total_cost_usd", 0.0) + 0.0039

    emit_state_event(
        state,
        event_type="progress",
        sender_key="devops",
        message="I received the release handoff and am recording the merge and deployment workflow result.",
        current_work="Processing release handoff",
        remaining_work=["record deployment result", "close orchestration run"],
    )

    # 1. Merge the reviewed branch into main inside the project workspace
    project_workspace = state.get("workspace_path", "")
    branch_name = state.get("branch_name", "")
    merge_info = merge_pull_request(
        state.get("github_repo", "") or "",
        source_branch=branch_name,
        target_branch="main",
        cwd=project_workspace,
    ) if branch_name and project_workspace else {"status": "skipped", "output": "No branch was recorded for this run."}
    merged = merge_info.get("status") == "merged"

    # 2. Request a staging deployment from the configured provider
    if merged:
        deploy_info = trigger_app_deployment(
            project_id=project_id,
            environment="staging",
            branch="main",
            commit_sha=merge_info.get("merged_sha", ""),
        )
    else:
        deploy_info = {"ok": False, "error": "Skipped because the merge did not succeed."}

    if deploy_info.get("ok"):
        deployment_status = "in_progress"
        release_line = f"Deployment #{deploy_info.get('deployment_id')} was accepted by the provider; it reports the final outcome."
    elif deploy_info.get("configured") is False:
        deployment_status = "not_configured"
        release_line = "No deployment provider is configured, so no deployment was started."
    else:
        deployment_status = "failed"
        release_line = f"No deployment is running: {deploy_info.get('error') or deploy_info.get('status')}."

    merge_line = (
        f"Merged `{branch_name}` into `main` at `{merge_info.get('merged_sha', '')}`."
        if merged
        else f"The merge did not happen: {merge_info.get('output', 'unknown reason')}"
    )

    # 3. Only a merged ticket is marked done; the release outcome is reported as-is.
    if ticket_id:
        if merged:
            update_ticket_status(ticket_id, "done", actor_email="devops")
        devops_comment = (
            f"**Joan of Arc (AI) - DevOps Engineer**\n\n"
            f"**Release step:**\n\n"
            f"- **Merge:** {merge_line}\n"
            f"- **Deployment:** {release_line}\n"
            f"- **Ticket:** {'moved to Done' if merged else 'left open for follow-up'}."
        )
        add_ticket_comment(ticket_id, "devops", devops_comment)
        log_task_activity(
            ticket_id,
            "Joan of Arc (AI)",
            "release_requested",
            {"environment": "staging", "merged": merged, "deployment_status": deployment_status},
        )

    step_log = {
        "node": "devops",
        "agent_role": "DevOps Engineer",
        "action": "release_step",
        "message": f"{merge_line} {release_line}",
        "deployment_status": deployment_status,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        "tokens": 390,
        "cost_usd": 0.0039,
    }
    history.append(step_log)
    emit_state_event(
        state,
        event_type="completed",
        sender_key="devops",
        message=f"Release step recorded. {merge_line} {release_line}",
        current_work="Release workflow step completed",
        remaining_work=[],
        metadata={"deployment": deploy_info, "merge": merge_info},
    )

    return {
        "status": "done" if merged else "in_review",
        "deployment_status": deployment_status,
        "deployment_logs": release_line,
        "assigned_agent": "done",
        "history": history,
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
    }
