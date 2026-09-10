# 🚀 TeamFlow: Virtual Tech Company Platform & Autonomous Multi-Agent Swarm

<div align="center">

![Next.js 16](https://img.shields.io/badge/Next.js%2016-black?style=for-the-badge&logo=next.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS%20API-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![Django REST](https://img.shields.io/badge/Django%20REST-092E20?style=for-the-badge&logo=django&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-Multi--Agent-blue?style=for-the-badge&logo=langchain&logoColor=white)
![Google Antigravity](https://img.shields.io/badge/Google%20Antigravity%20SDK-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma%20ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![PostgreSQL pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker%20Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)

**An autonomous AI software company platform where specialized agents plan, code, review, test, and deploy full-stack applications in isolated repositories.**

[📋 Spécification Fonctionnelle](./docs/SPECIFICATION_FONCTIONNELLE.md) • [🏛️ Architecture](./docs/ARCHITECTURE.md) • [⚡ NestJS Migration](./docs/NESTJS_MIGRATION.md) • [🚀 Self-Hosting & Deployment](./docs/HOSTING_AND_DEPLOYMENT.md) • [📡 API & Agent Workflow](./docs/API_AND_AGENT_WORKFLOW.md) • [🧭 Blueprint Implementation](./docs/BLUEPRINT_IMPLEMENTATION.md) • [🔄 Session Resume](./docs/SESSION_RESUME.md)

</div>

---

## 🏛️ New System Architecture: Strangler Fig Pattern

TeamFlow combines a high-throughput, type-safe application API with an autonomous AI engineering swarm running over a unified, shared PostgreSQL (`pgvector`) data store.

```mermaid
flowchart TD
    subgraph HumanLayer["👑 Human Leadership"]
        CEO["Human CEO / Founder (ceo@teamflow.dev)"]
    end

    subgraph FrontendLayer["🌐 Frontend Application (Port 3000)"]
        NextApp["Next.js 16 App Router (React 19, Turbopack)"]
        ReasoningTerminal["AgentReasoningTerminal (Live Thought & Tool Stream)"]
        GenerativeUI["Generative UI (Validation Contracts & WBS Dynamic Cards)"]
        NextApp --- ReasoningTerminal
        NextApp --- GenerativeUI
    end

    subgraph GatewayLayer["⚡ API Gateway & Event Distributor (Port 8001)"]
        NestAPI["NestJS 12 REST API Gateway"]
        SSEDistributor["SSE Event Stream Distributor (/api/agents/events/stream/)"]
        PrismaORM["Prisma ORM Client (Type-Safe Database Mapping)"]
        NestAPI --- SSEDistributor
        NestAPI --- PrismaORM
    end

    subgraph AIWorkerLayer["🤖 Autonomous Agent Engine & Swarm (Port 8000)"]
        DjangoREST["Django REST Framework + Celery Workers"]
        AntigravityEngine["Google Antigravity SDK & LangGraph Swarm"]
        SpecialistAgents["Specialist Swarm: Athena PM, Frontend, Backend, QA, DevOps"]
        GitService["Git Service & Workspace Sandbox (generated_projects/)"]
        DjangoREST --- AntigravityEngine
        AntigravityEngine --- SpecialistAgents
        AntigravityEngine --- GitService
    end

    subgraph StorageLayer["🗄️ Shared Infrastructure & Storage"]
        PostgresDB[("PostgreSQL 16 + pgvector Vector Store")]
        RedisBroker[("Redis 7 (Pub/Sub & Celery Broker)")]
        KeycloakSSO["Keycloak 26.1 (OAuth 2.0 / OpenID Connect)"]
        LangfuseObs["Langfuse v4 Tracing (session_id=ticket-{id})"]
    end

    CEO -->|"Directives, Scope & PR Approvals"| NextApp
    NextApp -->|"REST Requests (Auth, Projects, Tasks, Billing)"| NestAPI
    NextApp -->|"AI Agent Prompts & Triggers"| DjangoREST
    SSEDistributor -.->|"Real-Time SSE Stream (<200ms latency)"| ReasoningTerminal

    NestAPI <-->|"Shared Relational Tables (@@map)"| PostgresDB
    DjangoREST <-->|"Django ORM & pgvector Embeddings"| PostgresDB
    DjangoREST <-->|"Task Queues & State Events"| RedisBroker
    RedisBroker -.->|"Event Ingestion (Pub/Sub)"| SSEDistributor

    AntigravityEngine -->|"Trace Telemetry & Token Logs"| LangfuseObs
    NestAPI & DjangoREST <-->|"JWT Auth Verification"| KeycloakSSO
```

---

### 📡 Real-Time Streaming & Agent-to-Frontend Workflow

```mermaid
sequenceDiagram
    autonumber
    actor CEO as Human CEO / Founder
    participant UI as Next.js 16 Frontend
    participant Gateway as NestJS 12 Gateway (SSE)
    participant Redis as Redis Pub/Sub
    participant Engine as Antigravity Agent Engine (Django)
    participant RAG as PostgreSQL (pgvector)
    participant Langfuse as Langfuse Tracing

    CEO->>UI: Prompts agent (@pm or @frontend)
    UI->>Engine: POST /api/agents/runs/ (Prompt, Task ID)
    Engine->>Langfuse: Initialize trace (session_id = ticket-{id})
    Engine->>Redis: Publish event: status = RUNNING
    Redis-->>Gateway: Ingest event
    Gateway-->>UI: SSE: {"type": "started", "agent": "Athena (AI)"}

    Note over Engine, RAG: ReAct Loop & Vector Memory Retrieval
    Engine->>RAG: Semantic search over ADRs and codebase embeddings
    Engine->>Redis: Publish event: type = "thought", "Evaluating architecture..."
    Gateway-->>UI: SSE: Stream intermediate thought delta (<200ms)
    UI->>UI: Update AgentReasoningTerminal live beacon

    Note over Engine, UI: Client-Side vs. Server-Side Tool Execution
    Engine->>Engine: Server Tool: Scaffold component & WBS decomposition
    Engine->>Redis: Publish event: type = "tool_call", "scaffold_generative_ui"
    Gateway-->>UI: SSE: Stream tool invocation & Generative UI payload
    UI->>UI: Dynamically hydrate interactive Generative UI component

    alt Client Action Required
        UI->>CEO: Render interactive client modal / Sonner toast
        CEO->>UI: Confirm client action (e.g. approve WBS or scope)
        UI->>Engine: Return client tool execution payload
    end

    Engine->>Engine: Server Tool: Checkout branch & open GitHub PR
    Engine->>Redis: Publish event: type = "completed", status = IN_REVIEW
    Gateway-->>UI: SSE: Complete stream & render PR badge
    Engine->>Langfuse: Record trace metrics (tokens, cost, duration)
```

---

## 🌟 Key Highlights

- **👑 Human CEO Control:** You issue directives, approve roadmap budgets, and prompt specialist agents via `@agent` tags.
- **⚡ Strangler Fig Hybrid Backend:**
  - **`backend-nest/` (Port 8001):** High-throughput, type-safe NestJS + Prisma ORM backend serving application REST endpoints, authentication, projects, tasks, and billing.
  - **`backend/` (Port 8000):** Python / Django backend hosting the LangGraph autonomous multi-agent swarm, Celery queues, and pgvector embeddings.
  - **Shared Database:** Both backends query the exact same PostgreSQL database without downtime or data migration.
- **💓 Engineering Pulse Cockpit (`/pulse`):** Real-time team velocity, active agent execution queues, private daily scratchpad, time blocking, and focus timer.
- **📜 Factory 'Missions' Upfront Validation Contracts (Definition of Done):**
  - Independent assertions (`VC-1` to `VC-5`) established upfront during planning *before* code is written.
  - Evaluated holistically by QA, generating an objective **Contract Compliance Score** (`100%`) without circular self-referential test bias.
- **🔒 Dedicated Repository Isolation:** Every user project is developed in an isolated directory (`generated_projects/<id>_<slug>/`) with its own standalone Git repository and author signatures. The parent TeamFlow platform is never polluted.
- **📡 Real-Time Swarm Live Stream:** Interactive UI modal with auto-sync (3.5s) streaming inter-agent dialogues (`➔ @Marcus Aurelius`), status transitions, and unified code diffs.
- **📊 Enterprise Observability:** Every agent invocation is traced to **Langfuse** with `session_id = ticket-{id}` and grounded in **pgvector RAG**.
- **🛡️ Production-Grade Security:** Hardened multi-tenant access, Keycloak SSO integration, and removal of hardcoded demo credentials.

---

## 🤖 Canonical 9-Agent Specialist Swarm

Aligned with the Virtual Tech Company Blueprint (`backend/agents/registry.py`):

| Agent Key | Specialist Name | Autonomous Ownership & Responsibilities |
| :--- | :--- | :--- |
| **`tech_lead`** | **Sarah Jenkins** | Architecture design, task decomposition, pgvector RAG, exclusive merge authority to `main`. |
| **`backend_core`** | **Marcus Aurelius** | Core APIs, database models, business logic, signed Git commits. |
| **`backend_integrations`** | **Julius Caesar** | Third-party integrations, Redis/Celery queue jobs, data pipelines. |
| **`frontend_app`** | **Cleopatra** | Next.js 16 application surfaces, API integration, client state management. |
| **`frontend_design_system`**| **Alexander** | Shared UI component library, design system tokens, frontend quality. |
| **`devops`** | **Joan of Arc** | CI/CD pipelines, Docker container environments, staging releases, 1-click rollback. |
| **`qa`** | **Alan Turing** | 5-stage Kanban decision gate, holistic Validation Contract verification, regression suites. |
| **`designer`** | **Leonardo Da Vinci** | UI/UX wireframes, design tokens, WCAG AA accessibility ergonomics. |
| **`seo`** | **Ada Lovelace** | Technical SEO audits, Core Web Vitals (FCP, LCP, CLS, TTFB), search performance. |
| **`pm`** | **Athena** | Natural language roadmap decomposition into structured, auto-assigned backlog tickets. |

```mermaid
flowchart LR
    CEO["👑 Human CEO<br/>Directives & Scope"] --> PM["🧠 Athena (PM)<br/>WBS & Validation Contract"]
    PM --> TL["🎯 Sarah (Tech Lead)<br/>Architecture & RAG Query"]
    TL --> BE["💻 Marcus (Backend)<br/>APIs & Django Models"]
    TL --> FE["🌐 Cleopatra (Frontend)<br/>Next.js 16 & Dynamic UI"]
    BE --> QA["🧪 Alan (QA)<br/>Contract Verification"]
    FE --> QA
    QA -->|Passed 100%| MRG["🛡️ Tech Lead<br/>Merge to main"]
    QA -->|Rejected| BE
    MRG --> OPS["🚀 Joan (DevOps)<br/>Staging Release"]
    OPS --> SEO["🔍 Ada (SEO)<br/>Web Vitals Audit"]
```

---

## 🏗️ Repository Layout

```text
TeamFlow/
├── backend-nest/             # NestJS 12 REST API (TypeScript + Prisma ORM + Vitest)
│   ├── src/                  # Auth, Users, Projects, Tasks, Pulse, Deployments, SEO, Billing
│   ├── prisma/schema.prisma  # Schema mapped directly to shared PostgreSQL tables via @@map
│   └── Dockerfile            # Optimized multi-stage production container
├── backend/                  # Python / Django AI Swarm & Worker
│   ├── accounts/             # User models, Keycloak SSO integration, permissions
│   ├── agents/               # LangGraph swarm nodes, agent registry, Celery tasks, RAG
│   ├── projects/             # Multi-tenant projects and isolated repo bootstrap
│   ├── tasks/                # 5-stage Kanban tickets, validation contracts, comments, audit
│   ├── pulse/                # Team velocity, scratchpads, focus session tracking
│   └── deployments/          # Staging releases and CI/CD simulation
├── frontend/                 # Next.js 16 App Router (TypeScript + Tailwind CSS v4 + HeroUI)
│   ├── src/app/(app)/        # Dashboard, Kanban, Pulse, Team, Deployments, Settings
│   └── src/lib/              # API client, Keycloak auth, types, and UI components
├── docs/                     # Detailed architecture, hosting & API guides
│   ├── ARCHITECTURE.md       # Multi-agent state machine and RAG design
│   ├── NESTJS_MIGRATION.md   # Strangler Fig pattern & NestJS endpoint specifications
│   ├── SPECIFICATION_FONCTIONNELLE.md # Comprehensive functional specification
│   ├── HOSTING_AND_DEPLOYMENT.md # Production Docker, GPU pass-through, SSL & Cloud
│   ├── API_AND_AGENT_WORKFLOW.md # REST endpoints & Autonomous swarm chain docs
│   └── BLUEPRINT_IMPLEMENTATION.md # Virtual Tech Company blueprint compliance
├── generated_projects/       # Isolated project workspaces developed by AI agents
└── docker-compose.yml        # Full-stack composition (DB, Redis, Backend, NestJS, Frontend, Langfuse)
```

---

## ⚡ Quickstart (Local Docker Stack)

Before launching, configure the required secrets in the root `.env` as described in
[the NestJS security setup guide](docs/NESTJS_SECURITY_SETUP.md).

Launch the entire stack with:

```bash
docker compose up --build -d
```

### Accessing Services

| Service | Port / URL | Description |
| :--- | :--- | :--- |
| **Frontend Application** | [http://localhost:3000](http://localhost:3000) | Next.js 16 App Router UI (Dashboard, Kanban, Pulse) |
| **NestJS REST API** | [http://localhost:8001/api/docs](http://localhost:8001/api/docs) | Core high-throughput TypeScript API & Swagger Docs |
| **Django Backend API** | [http://localhost:8000/api/docs/](http://localhost:8000/api/docs/) | Python AI Swarm, LangGraph nodes & Celery worker |
| **Keycloak SSO** | [http://localhost:8080](http://localhost:8080) | Identity Provider & OAuth 2.0 / OpenID Connect |
| **Langfuse Observability** | [http://localhost:3001](http://localhost:3001) | Agent execution traces & LLM observability |
| **PostgreSQL (pgvector)** | `localhost:5432` | Shared relational database with vector embeddings |
| **Redis Cache** | `localhost:6379` | Cache, message queue, and Celery broker |

---

## 📖 Documentation & Guides

- 🏛️ [**Architecture & Multi-Agent Swarm**](./docs/ARCHITECTURE.md) : Detailed breakdown of LangGraph nodes, pgvector RAG store, Git lifecycle, and Kanban quality gates.
- ⚡ [**NestJS Migration Blueprint**](./docs/NESTJS_MIGRATION.md) : Strangler Fig pattern, Prisma schema mapping, module architecture, and switching frontend APIs.
- 📋 [**Spécification Fonctionnelle Détaillée**](./docs/SPECIFICATION_FONCTIONNELLE.md) : Functional requirements and feature matrices.
- 🚀 [**Hosting & Production Deployment**](./docs/HOSTING_AND_DEPLOYMENT.md) : Step-by-step production hosting with NVIDIA GPU pass-through, Nginx SSL, Keycloak SSO, and 1-click cloud deploy (Render, Railway, K8s).
- 📡 [**API & Swarm Workflow Reference**](./docs/API_AND_AGENT_WORKFLOW.md) : Complete REST API documentation and inter-agent communication specifications.
- 🧭 [**Blueprint Implementation Status**](./docs/BLUEPRINT_IMPLEMENTATION.md) : Tracking alignment with the Virtual Tech Company Blueprint.

---

## 📄 License

MIT License © 2026 TeamFlow Core Engineering Team.
