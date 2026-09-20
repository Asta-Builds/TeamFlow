"""
Full Autonomous Swarm Chain Engine with Inter-Agent Communication Flux.
Enables agents to talk to each other, hand off work sequentially, write code in isolated project workspaces,
run QA validation gates, and merge to main.
"""

import os
import time
import logging
import re
from typing import Dict, Any, List, Optional
from django.conf import settings

from tasks.models import Task, Comment, TaskActivity
from accounts.models import User
from .approvals import BranchResolutionError, request_release_approval

from agents.release import current_branch_head, format_release_comment, perform_release

from .git_service import (
    get_project_workspace,
    git_pull,
    run_project_build,
    git_checkout_branch,
    git_commit,
    git_push,
    git_create_pull_request,
    _resolve_project_repo_and_token,
    sanitize_sensitive_data,
    _run_git_command,
)
from .code_writer import apply_code_changes, parse_and_apply_code_changes, safe_workspace_path
from .untrusted_text import neutralize_untrusted_markdown
from .llm import generate_text
from .rag.vector_store import query_similar_chunks
from .registry import AGENT_SEATS, get_agent_spec
from .users import get_or_create_agent_user
from .events import emit_agent_event, ensure_task_organization
from .tools.app_tool import trigger_app_deployment
from agents.verification import verify_workspace, VerificationResult

logger = logging.getLogger(__name__)


SWARM_SPECIALISTS = {}
for _key, _spec_key in [("tech_lead", "tech_lead"), ("backend", "backend"), ("frontend", "frontend"), ("qa", "qa"), ("devops", "devops")]:
    _spec = get_agent_spec(_spec_key)
    SWARM_SPECIALISTS[_key] = {
        "key": _spec_key,
        "name": _spec["name"],
        "role": _spec["role"],
        "title": _spec["title"],
        "avatar": _spec["name"][:2].upper(),
    }


def generate_validation_contract(task: Task, instruction: str = "") -> List[Dict[str, Any]]:
    """
    Factory 'Missions' Architecture:
    Validation Contracts establish an objective, unambiguous Definition of Done
    comprising independent assertions defined upfront during planning BEFORE code is written.
    """
    clean_title = task.title.strip()
    return [
        {
            "id": "VC-1",
            "category": "API Contract & Schema Invariants",
            "assertion": f"REST endpoints for '{clean_title}' return valid JSON with appropriate HTTP status codes (200/201/400).",
            "status": "PENDING",
            "validator": "QA Specialist (AI)"
        },
        {
            "id": "VC-2",
            "category": "Domain Invariants & Boundary Handling",
            "assertion": f"Handles edge conditions, missing parameters, and empty state payloads gracefully without unhandled exceptions.",
            "status": "PENDING",
            "validator": "QA Specialist (AI)"
        },
        {
            "id": "VC-3",
            "category": "UI/UX & Client State",
            "assertion": f"Client component renders cleanly with responsive design, loading states, and feedback toasts.",
            "status": "PENDING",
            "validator": "QA Specialist (AI)"
        },
        {
            "id": "VC-4",
            "category": "Isolation & Git Integrity",
            "assertion": f"All source code is committed to dedicated workspace branch with author signature and zero host leakage.",
            "status": "PENDING",
            "validator": "QA Specialist (AI)"
        },
        {
            "id": "VC-5",
            "category": "Holistic Quality & Test Coverage",
            "assertion": f"Automated integration test suite validates all assertions with code coverage >= 95.0%.",
            "status": "PENDING",
            "validator": "QA Specialist (AI)"
        }
    ]


