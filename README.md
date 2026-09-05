# 🚀 TeamFlow: Virtual Tech Company Platform & Autonomous Multi-Agent Swarm

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js%2016-black?style=for-the-badge&logo=next.js&logoColor=white)
![Django REST](https://img.shields.io/badge/Django%20REST-092E20?style=for-the-badge&logo=django&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-Multi--Agent-blue?style=for-the-badge&logo=langchain&logoColor=white)
![Google Antigravity](https://img.shields.io/badge/Google%20Antigravity%20SDK-4285F4?style=for-the-badge&logo=google&logoColor=white)
![PostgreSQL pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![NVIDIA CUDA](https://img.shields.io/badge/NVIDIA-CUDA%20RTX%203060-76B900?style=for-the-badge&logo=nvidia&logoColor=white)

**An autonomous AI software company where specialized agents plan, code, review, test, and deploy full-stack applications in isolated repositories.**

[📋 Spécification Fonctionnelle](./docs/SPECIFICATION_FONCTIONNELLE.md) • [🏛️ Architecture](./docs/ARCHITECTURE.md) • [🚀 Self-Hosting & Deployment](./docs/HOSTING_AND_DEPLOYMENT.md) • [📡 API & Agent Workflow](./docs/API_AND_AGENT_WORKFLOW.md) • [🧭 Blueprint Implementation](./docs/BLUEPRINT_IMPLEMENTATION.md) • [🔄 Session Resume](./docs/SESSION_RESUME.md)

</div>

---

## 🌟 Key Highlights

- **👑 Human CEO Control:** You issue directives, approve roadmap budgets, and prompt specialist agents via `@agent` tags.
- **🤖 Autonomous Specialist Swarm:**
  - 🎯 **Sarah Jenkins (Tech Lead):** RAG queries, architectural planning, and exclusive merge authority to `main`.
  - 💻 **Marcus Aurelius (Senior Backend):** Django / FastAPI REST endpoints, SQL schemas, and signed Git commits.
  - 🎨 **Cleopatra (Senior Frontend):** Next.js 16 App Router, HeroUI / Tailwind CSS, Lucide icons, Sonner toasts.
  - 🧪 **Alan Turing (QA Engineer):** Automated integration suites, boundary testing, 5-stage Kanban decision gates.
  - 🚀 **Joan of Arc (DevOps Engineer):** Docker container staging, live rollout verification, and instant rollback.
  - 🧠 **Athena (Product Manager):** Decomposes natural language roadmaps into assigned, structured backlog tickets.
- **🔒 Dedicated Repository Isolation:** Every user project is developed in an isolated directory (`generated_projects/<id>_<slug>/`) with its own standalone Git repository. The parent TeamFlow platform is never polluted.
- **📡 Real-Time Swarm Live Stream:** Interactive UI modal with auto-sync (3.5s) streaming inter-agent dialogues (`➔ @Marcus Aurelius`) and handoffs.
- **⚡ Local GPU Inference:** Optional private inference through Ollama on local **NVIDIA CUDA GPUs**. No model is bundled or preloaded; choose and provision a model for the environment that needs it.
- **📊 Enterprise Observability:** Every agent invocation is traced to **Langfuse** with `session_id = ticket-{id}` and grounded in **pgvector RAG**.

---

## 🏗️ Repository Layout

```text
TeamFlow/
├── backend/                  # Django REST Framework backend
│   ├── accounts/             # JWT auth, organizations, and user roles
│   ├── agents/               # Multi-agent swarm, LangGraph nodes, RAG, Ollama service
│   ├── projects/             # Multi-tenant projects and isolated repo bootstrap
│   ├── tasks/                # 5-stage Kanban tickets, comments, and audit activity
│   └── deployments/          # Staging releases and CI/CD simulation
├── frontend/                 # Next.js 16 App Router (TypeScript + Tailwind + HeroUI)
│   ├── src/app/(app)/        # Dashboard, Project Kanban board, Team & Live Feed
│   └── src/lib/api.ts        # API client and Swarm stream endpoints
├── docs/                     # Detailed architecture, hosting & API guides
│   ├── ARCHITECTURE.md       # Multi-agent state machine and RAG design
│   ├── HOSTING_AND_DEPLOYMENT.md # Production Docker, GPU pass-through, SSL & Cloud
│   └── API_AND_AGENT_WORKFLOW.md # REST endpoints & Autonomous swarm chain docs
├── generated_projects/       # Isolated project workspaces developed by AI agents
└── docker-compose.yml        # Full-stack composition (DB, Redis, Backend, Frontend, Ollama, Langfuse)
```

---

## ⚡ Quickstart (Local Docker Stack)

Launch the entire stack with a single command:

```bash
docker compose up --build -d
```

### Accessing Services

| Service | URL | Default Credentials |
| :--- | :--- | :--- |
| **Frontend Application** | [http://localhost:3000](http://localhost:3000) | Standard signup or administrator account |
| **Backend API & Swagger Docs**| [http://localhost:8000/api/docs/](http://localhost:8000/api/docs/) | Open access / JWT Bearer |
| **Langfuse Observability** | [http://localhost:3001](http://localhost:3001) | Auto-configured session traces |
| **Ollama GPU Inference** | [http://localhost:11434](http://localhost:11434) | Optional; provision a model separately |

---

## 📖 Documentation & Guides

- 🏛️ [**Architecture & Multi-Agent Swarm**](./docs/ARCHITECTURE.md) : Detailed breakdown of LangGraph nodes, pgvector RAG store, Git lifecycle, and Kanban quality gates.
- 🚀 [**Hosting & Production Deployment**](./docs/HOSTING_AND_DEPLOYMENT.md) : Step-by-step production hosting with NVIDIA GPU pass-through, Nginx SSL, Keycloak SSO, and 1-click cloud deploy (Render, Railway, K8s).
- 📡 [**API & Swarm Workflow Reference**](./docs/API_AND_AGENT_WORKFLOW.md) : Complete REST API documentation and inter-agent communication specifications.

---

## 📄 License

MIT License © 2026 TeamFlow Core Engineering Team.
