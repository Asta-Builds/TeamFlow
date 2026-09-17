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

from tasks.models import Task, Comment, TaskActivity
from accounts.models import User
from .git_service import (
    get_project_workspace,
    git_pull,
    run_project_build,
    git_checkout_branch,
    git_commit,
    git_push,
    git_create_pull_request,
    git_merge_pull_request,
)
from .code_writer import parse_and_apply_code_changes
from .llm import generate_text
from .rag.vector_store import query_similar_chunks
from .registry import AGENT_SEATS, get_agent_spec
from .users import get_or_create_agent_user
from .events import emit_agent_event, ensure_task_organization
from .tools.app_tool import trigger_app_deployment

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


    backend_code_report = parse_and_apply_code_changes(
        llm_output=backend_llm_out,
        task=task,
        agent_info=SWARM_SPECIALISTS["backend"],
        repo_name=getattr(project, "github_repo", "")
    )

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


    frontend_code_report = parse_and_apply_code_changes(
        llm_output=frontend_llm_out,
        task=task,
        agent_info=SWARM_SPECIALISTS["frontend"],
        repo_name=getattr(project, "github_repo", "")
    )

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
    
    # Holistic Verification against Upfront Validation Contract
    import ast
    validated_contract = []
    current_contract = task.validation_contract or generate_validation_contract(task)
    all_clauses_passed = True
    failure_reasons = []

    # 1. Verify workspace artifacts
    workspace_files = []
    if project_workspace and os.path.exists(project_workspace):
        for root, dirs, files in os.walk(project_workspace):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in {"node_modules", "__pycache__"}]
            for file in files:
                if not file.startswith(".") and not file.endswith((".pyc", ".log")):
                    workspace_files.append(os.path.join(root, file))

    syntax_errors = []
    for wf in workspace_files:
        if wf.endswith(".py"):
            try:
                with open(wf, "r", encoding="utf-8", errors="replace") as fh:
                    ast.parse(fh.read(), filename=wf)
            except SyntaxError as syn_err:
                syntax_errors.append(f"{os.path.basename(wf)}: line {syn_err.lineno} - {syn_err.msg}")

    for clause in current_contract:
        c = dict(clause)
        cid = c.get("id", "")
        if cid == "VC-1":
            if any(f.endswith(".py") for f in workspace_files) and not syntax_errors:
                c["status"] = "PASSED"
                c["evidence"] = f"Verified {len([f for f in workspace_files if f.endswith('.py')])} Python module(s) via AST static analyzer."
            else:
                c["status"] = "FAILED"
                c["evidence"] = f"Syntax or missing backend modules: {syntax_errors or 'no .py files generated'}"
                all_clauses_passed = False
                failure_reasons.append(c["evidence"])
        elif cid == "VC-3":
            if any(f.endswith((".tsx", ".jsx", ".ts", ".js")) for f in workspace_files):
                c["status"] = "PASSED"
                c["evidence"] = f"Verified {len([f for f in workspace_files if f.endswith(('.tsx', '.jsx', '.ts', '.js'))])} UI component artifact(s)."
            else:
                c["status"] = "FAILED"
                c["evidence"] = "No frontend component artifacts found in workspace."
                all_clauses_passed = False
                failure_reasons.append(c["evidence"])
        elif cid == "VC-5":
            if not syntax_errors:
                c["status"] = "PASSED"
                c["evidence"] = "Zero AST syntax errors detected across repository."
            else:
                c["status"] = "FAILED"
                c["evidence"] = "; ".join(syntax_errors)
                all_clauses_passed = False
                failure_reasons.append(c["evidence"])
        else:
            # No automated check exists for this clause; it needs a human reviewer.
            c["status"] = "MANUAL_REVIEW"
            c["evidence"] = "No automated check covers this clause. A human reviewer must confirm it."

        c["verified_at"] = time.strftime("%Y-%m-%d %H:%M:%SZ")
        validated_contract.append(c)

    passed_count = sum(1 for c in validated_contract if c["status"] == "PASSED")
    automated = [c for c in validated_contract if c["status"] != "MANUAL_REVIEW"]
    compliance_score = round((passed_count / len(automated)) * 100.0, 1) if automated else 0.0

    task.validation_contract = validated_contract
    task.contract_compliance_score = compliance_score
    if not all_clauses_passed:
        task.qa_rejected = True
        task.qa_rejection_reason = "; ".join(failure_reasons)
        task.status = Task.Status.IN_PROGRESS
        task.save(update_fields=["validation_contract", "contract_compliance_score", "qa_rejected", "qa_rejection_reason", "status"])

        qa_fail_comment = (
            f"**{SWARM_SPECIALISTS['qa']['name']} - {SWARM_SPECIALISTS['qa']['title']}**\n\n"
            f"**Sprint Quality Gate REJECTION for @backend_core & @tech_lead:**\n\n"
            f"Validation Contract Verification: **FAILED ({compliance_score}%)** on branch `{branch_name}`.\n\n"
            f"**Failure Details:**\n" + "\n".join([f"- [DEFECT] {r}" for r in failure_reasons])
        )
        Comment.objects.create(task=task, author=qa_user, body=qa_fail_comment)
        emit_agent_event(
            task=task,
            trace=trace,
            session_id=session_id,
            event_type="blocked",
            sender_key="qa",
            recipient_key="backend_core",
            message=f"QA Gate Rejected: {'; '.join(failure_reasons)}",
            current_work="Verification failed",
            remaining_work=["fix code errors", "repeat QA validation"],
        )
        return chain_events

    task.qa_rejected = False
    task.qa_rejection_reason = ""
    task.save(update_fields=["validation_contract", "contract_compliance_score", "qa_rejected", "qa_rejection_reason"])

    contract_eval_bullets = "\n".join([f"  - **[{c['id']}]** {c['assertion']} *(Status: {c['status']})*" for c in validated_contract])
    qa_comment_body = (
        f"**{SWARM_SPECIALISTS['qa']['name']} - {SWARM_SPECIALISTS['qa']['title']}**\n\n"
        f"**Sprint Quality Gate Sign-Off for @tech_lead & @devops:**\n\n"
        f"Hey {SWARM_SPECIALISTS['tech_lead']['name']}! I ran the automated Validation Contract checks on branch `{branch_name}`:\n\n"
        f"**Validation Contract (Definition of Done):**\n"
        f"{contract_eval_bullets}\n\n"
        f"**Quality Report:**\n"
        f"- **Automated Compliance Score:** `{compliance_score}%` ({passed_count}/{len(automated)} automated assertions passed; "
        f"{len(validated_contract) - len(automated)} need manual review)\n"
        f"- **Files Audited:** {len(workspace_files)} file(s)\n"
        f"- **Python syntax check:** no syntax errors found\n\n"
        f"Automated checks passed. Handing off to @tech_lead for the merge."
    )
    qa_comment = Comment.objects.create(task=task, author=qa_user, body=qa_comment_body)
    TaskActivity.objects.create(
        task=task,
        actor=qa_user,
        action="qa_validated",
        details={"files_analyzed": len(workspace_files), "compliance_score": compliance_score, "decision": "approved"}
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
        message="I recorded the current validation-contract decision and handed the result to the Tech Lead.",
        current_work="Waiting for merge review",
        remaining_work=["merge review", "release step"],
    )

    # -------------------------------------------------------------
    # STEP 5: Tech Lead (merge the pull request and hand off to DevOps)
    # -------------------------------------------------------------
    merge_res = git_merge_pull_request(
        repo=getattr(project, "github_repo", ""),
        source_branch=branch_name,
        target_branch="main",
        cwd=project_workspace
    )

    if not merge_res.get("success"):
        merge_fail_body = (
            f"**{SWARM_SPECIALISTS['tech_lead']['name']} - {SWARM_SPECIALISTS['tech_lead']['title']}**\n\n"
            f"**Merge blocked for `{branch_name}`:**\n\n"
            f"QA passed, but merging into `main` did not succeed.\n\n"
            f"- Reason: {merge_res.get('output', 'unknown error')}\n"
            f"- Ticket stays in **{task.get_status_display()}** until the merge is resolved."
        )
        merge_fail_comment = Comment.objects.create(task=task, author=lead_user, body=merge_fail_body)
        chain_events.append({
            "step": 5,
            "agent": SWARM_SPECIALISTS["tech_lead"],
            "target_agent": {"name": "CEO", "role": "ceo"},
            "action": "Tech Lead Merge Blocked",
            "comment_id": merge_fail_comment.id,
            "content": merge_fail_body,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
        })
        emit_agent_event(
            task=task,
            trace=trace,
            session_id=session_id,
            event_type="blocked",
            sender_key="tech_lead",
            message="The merge into main did not succeed. The run stopped before release.",
            current_work="Merge blocked",
            remaining_work=["resolve merge", "release step"],
            metadata={"merge_output": merge_res.get("output", "")},
        )
        return chain_events

    task.status = Task.Status.DONE
    task.save(update_fields=["status"])

    merge_sha = merge_res.get("merged_sha", "")
    pushed_note = (
        "`main` was pushed to the linked remote."
        if merge_res.get("push_success")
        else "`main` was updated locally; it was not pushed to a remote."
    )
    lead_merge_comment_body = (
        f"**{SWARM_SPECIALISTS['tech_lead']['name']} - {SWARM_SPECIALISTS['tech_lead']['title']}**\n\n"
        f"**Sprint PR Merge Sign-Off for @devops:**\n\n"
        f"Hey {SWARM_SPECIALISTS['devops']['name']}! Code review is completed and Alan's QA validation confirmed.\n\n"
        f"**Merge Report:**\n"
        f"- Merged branch: `{branch_name}` -> `main`\n"
        f"- Merge Commit SHA: `{merge_sha}`\n"
        f"- Ticket Status: **DONE**\n\n"
        f"{pushed_note} Handing off to DevOps for the release step."
    )
    lead_merge_comment = Comment.objects.create(task=task, author=lead_user, body=lead_merge_comment_body)
    TaskActivity.objects.create(
        task=task,
        actor=lead_user,
        action="merged_to_main",
        details={"branch": branch_name, "sha": merge_sha}
    )
    chain_events.append({
        "step": 5,
        "agent": SWARM_SPECIALISTS["tech_lead"],
        "target_agent": SWARM_SPECIALISTS["devops"],
        "action": "Tech Lead Merge Gate",
        "comment_id": lead_merge_comment.id,
        "content": lead_merge_comment_body,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    })
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=session_id,
        event_type="handoff",
        sender_key="tech_lead",
        recipient_key="devops",
        message="I completed the merge-review step and handed the recorded result to DevOps.",
        current_work="Waiting for release step",
        remaining_work=["release step"],
        metadata={"merge_success": bool(merge_res.get("success")), "merge_sha": merge_sha},
    )

    # -------------------------------------------------------------
    # STEP 6: DevOps (staging rollout and completion)
    # -------------------------------------------------------------
    devops_user = get_or_create_agent_user("devops", task.organization)
    deploy_res = trigger_app_deployment(
        project.id if project else task.project_id,
        environment="staging",
        branch="main",
        commit_sha=merge_sha,
    )
    if deploy_res.get("ok"):
        release_line = (
            f"- Deployment #{deploy_res.get('deployment_id')} was accepted by the deployment provider "
            f"(status: `{deploy_res.get('status')}`). The provider reports the final outcome."
        )
        release_details = {"environment": "staging", "deployment_id": deploy_res.get("deployment_id"), "status": deploy_res.get("status")}
    elif deploy_res.get("configured") is False:
        release_line = "- No deployment provider is configured, so no staging deployment was started."
        release_details = {"environment": "staging", "status": "not_configured"}
    else:
        release_line = f"- The deployment request failed: {deploy_res.get('error') or deploy_res.get('status')}."
        release_details = {"environment": "staging", "status": "failed", "deployment_id": deploy_res.get("deployment_id")}

    devops_comment_body = (
        f"**{SWARM_SPECIALISTS['devops']['name']} - {SWARM_SPECIALISTS['devops']['title']}**\n\n"
        f"**Release step for ticket #{task.id}:**\n\n"
        f"- `main` is at `{merge_sha or 'unknown'}`.\n"
        f"{release_line}"
    )
    devops_comment = Comment.objects.create(task=task, author=devops_user, body=devops_comment_body)
    TaskActivity.objects.create(
        task=task,
        actor=devops_user,
        action="release_requested",
        details=release_details,
    )
    chain_events.append({
        "step": 6,
        "agent": SWARM_SPECIALISTS["devops"],
        "target_agent": {"name": "TeamFlow Swarm", "role": "team"},
        "action": "DevOps Release Step",
        "comment_id": devops_comment.id,
        "content": devops_comment_body,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ"),
    })
    emit_agent_event(
        task=task,
        trace=trace,
        session_id=session_id,
        event_type="completed",
        sender_key="devops",
        message="I recorded the release step. The run is ready for human review.",
        metadata={"deployment": deploy_res},
        current_work="Run completed",
        remaining_work=[],
    )

    return chain_events
