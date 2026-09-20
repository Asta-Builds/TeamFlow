# Railway Deployment Guide

This document describes the production deployment topology, service configuration, and operational procedures for TeamFlow on Railway.

## Architecture & Services

The deployment comprises seven services managed under the Railway project:

1. `teamflow-nginx`: Ingress reverse proxy built from `nginx/Dockerfile`. This is the **only public service** exposed to the internet with a public domain. It terminates ingress HTTP traffic and routes to private internal services over Railway's private network (`*.railway.internal`).
2. `teamflow-frontend`: Next.js web application built from `frontend/Dockerfile` or Nixpacks. Accessible privately via `teamflow-frontend.railway.internal:3000`.
3. `teamflow-backend-nest`: NestJS application API built from `backend-nest/Dockerfile`. Accessible privately via `teamflow-backend-nest.railway.internal:8001`. Handles organization workspaces, invitations, billing endpoints, MCP integrations, and release approvals.
4. `teamflow-backend`: Django web application service built from `backend/Dockerfile`. Accessible privately via `teamflow-backend.railway.internal:8000`. Handles deployment provider callbacks, Stripe webhooks, Slack events, Django admin, and static assets.
5. `teamflow-celery`: Celery background worker built from `backend/Dockerfile`. Executes agent tasks, autonomous git operations, and repo provisioning.
6. `teamflow-db`: Managed PostgreSQL database with `pgvector` extension enabled. Attached to `teamflow-db-volume` mounted at `/var/lib/postgresql/data`.
7. `teamflow-redis`: Managed Redis instance for cache and Celery broker. Attached to `teamflow-redis-volume` mounted at `/data`.

## Ingress Routing Rules

All ingress traffic enters through `teamflow-nginx`:

- `/api/deployments/<id>/provider_callback/` -> Django (`teamflow-backend`)
- `/api/billing/webhook/` -> Django (`teamflow-backend`)
- `/api/integrations/slack/events/` -> Django (`teamflow-backend`)
- `/admin/` and `/static/admin/` -> Django (`teamflow-backend`), gated by `ADMIN_ALLOWED_IPS`
- `/static/` -> Django (`teamflow-backend`)
- `/api/agents/events/stream/` -> NestJS (`teamflow-backend-nest`), unbuffered Server-Sent Events (SSE)
- `/mcp`, `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server` -> NestJS (`teamflow-backend-nest`)
- `/api/auth/*` and all other `/api/*` routes -> NestJS (`teamflow-backend-nest`)
- `/nginx-health` -> nginx local 200 health check response
- `/` and all remaining routes -> Next.js frontend (`teamflow-frontend`)

## Persistent Volumes & Agent Workspaces

A Railway volume can attach to exactly one service. Because agent workspaces require persistent git storage across container redeployments, the `teamflow-generated-projects` volume is attached exclusively to `teamflow-celery`:

- Mount path: `/workspace/generated_projects` (as defined by `WORKSPACE_ROOT` in `backend/agents/git_service.py`)
- Repository provisioning and file operations are executed by Celery tasks so the worker is the sole writer.
- Managed database volumes (`teamflow-db-volume` and `teamflow-redis-volume`) remain attached to `teamflow-db` and `teamflow-redis` respectively.

## Verification Constraints

Railway container services run in unprivileged containers without access to a Docker daemon (Docker-in-Docker is unsupported). Consequently:

- Agent QA verification runs through remote GitHub Actions runner workflows (`AGENT_VERIFY_EXECUTOR="github_actions"`).
- Projects without a linked GitHub repository finish the verification step marked as unverified.

## Environment Variables Reference

Reference of required environment variables by service. Secrets must be populated in Railway project variables or via CLI, never committed to git.

### teamflow-nginx
- `PORT`: Listening port assigned by Railway (defaults to 80).
- `BACKEND_HOST`: Internal address for Django service (default: `teamflow-backend.railway.internal:8000`).
- `NEST_HOST`: Internal address for NestJS service (default: `teamflow-backend-nest.railway.internal:8001`).
- `FRONTEND_HOST`: Internal address for Next.js service (default: `teamflow-frontend.railway.internal:3000`).
- `ADMIN_ALLOWED_IPS`: Comma-separated client CIDRs permitted to access `/admin/` and `/static/admin/` (e.g. `203.0.113.4/32,198.51.100.0/24`).

