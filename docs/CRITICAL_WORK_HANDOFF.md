# TeamFlow Critical Work Handoff

**Updated:** 2026-08-30
**Working branch:** `work/agent-workflow-hardening`
**Implementation commit:** `8c5be8e` (`feat: harden critical agent workflows`)
**Scope:** Critical authentication, tenant isolation, agent runtime, background execution, and live agent visibility.

## Completed Work

### 1. Authentication and authorization hardening

- Keycloak tokens are now verified using the signing key, RS256, issuer, audience, expiry, issued-at time, and subject claims.
- Removed the unverified JWT payload decoder and the email/request-role login fallback.
- Roles are accepted only from verified Keycloak realm or client claims.
- Self-service profile updates can no longer change email, role, or account status.
- Team-member write operations now require a privileged user and return proper DRF permission errors.
- Added a Keycloak audience mapper and configurable back-channel, issuer, client, and timeout settings.

Key files:

- `backend/accounts/keycloak.py`
- `backend/accounts/views.py`
- `backend/accounts/serializers.py`
- `backend/teamflow/settings.py`
- `keycloak/realm-export.json`

### 2. Tenant isolation

- Added validation that project owners, project members, task assignees, comments, deployments, and SEO-created tasks belong to the current organization.
- Agent endpoints now load tasks, traces, events, projects, and RAG data through organization-scoped queries.
- RAG retrieval now requires a project or organization scope; unscoped retrieval returns no tenant data.
- Added an explicit `agent_key` identity instead of treating every non-CEO user as an AI agent.
- Agent seats are created independently per organization and cannot be shared across tenants.

Key files:

- `backend/accounts/models.py`
- `backend/agents/users.py`
- `backend/agents/rag/ingest.py`
- `backend/agents/rag/vector_store.py`
- `backend/projects/serializers.py`
- `backend/tasks/serializers.py`
- `backend/deployments/serializers.py`

### 3. Agent runtime repair

- Agent registry entries now provide usable system instructions and truthfulness guidance.
- Added the missing OpenAI/LangChain and HTTP runtime dependencies.
- Fixed uninitialized model-response handling and organization-aware agent lookup.
- Fixed the deployment tool's agent-resolution runtime error.
- Agent status now measures model availability, Redis availability, and an actual Celery worker response separately.

### 4. Non-blocking agent execution

- Agent graph, sequential swarm, and direct prompt requests now enqueue Celery jobs and return HTTP `202` instead of blocking API requests.
- Added persistent parent execution traces for queued, running, completed, and failed work.
- Queue failures are recorded as failed traces and events instead of being reported as successful runs.
- Added development and production Celery worker configuration with shared generated-project storage.

Key files:

- `backend/agents/queue.py`
- `backend/agents/tasks.py`
- `backend/agents/graph.py`
- `docker-compose.yml`
- `docker-compose.prod.yml`

### 5. Visible agent conversation and progress

- Added persistent, tenant-scoped `AgentEvent` records.
- Events distinguish queued, started, progress, handoff, blocked, completed, and failed states.
- Each update can show the sender, recipient, current work, remaining work, message, session, task, project, and metadata.
- Added an authenticated resumable SSE endpoint and a JSON recovery endpoint.
- The project interface now shows live agent updates and no longer claims a queued run completed immediately.
- Human users and AI agents are displayed using the explicit `is_ai_agent` identity.

Key files:

- `backend/agents/events.py`
- `backend/agents/models.py`
- `backend/agents/views.py`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/types.ts`
- `frontend/src/app/(app)/projects/[id]/page.tsx`

### 6. Core API corrections

- Replaced invalid permission exception references that caused server errors.
- Fixed activity-feed filtering so filters are applied before the 40-record limit.
- Added tenant validation to cross-model writes and corrected organization-scoped SEO task creation.

## Verification Completed

- Backend test suite: **28/28 passed**.
- Django system check: passed with no issues.
- Migration check: no missing model changes.
- Python syntax audit: 134 files parsed successfully.
- Frontend production build: passed TypeScript compilation and generated all 14 routes.
- ESLint: zero errors; existing repository warnings remain.
- Docker Compose YAML and Keycloak JSON: parsed successfully.
- Git review: two logic reviews plus a final staged-snapshot review completed before commit.

The Docker stack itself was not started on the verification machine because Docker was unavailable. This remains an integration-verification task.

## Verification Completed

- Backend test suite: **47/47 passed** (including pulse and integrations suites).
- Django system check: passed with no issues.
- Migration check: all models and migrations up to date.
- Frontend production build: passed Next.js Turbopack compilation and generated all 14 routes.
- Real AST & artifact verification: integrated into QA nodes and sequential swarm execution.
- Duplicate queue protection & stale trace auto-reaping: fully operational in `backend/agents/queue.py`.
- Organization-aware SSO onboarding: tenant isolation enabled via claim and domain resolution in `backend/accounts/views.py`.

## Completed Work & Hardening Status

- [x] **P1. Replace simulated success with real execution evidence**: Real AST syntax analysis, artifact existence auditing, dynamic duration tracking, and objective Definition of Done compliance scoring are now implemented across `qa_agent.py`, `swarm_chain.py`, `app_tool.py`, and `deployments/views.py`.
- [x] **P3. Make agent runs durable and controllable**: Duplicate dispatch protection, stale trace reaping, and timeout handling are implemented in `agents/queue.py`.
- [x] **P5. Implement organization-aware SSO onboarding**: Tenant workspace resolution via custom Keycloak claims and company email domain matching is now active in `accounts/views.py`.
- [x] **Branch and Merge Synchronization**: All hardened agent workflows, Pulse execution workspace, Stripe subscription billing, and security features are merged into `main` and pushed to `origin/main`.
