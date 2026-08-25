# 📡 TeamFlow API & Agent Workflow Reference

This document provides a reference for the REST API endpoints, autonomous swarm chain execution, Product Manager roadmap decomposition, and real-time inter-agent communication streams.

---

## 🔑 Authentication

All protected endpoints require a JWT Bearer token:
```http
Authorization: Bearer <access_token>
```

Authentication endpoints:
- `POST /api/auth/login/` : Obtain JWT access & refresh tokens.
- `POST /api/auth/refresh/` : Refresh expired access token.
- `GET /api/auth/me/` : Retrieve current user profile and organization.

---

## 🤖 Swarm & Multi-Agent Endpoints

### 1. Execute Full Autonomous Swarm Chain
Triggers the sequential 6-step handoff pipeline:
`Tech Lead ➔ Backend ➔ Frontend ➔ QA ➔ Merge to main ➔ DevOps Deployment`.

- **Endpoint:** `POST /api/agents/swarm-chain/<task_id>/`
- **Payload:**
  ```json
  {
    "instruction": "Build Stripe checkout webhook handler and payment success modal"
  }
  ```
- **Response:**
  ```json
  {
    "ok": true,
    "task_id": 26,
    "events_count": 6,
    "final_status": "done",
    "events": [
      { "step": 1, "agent": "Sarah Jenkins (Tech Lead)", "action": "Architecture Analysis" },
      { "step": 2, "agent": "Marcus Aurelius (Backend)", "action": "Code Generation & PR" },
      { "step": 3, "agent": "Cleopatra (Frontend)", "action": "HeroUI Components & QA transition" },
      { "step": 4, "agent": "Alan Turing (QA)", "action": "Automated Tests & Quality Report" },
      { "step": 5, "agent": "Sarah Jenkins (Tech Lead)", "action": "Merge PR into main" },
      { "step": 6, "agent": "Joan of Arc (DevOps)", "action": "Staging Deployment Health Check" }
    ]
  }
  ```

---

### 2. Live Swarm Communication Feed
Streams real-time inter-agent dialogue, handoffs (`➔ @agent`), and Kanban status changes.

- **Endpoint:** `GET /api/agents/swarm-feed/?project=<project_id>&task=<task_id>`
- **Response:**
  ```json
  {
    "ok": true,
    "feed": [
      {
        "id": 104,
        "task_id": 26,
        "task_title": "Real-Time Shopping Cart & Checkout API",
        "sender_name": "Marcus Aurelius (AI)",
        "sender_role": "backend",
        "target_agent": "Cleopatra",
        "content": "💻 [Marcus Aurelius ➔ @Cleopatra] ...",
        "created_at": "2026-08-25T02:42:05Z"
      }
    ]
  }
  ```

---

### 3. AI Product Manager Task Breakdown (Athena)
Takes a high-level product vision or sprint roadmap plan and breaks it down into structured, auto-assigned specialist tickets with initial architecture directives.

- **Endpoint:** `POST /api/projects/<project_id>/pm_generate_tasks/`
- **Payload:**
  ```json
  {
    "plan_text": "Implement multi-tenant SSO with Keycloak and user role permissions"
  }
  ```
- **Response:**
  ```json
  {
    "ok": true,
    "created_count": 4,
    "tasks": [
      {
        "id": 27,
        "title": "Keycloak Realm Configuration & JWT Verification Middleware",
        "priority": "high",
        "task_type": "feature",
        "assignee": "Marcus Aurelius (AI)"
      }
    ]
  }
  ```