### teamflow-backend-nest
- `PORT`: Application port (typically 8001).
- `NODE_ENV`: Runtime environment (`production`).
- `DATABASE_URL`: PostgreSQL connection string (referenced from `teamflow-db`).
- `JWT_SECRET`: Secret key for signing user authentication tokens.
- `JWT_REFRESH_SECRET`: Secret key for refresh tokens.
- `FRONTEND_URL`: Public URL of the frontend application.
- `CORS_ALLOWED_ORIGINS`: Comma-separated list of allowed origins.
- `PYTHON_AI_JWT_SECRET`: Shared secret used to authenticate internal calls with Django service.
- `PYTHON_AI_SERVICE_URL`: Internal URL for Django service (`http://teamflow-backend.railway.internal:8000`).
- `AGENT_EMAIL_DOMAIN`: Domain used for agent bot identities.
- `DEPLOY_HOOK_URL`: Optional deployment webhook URL.
- `DEPLOY_HOOK_TOKEN`: Optional deployment webhook secret token.
- `MCP_ENABLED`: Enables remote Model Context Protocol server.
- `MCP_CORS_ALLOWED_ORIGINS`: Allowed origins for MCP requests.

### teamflow-backend
- `PORT`: Application port (typically 8000).
- `SECRET_KEY`: Django cryptographic secret key.
- `DEBUG`: Must be `False` in production.
- `ALLOWED_HOSTS`: Allowed host headers (e.g. `teamflow-backend.railway.internal,localhost,127.0.0.1`).
- `DATABASE_URL`: PostgreSQL connection string (referenced from `teamflow-db`).
- `REDIS_URL`: Redis connection string (referenced from `teamflow-redis`).
- `CELERY_BROKER_URL`: Redis broker URL for Celery queues.
- `FRONTEND_URL`: Public URL of the frontend application.
- `CORS_ALLOWED_ORIGINS`: Allowed origins for CORS headers.
- `CSRF_TRUSTED_ORIGINS`: Trusted origins for CSRF protection.
- `DJANGO_SUPERUSER_EMAIL`: Initial admin user email.
- `DJANGO_SUPERUSER_PASSWORD`: Initial admin user password.
- `SEED_DEMO_DATA`: Boolean flag for demo fixtures (`False` in production).
- `GEMINI_API_KEY`: API key for Gemini LLM agent operations.
- `AGENT_VERIFY_EXECUTOR`: Set to `github_actions` for CI verification.
- `AGENT_REQUIRE_RELEASE_APPROVAL`: Enforces approval before agent changes merge (`True`/`False`).
- `PYTHON_AI_JWT_SECRET`: Shared JWT secret matching `teamflow-backend-nest`.
- `DEPLOY_CALLBACK_BASE_URL`: Base URL used for deployment callbacks.
- `DEPLOY_HOOK_URL`: Optional deployment webhook URL.
- `DEPLOY_HOOK_TOKEN`: Optional deployment webhook secret token.

### teamflow-celery
- `APP_ROLE`: Service role identifier (`worker`).
- `CELERY_BROKER_URL`: Redis connection URL for broker.
- `DATABASE_URL`: PostgreSQL connection string.
- `REDIS_URL`: Redis cache connection string.
- `SECRET_KEY`: Django secret key matching backend service.
- `DJANGO_SECRET_KEY`: Alias for Django secret key.
- `DEBUG`: Must be `False` in production.
- `C_FORCE_ROOT`: Set to `true` if worker process runs as root container user.
- `PYTHONWARNINGS`: Warning filter settings.
- `GEMINI_API_KEY`: API key for LLM agents.
- `AGENT_VERIFY_EXECUTOR`: Set to `github_actions` for CI verification.
- `AGENT_REQUIRE_RELEASE_APPROVAL`: Approval enforcement configuration.
- `PYTHON_AI_JWT_SECRET`: Shared secret matching backend and nest services.
- `DEPLOY_HOOK_URL`: Optional deployment webhook URL.
- `DEPLOY_HOOK_TOKEN`: Optional deployment webhook secret token.

### teamflow-frontend
- `PORT`: Next.js listening port (typically 3000).
- `NEXT_PUBLIC_API_URL`: Relative path `/api` so browser queries route through nginx.

## Variables You Must Set Before This Works

The following secrets cannot be defaulted in IaC and must be configured via `railway variables --set` by an operator before the services can function:

1. `PYTHON_AI_JWT_SECRET`: Must be identical on `teamflow-backend`, `teamflow-celery`, and `teamflow-backend-nest`. Without this, all NestJS-to-Django bridged requests (including release approvals) fail:
   ```bash
   railway variables --service teamflow-backend --set PYTHON_AI_JWT_SECRET="<random-32-char-secret>"
   railway variables --service teamflow-celery --set PYTHON_AI_JWT_SECRET="<random-32-char-secret>"
   railway variables --service teamflow-backend-nest --set PYTHON_AI_JWT_SECRET="<random-32-char-secret>"
   ```