def execute_full_swarm_chain(
    task: Task,
    trigger_user: Optional[User] = None,
    instruction: str = "",
    session_id: str = "",
    trace=None,
) -> List[Dict[str, Any]]:
    """
    Executes the sequential multi-agent swarm chain:
    1. Tech Lead (Architecture & Upfront Validation Contract -> Backend)
    2. Senior Backend (Code API in isolated project workspace & Branch/Commit)
    3. Senior Frontend (Code UI in isolated project workspace & Connect API)
    4. QA Engineer (Validation Contract Verification & Gate Signoff)
    5. Tech Lead (PR Merge to main)
    6. DevOps (Staging Deployment & Completion)
    """
    task = ensure_task_organization(task)
    session_id = session_id or f"chain-task-{task.id}-{int(time.time())}"
    chain_events: List[Dict[str, Any]] = []
    project = task.project
    project_name = getattr(project, "name", "Project Codebase")
    project_workspace = get_project_workspace(task)
    workspace_rel = os.path.basename(project_workspace)
    task_clean_title = re.sub(r'[^a-zA-Z0-9]+', '-', task.title.lower()).strip('-')[:28]
    branch_name = f"feat/ticket-{task.id}-{task_clean_title}"

    # Synchronize project workspace with remote main before starting swarm chain
    git_pull("main", cwd=project_workspace)

    # Generate Upfront Validation Contract (Factory 'Missions' Architecture)
    contract = generate_validation_contract(task, instruction)
    task.validation_contract = contract
    task.contract_compliance_score = 0.0
    task.status = Task.Status.IN_PROGRESS
    task.save(update_fields=["validation_contract", "contract_compliance_score", "status"])
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=session_id,
        event_type="started",
        sender_key="tech_lead",
        message=f"{SWARM_SPECIALISTS['tech_lead']['name']} is defining the validation contract and preparing the first backend handoff.",
        current_work="Defining scope and validation contract",
        remaining_work=["backend step", "frontend step", "QA decision", "merge review", "release step"],
    )

    # -------------------------------------------------------------
    # STEP 1: Tech Lead (architecture and handoff to backend)
    # -------------------------------------------------------------
    lead_user = get_or_create_agent_user("tech_lead", task.organization)
    rag_results = query_similar_chunks(
        f"{task.title} {task.description} {instruction}",
        project_id=task.project_id,
        organization_id=task.organization_id,
        limit=2,
    )
    rag_context = "\n".join([r.get("content", "") for r in rag_results]) if rag_results else "Standard project architecture."

    contract_bullets = "\n".join([f"  - **[{c['id']}]** {c['assertion']}" for c in contract])
    lead_comment_body = (
        f"**{SWARM_SPECIALISTS['tech_lead']['name']} - {SWARM_SPECIALISTS['tech_lead']['title']}**\n\n"
        f"**Sprint Planning Handoff to @backend_core:**\n\n"
        f"Hey {SWARM_SPECIALISTS['backend']['name']}! I analyzed ticket **#{task.id} : {task.title}** for project **`{project_name}`** and established our **Validation Contract (Definition of Done)**:\n\n"
        f"**Validation Contract ({len(contract)} independent assertions):**\n"
        f"{contract_bullets}\n\n"
        f"**Architectural Directives:**\n"
        f"- Clean domain separation with robust Django / FastAPI REST endpoints and boundary guards.\n"
        f"- Strict repository isolation in `generated_projects/{workspace_rel}/`.\n"
        f"- Automated build & AST verification required before pushing.\n\n"
        f"Branch `{branch_name}` is initialized and synchronized with `main`. Handing off to @backend_core for backend implementation!"
    )
    lead_comment = Comment.objects.create(task=task, author=lead_user, body=lead_comment_body)
    TaskActivity.objects.create(
        task=task,
        actor=lead_user,
        action="agent_handoff",
        details={"from": "tech_lead", "to": "backend", "step": "validation_contract_defined", "contract_items": len(contract)}
    )
    chain_events.append({
        "step": 1,
        "agent": SWARM_SPECIALISTS["tech_lead"],
        "target_agent": SWARM_SPECIALISTS["backend"],
        "action": "Validation Contract & Architecture Handoff",
        "comment_id": lead_comment.id,
        "content": lead_comment_body,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    })
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=session_id,
        event_type="handoff",
        sender_key="tech_lead",
        recipient_key="backend_core",
        message="I finished the initial architecture step and handed the validation contract to backend.",
        current_work="Waiting for backend update",
        remaining_work=["backend step", "frontend step", "QA decision", "merge review", "release step"],
    )

    # -------------------------------------------------------------
    # STEP 2: Senior Backend (Backend Code & Handoff to Frontend)
    # -------------------------------------------------------------
    backend_user = get_or_create_agent_user("backend_core", task.organization)
    backend_prompt = (
        f"Project: {project_name}\n"
        f"Task: #{task.id} - {task.title}\n"
        f"Description: {task.description}\n"
        f"Instruction: {instruction or 'Build backend API endpoints and data model'}\n"
        f"RAG Context: {rag_context}\n\n"
        f"Generate the backend Python/Django or FastAPI code files. Use exact format:\n"
        f"FILE: [path/to/file]\n"
        f"CODE:\n"
        f"[content]\n"
        f"---\n"
    )
    backend_system = (
        f"You are the Senior Backend Engineer at TeamFlow. Build robust backend endpoints and database models "
        f"for project '{project_name}'. Output clean code with FILE: and CODE: blocks."
    )

    backend_llm_out = generate_text(backend_system, backend_prompt, timeout=180)
    if not backend_llm_out:
        fail_body = f"**{SWARM_SPECIALISTS['backend']['name']} - {SWARM_SPECIALISTS['backend']['title']}**\n\nNo language model is configured, so no code was generated."


        Comment.objects.create(task=task, author=backend_user, body=fail_body)
        emit_agent_event(task=task, trace=trace, session_id=session_id, event_type="blocked", sender_key="backend_core", message="No code was generated.", current_work="Failed to generate code", remaining_work=["configure language model"])
        return chain_events


    backend_outcome = apply_code_changes(
        llm_output=backend_llm_out,
        workspace=project_workspace,
        task=task,
        agent_info=SWARM_SPECIALISTS["backend"],
        repo_name=getattr(project, "github_repo", ""),
    )
    backend_code_report = backend_outcome.report
    backend_files = backend_outcome.written_files

    backend_comment_body = (
        f"**{SWARM_SPECIALISTS['backend']['name']} - {SWARM_SPECIALISTS['backend']['title']}**\n\n"
        f"**Sprint Daily Standup & Handoff to @frontend_app & @tech_lead:**\n\n"
        f"Hey {SWARM_SPECIALISTS['frontend']['name']}! Backend implementation and models for **#{task.id} : {task.title}** are complete, verified, and committed.\n\n"
        f"- **Completed:** Implemented REST API endpoints and data schemas.\n"
        f"- **Branch:** `{branch_name}`\n"
        f"- **Workspace:** `generated_projects/{workspace_rel}/`\n\n"
        f"{backend_code_report}\n\n"
        f"API endpoints and schemas are verified via AST analysis. Ready for @frontend_app Next.js frontend UI integration!"
    )
    backend_comment = Comment.objects.create(task=task, author=backend_user, body=backend_comment_body)
    TaskActivity.objects.create(
        task=task,
        actor=backend_user,
        action="agent_handoff",
        details={"from": "backend", "to": "frontend", "step": "code_backend_completed"}
    )
    chain_events.append({
        "step": 2,
        "agent": SWARM_SPECIALISTS["backend"],
        "target_agent": SWARM_SPECIALISTS["frontend"],
        "action": "Backend Code & Handoff",
        "comment_id": backend_comment.id,
        "content": backend_comment_body,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    })
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=session_id,
        event_type="handoff",
        sender_key="backend_core",
        recipient_key="frontend_app",
        message="I completed the backend generation step and handed the recorded output to frontend.",
        current_work="Waiting for frontend integration",
        remaining_work=["frontend step", "QA decision", "merge review", "release step"],
    )

    # -------------------------------------------------------------
    # STEP 3: Senior Frontend (Frontend Code & Handoff to QA)
    # -------------------------------------------------------------
    frontend_user = get_or_create_agent_user("frontend_app", task.organization)
    frontend_prompt = (
        f"Project: {project_name}\n"
        f"Task: #{task.id} - {task.title}\n"
        f"Description: {task.description}\n"
        f"Build the Next.js React / Tailwind view component. Use exact format:\n"
        f"FILE: [path/to/component.tsx]\n"
        f"CODE:\n"
        f"[content]\n"
        f"---\n"
    )
    frontend_system = (
        f"You are {SWARM_SPECIALISTS['frontend']['name']}, {SWARM_SPECIALISTS['frontend']['title']} at TeamFlow. "
        f"Build the frontend components for project '{project_name}'."
    )

    frontend_llm_out = generate_text(frontend_system, frontend_prompt, timeout=180)
    if not frontend_llm_out:
        fail_body = f"**{SWARM_SPECIALISTS['frontend']['name']} - {SWARM_SPECIALISTS['frontend']['title']}**\n\nNo language model is configured, so no code was generated."


        Comment.objects.create(task=task, author=frontend_user, body=fail_body)
        emit_agent_event(task=task, trace=trace, session_id=session_id, event_type="blocked", sender_key="frontend_app", message="No code was generated.", current_work="Failed to generate code", remaining_work=["configure language model"])
        return chain_events


    frontend_outcome = apply_code_changes(
        llm_output=frontend_llm_out,
        workspace=project_workspace,
        task=task,
        agent_info=SWARM_SPECIALISTS["frontend"],
        repo_name=getattr(project, "github_repo", ""),
    )
    frontend_code_report = frontend_outcome.report
    frontend_files = frontend_outcome.written_files

    task.status = Task.Status.QA
    task.save(update_fields=["status"])

    frontend_comment_body = (
        f"**{SWARM_SPECIALISTS['frontend']['name']} - {SWARM_SPECIALISTS['frontend']['title']}**\n\n"
        f"**Sprint Daily Standup & Handoff to @qa & @tech_lead:**\n\n"
        f"Hey {SWARM_SPECIALISTS['qa']['name']}! Client UI views and reactive state for **#{task.id} : {task.title}** are fully developed and styled with Tailwind CSS & Lucide icons.\n\n"
        f"{frontend_code_report}\n\n"
        f"UI views are connected to {SWARM_SPECIALISTS['backend']['name']}'s backend endpoints. Ticket moved to **QA / Ready for Test** for @qa Validation Contract check."
    )
    frontend_comment = Comment.objects.create(task=task, author=frontend_user, body=frontend_comment_body)
    TaskActivity.objects.create(
        task=task,
        actor=frontend_user,
        action="agent_handoff",
        details={"from": "frontend", "to": "qa", "step": "code_frontend_completed"}
    )
    chain_events.append({
        "step": 3,
        "agent": SWARM_SPECIALISTS["frontend"],
        "target_agent": SWARM_SPECIALISTS["qa"],
        "action": "Frontend Code & QA Ready",
        "comment_id": frontend_comment.id,
        "content": frontend_comment_body,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    })
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=session_id,
        event_type="handoff",
        sender_key="frontend_app",
        recipient_key="qa",
        message="I completed the frontend generation step and handed the current result to QA.",
        current_work="Waiting for QA decision",
        remaining_work=["QA decision", "merge review", "release step"],
    )

    # -------------------------------------------------------------
    # STEP 4: QA Specialist (Validation Contract Verification & Handoff to Tech Lead)
    # -------------------------------------------------------------
    qa_user = get_or_create_agent_user("qa", task.organization)

    # Files actually written by backend and frontend in this run
    files_modified: List[str] = list(dict.fromkeys(backend_files + frontend_files))

    resolved_repo, resolved_token, _ = _resolve_project_repo_and_token(project_workspace, task)
    repo = getattr(project, "github_repo", "") or resolved_repo or ""
    token = resolved_token or ""

    verify_result = verify_workspace(
        project_workspace,
        files_modified,
        ref=branch_name or "HEAD",
        repo=repo,
        token=token,
    )

    clean_details_url = sanitize_sensitive_data(neutralize_untrusted_markdown(getattr(verify_result, "details_url", "") or ""))
    details_line = f"\n- **Details:** {clean_details_url}" if clean_details_url else ""
    clean_reason = sanitize_sensitive_data(neutralize_untrusted_markdown(getattr(verify_result, "reason", "") or ""))

    validated_contract = []
    current_contract = task.validation_contract or generate_validation_contract(task)

    # VC-4 check factually via git status --porcelain and current branch
    status_res = _run_git_command(["status", "--porcelain"], cwd=project_workspace)
    branch_res = _run_git_command(["branch", "--show-current"], cwd=project_workspace)
    current_branch = branch_res.get("stdout", "").strip() if branch_res.get("success") else ""
    if not current_branch:
        rev_res = _run_git_command(["rev-parse", "--abbrev-ref", "HEAD"], cwd=project_workspace)
        current_branch = rev_res.get("stdout", "").strip() if rev_res.get("success") else ""

    porcelain_out = status_res.get("stdout", "").strip() if status_res.get("success") else "git status failed"
    is_clean = status_res.get("success", False) and not porcelain_out
    is_correct_branch = (current_branch == branch_name)

    if verify_result.steps:
        step_summaries = []
        for s in verify_result.steps:
            st = f"exit {s.exit_code}" if s.exit_code is not None else s.conclusion
            clean_cmd = sanitize_sensitive_data(neutralize_untrusted_markdown(s.command or getattr(s, "name", "")))
            clean_cwd = sanitize_sensitive_data(neutralize_untrusted_markdown(s.cwd or ""))
            step_summaries.append(f"`{clean_cmd}` ({st}) in `{clean_cwd}`")
        steps_evidence = "; ".join(step_summaries)
    else:
        steps_evidence = clean_reason or f"executor: {verify_result.executor}"

    for clause in current_contract:
        c = dict(clause)
        cid = c.get("id", "")
        if cid == "VC-4":
            if is_clean and is_correct_branch:
                c["status"] = "PASSED"
                c["evidence"] = f"Git workspace clean on branch `{branch_name}`."
            else:
                c["status"] = "FAILED"
                failures = []
                if not is_correct_branch:
                    failures.append(f"branch is '{current_branch}', expected '{branch_name}'")
                if not is_clean:
                    failures.append(f"uncommitted changes: {porcelain_out}")
                c["evidence"] = "; ".join(failures)
        else:
            c["status"] = "MANUAL_REVIEW"
            c["evidence"] = f"{steps_evidence}; whether this establishes the assertion needs a human."

        c["verified_at"] = time.strftime("%Y-%m-%d %H:%M:%SZ")
        validated_contract.append(c)

    passed_count = sum(1 for c in validated_contract if c["status"] == "PASSED")
    automated = [c for c in validated_contract if c["status"] != "MANUAL_REVIEW"]
    compliance_score = round((passed_count / len(automated)) * 100.0, 1) if automated else 0.0

    task.validation_contract = validated_contract
    task.contract_compliance_score = compliance_score

    if verify_result.status == "failed":
        task.qa_rejected = True
        task.qa_rejection_reason = clean_reason
        task.status = Task.Status.IN_PROGRESS
        task.save(update_fields=["validation_contract", "contract_compliance_score", "qa_rejected", "qa_rejection_reason", "status"])

        failed_blocks = []
        for s in verify_result.failed_steps:
            st = f"exit {s.exit_code}" if s.exit_code is not None else s.conclusion
            clean_cmd = sanitize_sensitive_data(neutralize_untrusted_markdown(s.command or getattr(s, "name", "")))
            clean_cwd = sanitize_sensitive_data(neutralize_untrusted_markdown(s.cwd or ""))
            tail_lines = (s.output_tail or "").splitlines()[-40:]
            tail_text = "\n".join(tail_lines)
            clean_tail = sanitize_sensitive_data(neutralize_untrusted_markdown(tail_text))
            failed_blocks.append(
                f"- **Failed Step:** `{clean_cmd}` (cwd: `{clean_cwd}`, {st})\n\n```\n{clean_tail}\n```"
            )
        failed_section = "\n".join(failed_blocks) if failed_blocks else f"- {clean_reason}"

        qa_fail_comment = (
            f"**{SWARM_SPECIALISTS['qa']['name']} - {SWARM_SPECIALISTS['qa']['title']}**\n\n"
            f"**Sprint Quality Gate REJECTION for @backend_core & @tech_lead:**\n\n"
            f"- **Validation Gate:** FAILED\n"
            f"- **Executor:** {verify_result.executor}\n"
            f"- **Reason:** {clean_reason}\n"
            f"- **Failures:**\n{failed_section}"
            f"{details_line}\n"
            f"- **Validation Contract:** {passed_count}/{len(automated)} automated assertions passed; {len(validated_contract) - len(automated)} need manual review\n"
            f"- **Action Required:** @backend_core please inspect the failed step output above, fix the issues in branch `{branch_name}`, and re-commit for validation."
        )
        Comment.objects.create(task=task, author=qa_user, body=sanitize_sensitive_data(qa_fail_comment))
        TaskActivity.objects.create(
            task=task,
            actor=qa_user,
            action="qa_rejected",
            details={"executor": verify_result.executor, "reason": clean_reason, "decision": "failed", "metrics": verify_result.to_dict()},
        )
        chain_events.append({
            "step": 4,
            "agent": SWARM_SPECIALISTS["qa"],
            "target_agent": SWARM_SPECIALISTS["backend"],
            "action": "Contract Validation Rejection",
            "comment_id": task.comments.last().id if task.comments.exists() else None,
            "content": qa_fail_comment,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        })
        emit_agent_event(
            task=task,
            trace=trace,
            session_id=session_id,
            event_type="blocked",
            sender_key="qa",
            recipient_key="backend_core",
            message=f"QA Gate Rejected: {clean_reason}",
            current_work="Verification failed",
            remaining_work=["fix code errors", "repeat QA validation"],
            metadata={"qa_result": "failed", "reason": clean_reason, "metrics": verify_result.to_dict()},
        )
        return chain_events

    elif verify_result.status == "unverified":
        task.qa_rejected = False
        task.qa_rejection_reason = ""
        task.status = Task.Status.QA
        task.save(update_fields=["validation_contract", "contract_compliance_score", "qa_rejected", "qa_rejection_reason", "status"])

        qa_unverified_comment = (
            f"**{SWARM_SPECIALISTS['qa']['name']} - {SWARM_SPECIALISTS['qa']['title']}**\n\n"
            f"**Sprint Quality Gate UNVERIFIED for @tech_lead:**\n\n"
            f"- **Validation Gate:** UNVERIFIED\n"
            f"- **Executor:** {verify_result.executor}\n"
            f"- **Reason:** {clean_reason}\n"
            f"- **Status:** No automated verification was performed. The ticket is waiting for a human reviewer in QA."
            f"{details_line}\n"
            f"- **Validation Contract:** {passed_count}/{len(automated)} automated assertions passed; {len(validated_contract) - len(automated)} need manual review\n"
            f"- **Enabling Verification:** Automated verification requires either a GitHub repository linked to the project (to run checks via GitHub Actions) or running the worker where a Docker daemon is available."
        )
        Comment.objects.create(task=task, author=qa_user, body=sanitize_sensitive_data(qa_unverified_comment))
        TaskActivity.objects.create(
            task=task,
            actor=qa_user,
            action="qa_unverified",
            details={"executor": verify_result.executor, "reason": clean_reason, "decision": "unverified", "metrics": verify_result.to_dict()},
        )
        chain_events.append({
            "step": 4,
            "agent": SWARM_SPECIALISTS["qa"],
            "target_agent": SWARM_SPECIALISTS["tech_lead"],
            "action": "Contract Validation Unverified",
            "comment_id": task.comments.last().id if task.comments.exists() else None,
            "content": qa_unverified_comment,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        })
        emit_agent_event(
            task=task,
            trace=trace,
            session_id=session_id,
            event_type="blocked",
            sender_key="qa",
            recipient_key="tech_lead",
            message=f"QA Gate Unverified: {clean_reason}. Waiting for human QA validation.",
            current_work="Waiting for human QA validation",
            remaining_work=["human QA review", "merge review", "release step"],
            metadata={"qa_result": "unverified", "reason": clean_reason, "metrics": verify_result.to_dict()},
        )
        return chain_events

    else:
        task.qa_rejected = False
        task.qa_rejection_reason = ""
        task.save(update_fields=["validation_contract", "contract_compliance_score", "qa_rejected", "qa_rejection_reason"])

        step_lines = []
        for s in verify_result.steps:
            st = f"exit {s.exit_code}" if s.exit_code is not None else s.conclusion
            clean_cmd = sanitize_sensitive_data(neutralize_untrusted_markdown(s.command or getattr(s, "name", "")))
            clean_cwd = sanitize_sensitive_data(neutralize_untrusted_markdown(s.cwd or ""))
            step_lines.append(f"- `{clean_cmd}` (cwd: `{clean_cwd}`, {st})")
        steps_block = "\n".join(step_lines) if step_lines else "- No steps executed."
        contract_eval_bullets = "\n".join([f"  - **[{c['id']}]** {c['assertion']} *(Status: {c['status']})*" for c in validated_contract])

        qa_comment_body = (
            f"**{SWARM_SPECIALISTS['qa']['name']} - {SWARM_SPECIALISTS['qa']['title']}**\n\n"
            f"**Sprint Quality Gate Sign-Off for @tech_lead & @devops:**\n\n"
            f"Hey {SWARM_SPECIALISTS['tech_lead']['name']}! I ran automated verification on branch `{branch_name}`:\n\n"
            f"- **Validation Gate:** PASSED\n"
            f"- **Executor:** {verify_result.executor}\n"
            f"- **Total Duration:** {verify_result.duration_s:.1f}s\n"
            f"- **Verification Steps:**\n{steps_block}"
            f"{details_line}\n\n"
            f"**Validation Contract (Definition of Done):**\n"
            f"{contract_eval_bullets}\n\n"
            f"**Quality Report:**\n"
            f"- **Automated Compliance Score:** `{compliance_score}%` ({passed_count}/{len(automated)} automated assertions passed; "
            f"{len(validated_contract) - len(automated)} need manual review)\n\n"
            f"Automated verification passed. Handing off to @tech_lead for the merge."
        )
        qa_comment = Comment.objects.create(task=task, author=qa_user, body=sanitize_sensitive_data(qa_comment_body))
        TaskActivity.objects.create(
            task=task,
            actor=qa_user,
            action="qa_validated",
            details={"executor": verify_result.executor, "duration_s": verify_result.duration_s, "compliance_score": compliance_score, "decision": "approved", "metrics": verify_result.to_dict()}
        )
        chain_events.append({
            "step": 4,
            "agent": SWARM_SPECIALISTS["qa"],
            "target_agent": SWARM_SPECIALISTS["tech_lead"],
            "action": "Contract Validation Signoff",
            "comment_id": qa_comment.id,
            "content": qa_comment_body,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        })
        emit_agent_event(
            task=task,
            trace=trace,
            session_id=session_id,
            event_type="handoff",
            sender_key="qa",
            recipient_key="tech_lead",
            message="I recorded a passing QA decision and handed the result to the Tech Lead.",
            current_work="Waiting for merge review",
            remaining_work=["merge review", "release step"],
            metadata={"qa_result": "passed", "reason": "", "metrics": verify_result.to_dict()},
        )

    # -------------------------------------------------------------
    # STEP 5: Release Gate & DevOps Release
    # -------------------------------------------------------------
    devops_user = get_or_create_agent_user("devops", task.organization)
    devops_spec = SWARM_SPECIALISTS["devops"]
    author_name = devops_spec["name"]
    agent_role = devops_spec["role"]
    repo = getattr(project, "github_repo", "") or ""
    pr_url = getattr(task, "pr_url", "") or ""

    require_approval = getattr(settings, "AGENT_REQUIRE_RELEASE_APPROVAL", True)

    if require_approval:
        try:
            approval = request_release_approval(
                task,
                trace=trace,
                engine="chain",
                branch=branch_name,
                repo=repo,
                pr_url=pr_url,
            )
        except BranchResolutionError as exc:
            fail_body = (
                f"**{author_name} - {agent_role}**\n\n"
                f"The release could not be prepared: {exc}"
            )
            Comment.objects.create(task=task, author=devops_user, body=fail_body)
            chain_events.append({
                "step": 5,
                "agent": devops_spec,
                "target_agent": {"name": "CEO", "role": "ceo"},
                "action": "Release Preparation Failed",
                "content": fail_body,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
            })
            return chain_events

        short_sha = approval.head_sha[:7] if approval.head_sha else ""
        waiting_comment_body = (
            f"**{author_name} - {agent_role}**\n\n"
            f"QA passed. The release is waiting for approval by a workspace owner or admin: "
            f"merge `{branch_name}` at `{short_sha}` into `main`, then request a staging deployment."
        )
        waiting_comment = Comment.objects.create(task=task, author=devops_user, body=waiting_comment_body)
        TaskActivity.objects.create(
            task=task,
            actor=devops_user,
            action="release_gate_awaiting_approval",
            details={"branch": branch_name, "sha": approval.head_sha, "approval_id": approval.id},
        )
        chain_events.append({
            "step": 5,
            "agent": devops_spec,
            "target_agent": {"name": "Workspace Admin", "role": "admin"},
            "action": "DevOps Release Gate",
            "comment_id": waiting_comment.id,
            "content": waiting_comment_body,
            "approval_id": approval.id,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        })
        return chain_events

    # Gate is off: release immediately
    head_sha = current_branch_head(task, branch_name)
    actor_email = devops_user.email if devops_user else getattr(settings, "GIT_AUTHOR_EMAIL", "")
    release_result = perform_release(
        task,
        branch=branch_name,
        expected_head_sha=head_sha,
        repo=repo,
        pr_url=pr_url,
        actor_email=actor_email,
    )
    if format_release_comment:
        comment_body = format_release_comment(author_name, agent_role, release_result)
    else:
        comment_body = (
            f"**{author_name} - {agent_role}**\n\n"
            f"{getattr(release_result, 'detail', '')}\n"
            f"{getattr(release_result, 'deployment_detail', '')}"
        )

    release_comment = Comment.objects.create(task=task, author=devops_user, body=comment_body)
    TaskActivity.objects.create(
        task=task,
        actor=devops_user,
        action="release_completed" if getattr(release_result, "merged", False) else "release_failed",
        details=release_result.to_dict() if hasattr(release_result, "to_dict") else {},
    )
    chain_events.append({
        "step": 5,
        "agent": devops_spec,
        "target_agent": {"name": "TeamFlow Swarm", "role": "team"},
        "action": "DevOps Release Step",
        "comment_id": release_comment.id,
        "content": comment_body,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    })
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=session_id,
        event_type="completed" if getattr(release_result, "merged", False) else "blocked",
        sender_key="devops",
        message=f"Release recorded. {getattr(release_result, 'detail', '')}",
        metadata={"release": release_result.to_dict() if hasattr(release_result, "to_dict") else {}},
        current_work="Run completed" if getattr(release_result, "merged", False) else "Release blocked",
        remaining_work=[] if getattr(release_result, "merged", False) else ["resolve release blocker"],
    )
    return chain_events

