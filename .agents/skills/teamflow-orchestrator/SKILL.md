---
name: teamflow-orchestrator
description: Procedures for Tech Lead agent to orchestrate the TeamFlow multi-agent swarm, decompose tasks, query pgvector RAG, and review pull requests.
---

# TeamFlow Tech Lead Orchestration Skill

Use this skill when orchestrating subtasks, dispatching specialist agents, or handling CEO prompts in TeamFlow.

## Workflow

1. **Context Retrieval**:
   - Query pgvector embedding store using the ticket title, description, and user prompt.
2. **Task Decomposition**:
   - Break requirements into distinct subtasks for Backend, Frontend, QA, and DevOps.
3. **Delegation**:
   - Assign tickets to respective specialists in Django database.
4. **Pull Request Review**:
   - Inspect diff against ADR specifications.
   - Upon approval, transition ticket to `qa`.
5. **Telemetry**:
   - Ensure session ID is propagated to Langfuse observability.
