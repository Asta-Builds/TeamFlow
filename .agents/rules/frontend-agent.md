---
title: TeamFlow Frontend Agent Architecture Rules
always_on: true
---

# TeamFlow Frontend Agent Architecture Rules

When acting as the **Senior Frontend Engineer (`frontend1@teamflow.dev`)** or generating frontend agent runtimes for TeamFlow:

## 1. Core Architecture Principles
When building a backend AI agent that serves a frontend, the architecture shifts from background task automation to handling **real-time streaming, dynamic client-side tool execution, and optimistic UI updates**.

The backend acts as the brain, but the frontend needs to display intermediate reasoning, stream partial tokens, and potentially render custom UI components directly driven by agent tool calls.

---

## 2. Core Frontend-to-Backend Agent Stack

| Layer | Responsibility | TeamFlow Implementation |
| :--- | :--- | :--- |
| **Transport / Streaming** | Real-time bidirectional or push communication for token streams, tool statuses, and UI events. | Server-Sent Events (SSE) via `/api/agents/events/stream/` |
| **Client-Side Agent Runtime** | Managing streaming chat state, tool invocation triggers, and message history on the UI. | Next.js 16 App Router, React 19, `AgentReasoningTerminal` |
| **Generative UI / Dynamic Cards** | Rendering structured interactive React components instead of plain markdown. | Dynamic component hydration (Validation Contract cards, WBS trees, PR status badges) |
| **Backend Agent Orchestrator** | Handling tool selection, session validation, authentication, and execution loops. | Python (Django REST + Antigravity SDK) + NestJS 12 Gateway + LangGraph |

---

## 3. Key Patterns for Frontend-Facing Agents

### A. Stream Intermediate Thought Steps
Instead of sending a final payload after long computation delays, emit fine-grained events over SSE:
- `{"type": "thought", "content": "Analyzing UI component requirements..."}`
- `{"type": "tool_call", "tool": "query_inventory", "args": {"sku": "A123"}}`
- `{"type": "text_delta", "content": "Found 3 items in stock."}`
- `{"type": "progress", "content": "Scaffolding component structure..."}`
- `{"type": "completed", "content": "Rendered interactive component."}`

This keeps UI latency perception strictly under **200ms**.

### B. Client-Side vs. Server-Side Tools
- **Server-Side Tools:** DB queries, internal API mutations, secret-protected endpoints (executed directly on the backend agent runtime).
- **Client-Side Tools:** Frontend actions (e.g., opening a modal, showing a toast notification, redirecting to a route, optimistic state updates). The backend yields a typed tool call event, the frontend executes the action locally in the browser, and returns the result to resume the agent's turn.

### C. Generative UI (Tool Results -> Visual Components)
When an agent retrieves structured data (e.g., Validation Contracts, DoD checks, deployment status, code diffs), yield a typed JSON payload rather than markdown text. The frontend hydrates this payload directly into an interactive React design system component.

---

## 4. Engineering & Styling Constraints
- **Framework:** Next.js 16 App Router (React 19, Turbopack).
- **Zero-Emoji UI Policy:** Never use raw emojis in UI code. Always import and render **Lucide React vector icons**.
- **Interactive Feedback:** Always use **Sonner toasts** (`toast.success()`, `toast.error()`, `toast.info()`) instead of browser dialogs or raw alerts.
- **Styling:** Modern dark theme styling using Tailwind CSS.
- **RAG Grounding:** Ground architectural decisions in PostgreSQL + pgvector RAG.
- **Observability:** Propagate `session_id = ticket-{id}` to Langfuse.
