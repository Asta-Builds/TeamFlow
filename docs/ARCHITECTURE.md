# 🏛️ TeamFlow Architecture & Multi-Agent Swarm

TeamFlow is a **Virtual Tech Company Workspace** combining a full-stack project management platform with an autonomous, multi-agent software engineering swarm powered by **LangGraph**, **Google Antigravity SDK**, **PostgreSQL + pgvector RAG**, and local **GPU-accelerated Ollama inference**.

---

## 🏗️ High-Level System Architecture

```text
                               ┌────────────────────────────────────────────────────────┐
                               │                    👑 HUMAN CEO                        │
                               │                (ceo@teamflow.dev)                      │
                               └──────────────────────────┬─────────────────────────────┘
                                                          │ Prompts, Scope, Approvals
                                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       TEAMFLOW PLATFORM                                                │
│                                                                                                        │
│   ┌───────────────────────────────┐                  ┌──────────────────────────────────────────────┐  │
│   │     Next.js 16 App Router     │                  │             Django REST Framework            │  │
│   │   Tailwind CSS / HeroUI       │ ◄── REST/JWT ──► │  Accounts · Projects · Tasks · Deployments   │  │
│   │   Lucide Icons · Sonner       │                  │  pgvector RAG · Agent Dispatchers · Audit    │  │
│   └──────────────┬────────────────┘                  └──────────────────────┬───────────────────────┘  │
└──────────────────┼──────────────────────────────────────────────────────────┼──────────────────────────┘
                   │                                                          │
                   │ WebSocket / Polling Stream                               │ LangGraph State Machine
                   ▼                                                          ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              🤖 AUTONOMOUS AI AGENT SPECIALIST SWARM                                   │
│                                                                                                        │
│  🎯 Sarah Jenkins (Tech Lead)      ──►  Analyzes ticket, queries pgvector RAG, designs architecture    │
│           │                                                                                            │
│           ▼ (Handoff)                                                                                  │
│  💻 Marcus Aurelius (Backend)      ──►  Builds models, REST endpoints in generated_projects/ repo      │
│           │                                                                                            │
│           ▼ (Handoff)                                                                                  │
│  🎨 Cleopatra (Frontend)           ──►  Builds Next.js / HeroUI UI views, links API, pushes to QA      │
│           │                                                                                            │
│           ▼ (Handoff)                                                                                  │
│  🧪 Alan Turing (QA Engineer)      ──►  Runs automated integration suites, validates coverage > 95%    │
│           │                                                                                            │
│           ▼ (Handoff)                                                                                  │
│  🛡️ Sarah Jenkins (Tech Lead)      ──►  Reviews PR code diff & merges branch to main (Least Privilege) │
│           │                                                                                            │
│           ▼ (Handoff)                                                                                  │
│  🚀 Joan of Arc (DevOps)           ──►  Triggers staging deployment & health verification              │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                   │                                                          │
                   ▼                                                          ▼
┌──────────────────────────────────────┐                  ┌───────────────────────────────────────────┐
│     ⚡ NVIDIA GPU LOCAL INFERENCE     │                  │            OBSERVABILITY & RAG            │
│   Ollama Container (RTX 3060 12GB)   │                  │  - PostgreSQL + pgvector (Code Embeddings)│
│   Qwen2.5-Coder-7B / Hermes3-8B      │                  │  - Langfuse (Execution Traces & Spans)    │
│   Persistent VRAM & Flash Attention  │                  │  - Redis (Pub/Sub & Real-Time Sync)       │
└──────────────────────────────────────┘                  └───────────────────────────────────────────┘
```

---

## 🔒 Dedicated Project Workspace Isolation

To prevent AI agents from ever modifying the parent TeamFlow platform files, TeamFlow enforces **per-project repository isolation**:

1. **Physical Isolation:**
   - Every user project has its own workspace inside `generated_projects/<project_id>_<slug>/`.
   - The directory is completely ignored by the parent repository via `.gitignore`.
2. **Dedicated Git Lifecycle:**
   - When a project is created, Marcus Aurelius boots a standalone Git repository:
     ```bash
     cd generated_projects/<project_id>_<slug>/
     git init -b main
     ```
   - Each agent commits with their own author signature:
     - Backend: `Marcus Aurelius (AI) <backend1@teamflow.dev>`
     - Frontend: `Cleopatra (AI) <frontend1@teamflow.dev>`
     - Tech Lead: `Sarah Jenkins (AI) <lead@teamflow.dev>`
   - Branches follow semantic conventions: `feat/ticket-<id>-<slug>`.

---

## 🔄 5-Stage Kanban Decision Gate

Tickets transition automatically through a 5-stage quality pipeline:

| Status | Responsible Agent | Action |
| :--- | :--- | :--- |
| `TODO` | 👑 Human CEO / 🎯 Tech Lead | Feature request created or decomposed by Athena (PM). |
| `IN_PROGRESS` | 💻 Senior Backend | Backend service, database models, and API endpoints generated. |
| `IN_REVIEW` | 🎨 Senior Frontend | Responsive UI components developed and linked to API. |
| `QA` | 🧪 QA Engineer | Automated unit & integration tests executed; coverage evaluated. |
| `DONE` | 🛡️ Tech Lead / 🚀 DevOps | PR merged to `main` and container deployed to staging. |

---

## 📡 Real-Time Swarm Communication Stream

Agents communicate continuously via formatted inter-agent handoff comments:
- Target mentions: `🎯 [Sarah Jenkins ➔ @Marcus Aurelius]`, `💻 [Marcus Aurelius ➔ @Cleopatra]`, `🎨 [Cleopatra ➔ @Alan Turing]`.
- All dialogues and audit trails are streamed live to the frontend via `GET /api/agents/swarm-feed/?project=<id>`.