2. `GEMINI_API_KEY`: Required on `teamflow-backend` and `teamflow-celery` for agent execution:
   ```bash
   railway variables --service teamflow-backend --set GEMINI_API_KEY="<your-gemini-key>"
   railway variables --service teamflow-celery --set GEMINI_API_KEY="<your-gemini-key>"
   ```
3. `DEPLOY_HOOK_*` and `DEPLOY_CALLBACK_BASE_URL` (if automated deployments are active):
   ```bash
   railway variables --service teamflow-backend --set DEPLOY_HOOK_URL="<webhook-url>"
   railway variables --service teamflow-backend --set DEPLOY_HOOK_TOKEN="<webhook-token>"
   railway variables --service teamflow-backend --set DEPLOY_CALLBACK_BASE_URL="https://<nginx-domain>"
   railway variables --service teamflow-celery --set DEPLOY_HOOK_URL="<webhook-url>"
   railway variables --service teamflow-celery --set DEPLOY_HOOK_TOKEN="<webhook-token>"
   railway variables --service teamflow-backend-nest --set DEPLOY_HOOK_URL="<webhook-url>"
   railway variables --service teamflow-backend-nest --set DEPLOY_HOOK_TOKEN="<webhook-token>"
   ```

No secret values must ever be committed to git.

## Admin Access & Allowlisting

To protect Django admin from unauthorized access on the public internet:

1. When `ADMIN_ALLOWED_IPS` is empty or unset on `teamflow-nginx`, requests to `/admin/` and `/static/admin/` return HTTP 403 Forbidden:
   ```text
   Admin access is restricted. Configure ADMIN_ALLOWED_IPS to enable access.
   ```
2. To enable access for specific operators, set `ADMIN_ALLOWED_IPS` with one or more comma-separated CIDR blocks:
   ```bash
   railway variables --service teamflow-nginx --set ADMIN_ALLOWED_IPS="203.0.113.4/32,198.51.100.0/24"
   ```
3. Nginx uses `set_real_ip_from` and `real_ip_header X-Forwarded-For;` with `real_ip_recursive on;` to validate the real client IP forwarded by Railway's ingress edge.

**Important Security Notice**: Until the legacy public domains on `teamflow-backend` are deleted (see Cutover Procedure below), Django's `/admin/` remains accessible to the internet on `teamflow-backend-production-830a.up.railway.app/admin/` bypassing `ADMIN_ALLOWED_IPS`, because the allowlist exists only inside the nginx router service.

## Applying Infrastructure as Code & Domain Cutover

The project topology is declared in `.railway/railway.ts`. Applying changes and executing domain cutover is a manual operator step requiring code review.

### Step 1: Preview and Apply Configuration
1. Preview the planned changes against the current Railway environment:
   ```bash
   railway config plan
   ```
2. Review the printed plan diff to ensure no unexpected deletions or modifications occur.
3. Apply the planned changes after human verification:
   ```bash
   railway config apply
   ```

### Step 2: Domain Cutover Procedure (Zero-Downtime)
Railway IaC does not support registering or generating public domains in code. Follow this exact ordered procedure to migrate traffic without downtime:

1. **Assign a public domain to `teamflow-nginx` first**:
   ```bash
   railway domain --service teamflow-nginx
   ```
   (Or configure your custom domain: `railway domain example.com --service teamflow-nginx`)

2. **Verify traffic through the router domain**:
   ```bash
   curl -i https://<new-nginx-domain>/nginx-health
   # Expected: HTTP/1.1 200 OK

   curl -i https://<new-nginx-domain>/
   # Expected: HTTP/1.1 200 OK (Next.js web app)

   curl -i https://<new-nginx-domain>/admin/
   # Expected: HTTP/1.1 403 Forbidden (unless client IP is in ADMIN_ALLOWED_IPS)
   ```

3. **Remove legacy public domains from frontend and backend**:
   Only after nginx is verified healthy, delete the old direct domains so all traffic is forced through nginx:
   ```bash
   railway domain delete --service teamflow-frontend teamflow-frontend-production-817e.up.railway.app --yes
   railway domain delete --service teamflow-backend teamflow-backend-production-830a.up.railway.app --yes
   ```
   Removing the backend domain is mandatory to eliminate public exposure of Django admin.

## Known Issues & Follow-ups

- **Frontend API Rewrite Trap**: `frontend/next.config.ts` lines 41-58 contains an `async rewrites()` rule that rewrites `/api/:path*` directly to Django's public URL (`https://teamflow-backend-production-830a.up.railway.app`). Behind nginx this rewrite is bypassed because nginx routes `/api/` directly to NestJS. However, if traffic ever bypasses the router, this rewrite silently routes all requests to Django and bypasses NestJS. Once the router is live, the frontend team should remove this rewrite from `frontend/next.config.ts` (lines 41-58).
