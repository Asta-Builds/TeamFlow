# 🏛️ TeamFlow Architecture & Multi-Agent Swarm

TeamFlow is a **Virtual Tech Company Workspace** combining a full-stack project management platform with an autonomous, multi-agent software engineering swarm powered by [NestJS 12](file:///F:/TeamFlow/backend-nest), [Django REST Framework](file:///F:/TeamFlow/backend), [LangGraph](file:///F:/TeamFlow/backend/agents/graph.py), [Google Antigravity SDK](file:///F:/TeamFlow/backend/agents/antigravity_sdk.py), and **PostgreSQL + pgvector RAG**.

> 📖 **Comprehensive Design Document:** For C4 architecture models, Strangler Fig dual-backend specifications, sandboxed Git lifecycles, and production deployment topologies, see [ARCHITECTURE_DESIGN.md](file:///F:/TeamFlow/ARCHITECTURE_DESIGN.md).

---

## 🏗️ High-Level System Architecture: Strangler Fig Pattern

TeamFlow implements the **Strangler Fig Pattern** to run a modern, high-throughput TypeScript REST API side-by-side with an autonomous Python AI agent swarm over a unified PostgreSQL database:

```mermaid
flowchart TD
    subgraph HumanLeadership["👑 Human Leadership Layer"]
        CEO["Human CEO / Founder (ceo@teamflow.dev)"]
    end

    subgraph PlatformLayer["TeamFlow Core Platform"]
        subgraph Frontend["Frontend Application (Port 3000)"]
            NextUI["Next.js 16 App Router UI"]
            Terminal["AgentReasoningTerminal (Live Stream)"]
            GenUI["Generative UI Components"]
            NextUI --- Terminal
            NextUI --- GenUI
        end

        subgraph Gateway["NestJS Core Service (Port 8001)"]
            NestApp["NestJS 12 REST API Gateway"]
            Prisma["Prisma ORM Client (Mapped via @@map)"]
            SSE["SSE Stream Distributor (/api/agents/events/stream/)"]
            NestApp --- Prisma
            NestApp --- SSE
        end

        subgraph AISwarm["Python / Django AI Swarm & Workers (Port 8000)"]
            DjangoAPI["Django 5 REST Framework"]
            GraphEngine["LangGraph StateGraph & Google Antigravity SDK"]
            Celery["Celery 5 Workers (--concurrency=2)"]
            DjangoAPI --- GraphEngine
            GraphEngine --- Celery
        end
    end

    subgraph StorageLayer["Shared Infrastructure & Storage Layer"]
        Postgres[("PostgreSQL 16 + pgvector RAG Store")]
        Redis[("Redis 7 (Pub/Sub & Celery Broker)")]
        Keycloak["Keycloak 26.1 / Clerk SSO"]
        Langfuse["Langfuse v4 (session_id = ticket-id)"]
        Sandboxes["Isolated Workspaces (generated_projects/)"]
    end

    CEO -->|"Prompts, Scope & PR Approvals"| NextUI
    NextUI -->|"REST Requests: Auth, Projects, Tasks"| NestApp
    NextUI -->|"Trigger Swarm: POST /api/agents/runs/"| DjangoAPI
    SSE -.->|"Live Sub-200ms SSE Stream"| Terminal

    NestApp <-->|"Direct Queries (Shared Relational Tables)"| Postgres
    DjangoAPI <-->|"Django ORM & Vector Searches"| Postgres
    Celery <-->|"Read & Write State"| Postgres
    
    DjangoAPI -->|"Enqueue Background Runs"| Redis
    Redis -->|"Consume Tasks"| Celery
    Celery -->|"Publish Events (agent-events-channel)"| Redis
    Redis -.->|"Event Ingestion"| SSE

    GraphEngine -->|"Traces, Spans & Token Metrics"| Langfuse
    NextApp & DjangoAPI <-->|"JWT Verification"| Keycloak
    Celery <-->|"Author-Signed Git Commits"| Sandboxes
```

---

## 🤖 The Canonical 9-Agent Specialist Swarm

The swarm architecture distributes engineering responsibilities among specialized autonomous seats defined in [`backend/agents/registry.py`](file:///F:/TeamFlow/backend/agents/registry.py):

```mermaid
graph TD
    A["👑 Human CEO Directive / Athena (PM) Task"] --> B["🎯 Sarah Jenkins (Tech Lead)"]
    B -->|"Decomposition & pgvector RAG"| C["📜 Upfront Validation Contract (VC-1..VC-5)"]
    C --> D["💻 Marcus Aurelius (Backend Core)"]
    C --> E["⚡ Julius Caesar (Backend Integrations)"]
    D --> F["🎨 Cleopatra (Frontend App)"]
    E --> F
    F --> G["📐 Alexander (Design System)"]
    G --> H["🧪 Alan Turing (QA Engineer)"]
    H -->|"Holistic Assertion Check"| I{"All Assertions Passed?"}
    I -- "Yes (100%)" --> J["🛡️ Sarah Jenkins (Tech Lead Merge to main)"]
    I -- "No (<100%)" --> K["❌ QA Rejection back to IN_PROGRESS with Diff"]
    K --> D
    J --> L["🚀 Joan of Arc (DevOps Staging Deployment)"]
    L --> M["🔍 Ada Lovelace (SEO & Web Vitals Audit)"]
```

---

## 📜 Upfront Validation Contracts (Factory 'Missions' Paradigm)

To guarantee software correctness and eliminate circular self-referential tests:

```mermaid
flowchart LR
    subgraph Phase1["1. Planning Phase"]
        PM["Athena (PM) & Sarah Jenkins (Tech Lead)"]
        Contract["Define Validation Contract (VC-1..VC-5)"]
        PM --> Contract
    end

    subgraph Phase2["2. Implementation Phase"]
        Engineers["Marcus Aurelius (Backend) & Cleopatra (Frontend)"]
        Code["Write Code & Isolated Unit Tests"]
        Engineers --> Code
    end

    subgraph Phase3["3. Independent Verification"]
        QA["Alan Turing (Independent QA Specialist)"]
        Asserts["Evaluate Atomic Contract Assertions"]
        Score["Calculate Compliance Score (0 - 100%)"]
        QA --> Asserts --> Score
    end

    subgraph Phase4["4. Gatekeeper Decision"]
        Decision{"Score == 100%?"}
        Score --> Decision
        Decision -- "Yes" --> Merge["Sarah Jenkins Merges to main"]
        Decision -- "No" --> Reject["Reject Ticket with Diff back to In-Progress"]
        Reject -.-> Engineers
    end

    Contract --> Engineers
    Code --> QA
```

1. **Defined Upfront:** Before writing code, the Tech Lead / PM establishes 5+ atomic, verifiable assertions (`VC-1` to `VC-5`).
2. **Invariants & Domain Boundaries:** Explicitly defines HTTP codes, state schemas, error payloads, and accessibility standards.
3. **Independent QA Evaluation:** Alan Turing evaluates each clause against implementation code and integration test runners, calculating the **Contract Compliance Score** (`100%`).
4. **Enforced Gatekeeper:** No pull request can be merged into `main` without 100% compliance.

---

## 🔒 Dedicated Project Workspace Isolation

To prevent AI agents from ever polluting or modifying the host TeamFlow platform code:

```mermaid
flowchart TD
    subgraph HostPlatform["Parent TeamFlow Platform (/F:/TeamFlow)"]
        HostCode["Host Codebase (Next.js, NestJS, Django, Database)"]
        GitServiceEngine["backend/agents/git_service.py"]
    end

    subgraph IsolationSandbox["Physically Isolated Sandbox Directory"]
        subgraph ProjectDir["generated_projects/project-id_slug/"]
            StandAloneGit[".git/ (Standalone Repository: branch main)"]
            SourceCode["Generated Code, Tests, Dockerfile, Docs"]
        end
    end

    subgraph AgentCommitSignatures["Author-Signed Git Commits"]
        BEAuth["Marcus Aurelius (AI) <backend1@teamflow.dev>"]
        FEAuth["Cleopatra (AI) <frontend1@teamflow.dev>"]
        TLAuth["Sarah Jenkins (AI) <lead@teamflow.dev>"]
    end

    GitServiceEngine -->|"Initialize standalone workspace (git init -b main)"| ProjectDir
    BEAuth -->|"git commit -m 'feat: api endpoint'"| SourceCode
    FEAuth -->|"git commit -m 'feat: ui page'"| SourceCode
    TLAuth -->|"git merge feat/branch into main"| StandAloneGit

    HostCode -.->|"NEVER Polluted / Read-Only Guard"| ProjectDir
```

1. **Physical Isolation:** Every user project is developed in an isolated directory ([`generated_projects/<project_id>_<slug>/`](file:///F:/TeamFlow/backend/agents/git_service.py)).
2. **Dedicated Git Lifecycle:** Marcus Aurelius initializes a standalone Git repository (`git init -b main`).
3. **Signed Commits:** Every agent signs Git commits with their real specialist identity:
   - Backend: `Marcus Aurelius (AI) <backend1@teamflow.dev>`
   - Frontend: `Cleopatra (AI) <frontend1@teamflow.dev>`
   - Tech Lead: `Sarah Jenkins (AI) <lead@teamflow.dev>`

---

## 📡 Real-Time SSE Streaming & Generative UI Pipeline

Agent reasoning, intermediate tool executions, and generative components stream continuously with sub-200ms latency:

```mermaid
sequenceDiagram
    autonumber
    actor User as Human CEO / User
    participant Terminal as AgentReasoningTerminal (UI)
    participant NestSSE as NestJS SSE Gateway (Port 8001)
    participant Redis as Redis Pub/Sub
    participant Celery as Celery Agent Worker (Port 8000)
    participant RAG as PostgreSQL (pgvector RAG)

    User->>Celery: Trigger Agent Task (POST /api/agents/runs/)
    Celery->>Redis: Publish: {"type": "started", "agent": "Athena (PM)"}
    Redis-->>NestSSE: Ingest start event
    NestSSE-->>Terminal: SSE stream: status = RUNNING

    Note over Celery, RAG: ReAct Loop & Memory Retrieval
    Celery->>RAG: Semantic search over ADRs
    Celery->>Redis: Publish: {"type": "thought", "delta": "Synthesizing schema..."}
    Redis-->>NestSSE: Push delta
    NestSSE-->>Terminal: Live thought token rendering (<200ms)

    Note over Celery, Terminal: Generative UI Hydration
    Celery->>Redis: Publish: {"type": "tool_call", "name": "render_wbs_card"}
    Redis-->>NestSSE: Push tool event
    NestSSE-->>Terminal: Hydrate interactive Generative UI card
    Terminal->>User: Display dynamic interactive card & Sonner toast
```

---

## ☁️ Production Cloud Topology on Railway

TeamFlow is architected as 5 cloud-native microservices on [Railway](https://railway.com) connected via internal private networking:

```mermaid
flowchart TB
    Internet["Internet Traffic (HTTPS)"]

    subgraph RailwayCloud["Railway Cloud Topology (eloquent-nourishment)"]
        subgraph PublicServices["Public Ingress Services"]
            FEApp["teamflow-frontend (Next.js 16 App Router)<br/>https://teamflow-frontend-production-817e.up.railway.app"]
            BEApp["teamflow-backend (Django 5 REST API)<br/>https://teamflow-backend-production-830a.up.railway.app"]
        end

        subgraph InternalServices["Private Internal Network (*.railway.internal)"]
            CeleryWorker["teamflow-celery (Background AI Worker)<br/>Start: celery worker --concurrency=2"]
            RedisStore[("teamflow-redis (Redis 7)<br/>Volume: teamflow-redis-volume")]
            PostgresStore[("teamflow-db (PostgreSQL 16 + pgvector)<br/>Volume: teamflow-db-volume")]
        end
    end

    subgraph CICDPipeline["Automated CI/CD (GitHub Actions)"]
        GitPush["git push origin main"]
        PathFilter["Paths Filter (dorny/paths-filter@v3)"]
        RedeployCmd["railway redeploy --service <name> --from-source -y"]
        GitPush --> PathFilter --> RedeployCmd
    end

    Internet -->|"User Navigation"| FEApp
    Internet -->|"API Requests & Health Checks"| BEApp

    FEApp -->|"API Calls & Auth"| BEApp
    BEApp <-->|"Relational Data & Vectors"| PostgresStore
    BEApp -->|"Task Enqueuing & State"| RedisStore

    CeleryWorker <-->|"Broker & Locks"| RedisStore
    CeleryWorker <-->|"Database State & Traces"| PostgresStore

    RedeployCmd -.->|"Zero-Downtime Rollout"| FEApp
    RedeployCmd -.->|"Zero-Downtime Rollout"| BEApp
    RedeployCmd -.->|"Zero-Downtime Rollout"| CeleryWorker
```

---

*© 2026 TeamFlow Core Engineering Team. Governed by the Google Antigravity SDK and the Virtual Tech Company Blueprint.*
