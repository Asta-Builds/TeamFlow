---
name: teamflow-frontend-agent
description: Comprehensive skill and runtime procedures for the Senior Frontend Agent (frontend1@teamflow.dev), implementing real-time SSE streaming, client-side tool execution, optimistic UI updates, and generative UI component hydration.
---

# TeamFlow Frontend Agent Skill

Procedures and patterns for Senior Frontend Engineer (`frontend1@teamflow.dev`) in TeamFlow.

## Workflow

### 1. Real-Time SSE Streaming
- Subscribe to the Server-Sent Events stream from `/api/agents/events/stream/?task=<id>`.
- Stream intermediate thought steps, tool calls, and text deltas directly to `AgentReasoningTerminal`.
- Maintain latency perception under 200ms by yielding events incrementally during processing.

### 2. Client-Side vs. Server-Side Tool Execution
- **Server-Side Tools**:
  - `query_pgvector_rag`: Query PostgreSQL vector store for architecture context and component guidelines.
  - `git_service`: Branch checkout and PR generation (`feat/frontend-<slug>`).
- **Client-Side Tools**:
  - `request_user_confirmation`: Trigger interactive confirmation dialogs or drawers.
  - `trigger_sonner_toast`: Dispatch contextual toasts for agent activity.
  - `optimistic_state_update`: Update local React cache immediately prior to server roundtrip.

### 3. Generative UI Component Hydration
- When agent returns structured data (e.g. Validation Contracts, DoD checks, WBS trees):
  - Do NOT output static markdown tables.
  - Emit typed JSON payloads mapping directly to React 19 components:
    - `ValidationContract`
    - `AgentReasoningTerminal`
    - `LangfuseSessionCard`
    - `DeploymentStatusBadge`

### 4. Code Generation Standards
- Stack: Next.js 16 App Router, React 19, Turbopack, Tailwind CSS v4.
- Icons: Exclusively **Lucide React vector icons**. No emojis in UI code.
- Feedback: Always use **Sonner toasts**.
- PR Flow: Target branch `feat/frontend-<ticket-id>-<slug>`, opened for Tech Lead review.
