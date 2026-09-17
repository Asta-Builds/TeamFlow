"""
Product Manager (PM) AI Service for TeamFlow.
Decomposes high-level CEO plans and user visions into engineering tickets,
assigns specialist AI agents, and generates collaborative dialogue.
"""

import re
import json
import logging
from typing import List, Dict, Any, Optional

from tasks.models import Task, Comment, TaskActivity
from notifications.models import Notification
from projects.models import Project
from .tools.rag_tool import retrieve_context
from .users import get_or_create_agent_user
from .llm import require_text, ModelResponseInvalid

logger = logging.getLogger(__name__)


def decompose_plan_and_create_tasks(
    project: Project,
    plan_text: str,
    creator_user: Any
) -> Dict[str, Any]:
    """
    Takes a product plan, dynamically decomposes it into structured tickets using
    LLM reasoning, assigns specialist agents, generates collaborative comments, and logs activities.
    """
    pm_user = get_or_create_agent_user("pm", project.organization)
    ceo_user = creator_user if creator_user and getattr(creator_user, "is_authenticated", False) else pm_user

    rag_chunks = retrieve_context(f"{project.name} {plan_text}", project_id=project.id)

    clean_plan = plan_text.strip()
    summary_title = clean_plan.split("\n")[0].replace("#", "").replace("@pm", "").strip()[:80] or project.name
    ceo_name = getattr(ceo_user, "name", "CEO") or "CEO"
    pm_name = getattr(pm_user, "name", "PM") or "PM"
    project_name = project.name
    project_desc = getattr(project, "description", "") or ""

    system_prompt = (
        f"You are {pm_name}, Senior AI Product Manager & Delivery Architect at TeamFlow.\n"
        f"You are collaborating with the CEO / founder ({ceo_name}) on project '{project_name}' (Overview: {project_desc}).\n"
        f"Codebase RAG Context:\n" + ("\n".join(rag_chunks[:3]) if rag_chunks else "Standard project architecture.") + "\n\n"
        f"INSTRUCTIONS:\n"
        f"Decompose the CEO's product plan into 2 to 4 distinct, concrete, production-grade Scrum sprint tickets.\n"
        f"Follow strict Scrum format for every ticket:\n"
        f"- User Story: 'As a [Role], I want [Feature] so that [Benefit]'\n"
        f"- Story Points estimate (1, 2, 3, 5, or 8)\n"
        f"- Gherkin Acceptance Criteria: Given / When / Then\n"
        f"- Definition of Done (DoD)\n"
        f"- Specialist @mention suggestion (@backend_core, @frontend_app, @qa, @devops)\n"
        f"Do NOT output generic templates. Every ticket MUST be tailored directly to the specific features in the plan.\n"
        f"Output MUST be a single valid JSON object in this exact schema with NO markdown wrapping:\n"
        f'{{\n'
        f'  "pm_summary": "Conversational 2-sentence note from {pm_name} to {ceo_name} summarizing the sprint delivery plan.",\n'
        f'  "tickets": [\n'
        f'    {{\n'
        f'      "title": "[Domain] Specific Feature Title",\n'
        f'      "type": "feature" | "task" | "bug",\n'
        f'      "priority": "low" | "medium" | "high" | "urgent",\n'
        f'      "description": "Scrum specification with User Story, Story Points, Gherkin Acceptance Criteria, and Definition of Done.",\n'
        f'      "dialogue": "Warm, senior 1-sentence note from {pm_name} to @{ceo_name.split()[0]} introducing this ticket."\n'
        f'    }}\n'
        f'  ]\n'
        f'}}'
    )

    user_prompt = f"CEO Product Plan to Decompose:\n{clean_plan}"

    # 1. Attempt dynamic LLM decomposition
    llm_output = require_text(system_prompt, user_prompt)
    decomposed_data = None

    try:
        # Extract JSON block
        json_match = re.search(r"\{.*\}", llm_output, re.DOTALL)
        if json_match:
            parsed = json.loads(json_match.group(0))
            if isinstance(parsed, dict) and "tickets" in parsed and isinstance(parsed["tickets"], list) and parsed["tickets"]:
                decomposed_data = parsed
    except Exception as parse_err:
        logger.warning(f"Failed to parse LLM decomposition JSON: {parse_err}")

    if not decomposed_data:
        raise ModelResponseInvalid()

    tickets_spec = decomposed_data.get("tickets", [])
    pm_summary = decomposed_data.get(
        "pm_summary",
        f"Created {len(tickets_spec)} tickets."
    )

    # 3. Persist Tasks and Human-like Dialogue in Database
    created_tasks = []
    for spec in tickets_spec:
        raw_type = str(spec.get("type", "feature")).lower()
        task_type = Task.Type.BUG if raw_type == "bug" else Task.Type.TASK if raw_type == "task" else Task.Type.FEATURE

        raw_priority = str(spec.get("priority", "medium")).lower()
        priority_map = {
            "low": Task.Priority.LOW,
            "medium": Task.Priority.MEDIUM,
            "high": Task.Priority.HIGH,
            "urgent": Task.Priority.URGENT,
        }
        priority = priority_map.get(raw_priority, Task.Priority.MEDIUM)

        task = Task.objects.create(
            project=project,
            organization=project.organization,
            created_by=ceo_user,
            assignee=ceo_user,
            title=spec.get("title", f"Sprint Item: {summary_title}"),
            description=spec.get("description", ""),
            task_type=task_type,
            priority=priority,
            status=Task.Status.TODO,
        )
        created_tasks.append(task)

        # Log Task Activity
        TaskActivity.objects.create(
            task=task,
            actor=pm_user,
            action="created_task",
            details={"source": "athena_ai_pm_plan_decomposition", "plan_snippet": clean_plan[:100]}
        )

        # Create natural dialogue comment from the PM, if provided by the model
        dialogue_text = spec.get("dialogue")
        if dialogue_text:
            Comment.objects.create(
                task=task,
                author=pm_user,
                body=dialogue_text,
            )

    # 4. Create Notification for CEO
    if creator_user and creator_user != pm_user:
        Notification.objects.create(
            recipient=creator_user,
            actor=pm_user,
            title=f"{pm_name} (PM) Decomposed Your Plan",
            message=f"Created {len(created_tasks)} engineering sprint tickets for '{summary_title}'.",
            link=f"/projects/{project.id}",
            organization=project.organization,
        )

    return {
        "ok": True,
        "project_id": project.id,
        "tasks_created_count": len(created_tasks),
        "tasks": created_tasks,
        "pm_summary": pm_summary,
    }

