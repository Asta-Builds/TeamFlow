# TeamFlow: Virtual Tech Company Workspace Guidelines

This repository is governed by the **Google Antigravity SDK** and **LangGraph Multi-Agent Architecture**.

## Organizational Roles & Permissions

1. **👑 Human CEO / Founder (`ceo@teamflow.dev`)**:
   - Sole human executive.
   - Sets project scope, budget control, and issues prompts to agents using `@agent` tags.

2. **🤖 Autonomous AI Agent Specialists**:
   - **Tech Lead (`lead@teamflow.dev`)**: Orchestrates swarm subtasks, queries pgvector RAG, and reviews PRs. Only Tech Lead can merge to `main`.
   - **Senior Backend (`backend1@teamflow.dev`)**: Django REST framework, database schemas, and GitHub PR generation.
   - **Senior Frontend (`frontend1@teamflow.dev`)**: Next.js 16 App Router, SuperDesign dark styling, Lucide icons, Sonner toasts.
   - **QA Engineer (`qa@teamflow.dev`)**: Integration test suites, boundary testing, 5-stage Kanban decision gate validation/rejection.
   - **DevOps Engineer (`devops@teamflow.dev`)**: Docker containers, CI/CD pipelines, live deployment streaming, 1-click rollback.
   - **UI/UX Designer (`design@teamflow.dev`)**: Design tokens, WCAG AA accessibility, interface ergonomics.
   - **Technical SEO (`seo@teamflow.dev`)**: Core Web Vitals audits, canonical tags, automated engineering ticket creation.

## Engineering Standards

- No raw emojis in production code; use **Lucide React vector icons**.
- All interactive feedback must use **Sonner toasts** instead of browser dialogs.
- Every agent invocation is traced to **Langfuse** with `session_id = ticket-{id}`.
- Ground all architectural decisions in the **PostgreSQL + pgvector RAG store**.
