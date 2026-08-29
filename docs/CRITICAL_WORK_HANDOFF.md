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

## Known Limitations Not Yet Fixed

- Several legacy agent paths still simulate test counts, coverage, pull-request success, merge success, and deployment success. They must not be treated as real evidence.
- The sequential swarm can still mark validation clauses passed without executing the claimed test commands.
- The deployment REST endpoint still creates simulated successful logs rather than running a real pipeline.
- The current SSE implementation performs bounded database polling and runs through the existing synchronous web deployment; it is functional but not yet designed for high connection volume.
- Keycloak-created users still fall back to the shared default workspace when no organization onboarding claim or invitation is available.
- Container-level Keycloak, Celery, Redis, model-engine, and browser flows have not yet been tested together.
- Frontend lint warnings and broader frontend automated-test coverage remain outstanding.

## Next Tasks, in Priority Order

### P1. Replace simulated success with real execution evidence

Run actual test, lint, build, pull-request, merge, and deployment operations. Persist command output and exit status, block handoffs on failure, and only mark QA or deployment successful when the recorded evidence passes.

### P2. Add full Docker integration tests

Start the complete stack and verify migrations, Keycloak login, Celery job pickup, Redis connectivity, Ollama/OpenAI selection, tenant isolation, event streaming, task updates, and worker restart recovery.

### P3. Make agent runs durable and controllable

Add idempotency keys, retries with backoff, stale-run detection, cancellation, timeout handling, duplicate-dispatch protection, and safe worker shutdown behavior.

### P4. Harden the real-time transport

Choose an ASGI or broker-backed event delivery design for production scale, add connection limits and monitoring, and test resume behavior after token refresh, disconnects, and worker failures.

### P5. Implement organization-aware SSO onboarding

Map verified Keycloak organization or invitation claims to an existing workspace. Reject ambiguous onboarding instead of placing unrelated users into a shared default organization.

### P6. Add database-level tenancy invariants

Backfill legacy nullable organization fields and enforce consistency between tasks, projects, events, embeddings, deployments, users, and traces wherever database constraints can express it.

### P7. Expand CI and frontend coverage

Add backend security regression tests, frontend unit/component tests, Playwright critical-path tests, lint/type/build CI gates, and a container smoke-test job.

## Branch and Merge Status

- The work is committed and pushed only to `work/agent-workflow-hardening`.
- `main` has not been modified or merged.
- Review and test the remaining integration items before opening or approving a merge into `main`.
