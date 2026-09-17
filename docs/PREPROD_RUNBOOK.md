# TeamFlow pre-production runbook

**Updated:** 2026-09-17
**Supported deployment path:** `docker-compose.prod.yml` behind a TLS-terminating proxy.

This runbook covers what must be configured before the first pre-production
deployment, how traffic flows, how to verify a deployment, and what remains open.

## 1. Architecture and routing

Only the `nginx` container publishes a port. Put a TLS-terminating load balancer
or host reverse proxy in front of it and forward `X-Forwarded-Proto`.

| Path | Service | Notes |
| --- | --- | --- |
| `/` | frontend (Next.js) | Web app |
| `/api/…` | backend_nest (NestJS) | Application API used by the web app |
| `/api/auth/login|register|refresh|clerk|keycloak|change-password` | backend_nest | Rate limited (20/min per client, burst 20) |
| `/api/agents/events/stream` | backend_nest | Server-sent events, unbuffered |
| `/mcp`, `/.well-known/oauth-*` | backend_nest | Remote MCP server (only when `MCP_ENABLED=true`) |
| `/api/deployments/<id>/provider_callback/` | backend (Django) | Signed deployment status reports |
| `/api/billing/webhook/` | backend (Django) | Stripe webhooks, verified with `STRIPE_WEBHOOK_SECRET` |
| `/api/integrations/slack/events/` | backend (Django) | Slack Events API, verified with `SLACK_SIGNING_SECRET` |
| `/admin/`, `/static/` | backend (Django) | Django admin and static files |

NestJS calls Django over the internal network (`PYTHON_AI_SERVICE_URL`) with a
60-second token signed by `DJANGO_SECRET_KEY`. Django re-checks the caller's role
and workspace. Agent runs, repository provisioning, deployments, integrations and
Stripe checkout execute in Django; the Celery worker runs agent jobs.

## 2. Before the first deployment

Copy `.env.production.example` to `.env.production` and fill in every value.

1. **Secrets.** `DJANGO_SECRET_KEY`, `JWT_SECRET` and `JWT_REFRESH_SECRET` must be
   distinct random values of at least 32 characters. The database password must
   match `DATABASE_URL`.
2. **Public origin.** Set `FRONTEND_URL`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`
   and `CSRF_TRUSTED_ORIGINS` to the HTTPS origin. Keep `backend` in
   `ALLOWED_HOSTS`; NestJS reaches Django by that name.
3. **Clerk.** Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
   The issuer is derived from the publishable key unless `CLERK_ISSUER` is set.
   Set `CLERK_AUTHORIZED_PARTIES` to the public origin.
4. **Agents.** Set `AGENT_EMAIL_DOMAIN`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`,
   and `AGENT_PROTECTED_REPOS` to the TeamFlow repository (for example
   `Asta-Builds/TeamFlow`). Agents refuse to pull, push, clone or merge those.
5. **GitHub.** For a multi-tenant install keep
   `AGENT_ALLOW_PLATFORM_GITHUB_TOKEN=false`; each workspace connects its own
   token in Settings. Enable it only for a single-tenant install.
6. **Deployments.** Configure `DEPLOY_HOOK_URL_<ENV>`, `DEPLOY_HOOK_SECRET` and
   `DEPLOY_CALLBACK_BASE_URL` (see section 5). Without a hook, deployment and
   rollback requests return 503 and nothing is recorded.
7. **Billing.** Set the Stripe keys and prices, and register
   `https://<host>/api/billing/webhook/` in Stripe. Without Stripe, checkout and
   the billing portal return 503. Mock billing is always off in production.
8. **Reverse proxy.** Terminate TLS, redirect HTTP to HTTPS, and forward
   `X-Forwarded-For` and `X-Forwarded-Proto`. nginx trusts `X-Forwarded-For` only
   from private networks (`nginx/nginx.conf`); adjust `set_real_ip_from` if your
   proxy lives elsewhere.
9. **Backups.** Schedule `pg_dump` of the `db` service and snapshot the
   `generated_projects` volume.

## 3. Deploy

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production config --quiet
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Every service has a health check; nginx starts only after Django, NestJS and the
web app are healthy. Django applies migrations on start (`APP_ROLE=web`); the
worker does not (`APP_ROLE=worker`). Containers run as unprivileged users.

**Workspace membership migration.** `organizations.0003_backfill_memberships`
gives every existing person a seat in their current workspace. People who held a
specialist role are moved to a workspace role: Tech Lead becomes Admin, the other
specialist roles become Member. AI agent seats keep their roles. Review the
result after the first deployment:
`SELECT u.email, m.role FROM organizations_membership m JOIN accounts_user u ON u.id = m.user_id ORDER BY m.organization_id, m.role;`

To run published images instead of building, set `IMAGE_PREFIX=ghcr.io/<owner>/<repo>`
and `IMAGE_TAG=sha-<commit>` and use `up -d --no-build`. The deploy workflow
publishes `-backend`, `-backend-nest` and `-frontend` images only after CI passes
on `main` (tags `main` and `sha-<commit>`), and for `v*.*.*` release tags.

**Rolling back TeamFlow itself:** redeploy the previous `sha-<commit>` tag. Django
migrations are forward-only; check the release notes before rolling back across
a migration.

## 4. Verify

```bash
python scripts/smoke_preprod.py --base-url https://<host>
```

The script signs up two throwaway workspaces and checks routing, session rotation
and revocation, tenant isolation, and that deployments, billing, repository
provisioning and SEO audits refuse to simulate work.

Local rehearsal on a spare port:

```bash
docker compose -p teamflow-preprod -f docker-compose.prod.yml --env-file <rehearsal.env> up -d --build
python scripts/smoke_preprod.py --base-url http://localhost:18080
docker compose -p teamflow-preprod -f docker-compose.prod.yml --env-file <rehearsal.env> down -v
```

## 5. Deployment provider contract

TeamFlow hands deployments to an external deploy hook and records only what the
provider reports (`backend/deployments/providers.py`).

**Request** (`POST DEPLOY_HOOK_URL_<ENV>`, JSON):

```json
{
  "action": "deploy",
  "deployment_id": 42,
  "project_id": 7,
  "project": "Payments",
  "github_repo": "your-org/payments",
  "environment": "staging",
  "branch": "main",
  "commit_sha": "abc1234",
  "callback_url": "https://<host>/api/deployments/42/provider_callback/"
}
```

`action` is `deploy` or `rollback`. The body is signed with
`X-TeamFlow-Signature: sha256=<hex HMAC-SHA256 of the raw body using DEPLOY_HOOK_SECRET>`.
A 2xx response marks the deployment `in_progress`; anything else marks it `failed`.

**Callback** (`POST callback_url`, JSON, same signature header):

```json
{ "status": "success", "logs": "…", "commit_sha": "abc1234" }
```

`status` is one of `in_progress`, `success`, `failed`, `rolled_back`, `cancelled`.
Unsigned callbacks get 401; callbacks after a final status get 409.

## 6. Operations

- **Logs:** `docker compose … logs -f <service>`; files rotate at 10 MB × 5.
- **Expired sessions:** run `docker compose … exec backend python manage.py flushexpiredtokens` daily.
- **API docs:** Swagger at `/api/docs` is off in production unless `ENABLE_API_DOCS=true`.
- **Celery concurrency:** `CELERY_CONCURRENCY` (default 2).

## 7. Security model in this release

- **Sessions.** Access tokens last one hour and carry a session id. Refresh tokens
  are single-use and rotated; replaying one ends every session of that user.
  Logout ends the current session. A password change ends all other sessions.
  Sessions are stored in Django's token blacklist tables as SHA-256 fingerprints.
  Existing sessions from earlier releases are rejected, so users sign in again once.
- **Clerk.** A Clerk session token is required and verified against the
  configured issuer only; client-supplied e-mail or user ids are ignored. New
  Clerk users get their own workspace. Django's legacy Clerk endpoint is disabled.
- **People and AI agents.** People hold one of three workspace roles: CEO,
  Admin or Member. Specialist roles (PM, Tech Lead, Backend, Frontend, DevOps, QA,
  Designer, SEO) belong only to AI agent seats, which live in one workspace, have
  no memberships and can never sign in or hold a session. Every sign-up (password,
  Clerk or Keycloak without an organization claim) founds a new workspace on the
  Starter plan with the person as its CEO. Addresses of the form
  `<key>+organization-<id>@AGENT_EMAIL_DOMAIN` are reserved for agent seats.
- **Workspaces.** A person can belong to several workspaces
  (`organizations_membership`) with a role in each. The account row caches the
  active workspace and role; every request re-reads the seat, and a session whose
  active workspace has no seat gets no workspace access. Users see and act only
  within their active workspace; switching requires a seat there (platform staff
  excepted). Creating a workspace keeps the creator's other workspaces.
- **Invitations.** Admins and CEOs invite by email with a workspace role; only a
  CEO grants or revokes CEO or Admin, nobody changes their own role, and a
  workspace always keeps one CEO. Invitations never move anyone: the person sees
  them in the app after signing in and accepts or declines. An invitation to an
  email without an account creates a placeholder that the person claims by
  signing up with that email. Removing someone (or leaving) ends their project
  access in that workspace and moves them to another of their workspaces. Admins
  cannot edit CEO or Admin accounts, and nobody but the person (or platform staff)
  edits the profile of someone who also belongs to other workspaces.
- **Agents.** Git commands run only inside `generated_projects/<project>/`, never in
  the platform checkout, never against `AGENT_PROTECTED_REPOS`, and never against a
  repository guessed from a folder name. Push, pull, merge and PR results are
  reported as they happened. Prompt directives (pull, build, push) require explicit
  phrases, and prompts never push `main`.
- **Outbound requests.** SEO audits fetch only public http(s) addresses on default
  ports, re-checked for every connection and redirect.
- **Webhooks.** Deployment callbacks (HMAC), Stripe and Slack events are verified.

## 8. Open items that need a decision or an owner

1. **Exposed GitHub token and repository hygiene.** The local checkout's `origin`
   remote was rewritten by agent code to `https://x-access-token:<token>@github.com/Asta-Builds/backend.git`.
   Revoke that token, then restore the remote:
   `git remote set-url origin https://github.com/Asta-Builds/TeamFlow.git`.
   Five stray branches (`feat/ticket-1-backend-implement-jwt-token-refr`,
   `feat/ticket-1-backend-real-time-sse-notificati`,
   `feat/ticket-1-frontend-real-time-sse-notificati`,
   `feat/ticket-10-backend-backend-domain-logic-bac`,
   `feat/ticket-14-backend-backend-domain-logic-bac`) were pushed to the public
   repository; they point at the current `main` commit and can be deleted.
   The local `backend/generated_projects/1_realtime-notification-service`
   workspace contains a copy of the platform source and a tokenized remote; delete it.
2. **Deployment provider.** Choose the target platform and deploy hook (section 5).
3. **Data created by the old Clerk sign-in.** Earlier releases placed Clerk users
   into shared workspaces named after their e-mail domain (for example
   "Personal Workspace"). Review environments that ran that code:
   `SELECT o.id, o.name, count(u.id) FROM organizations_organization o JOIN accounts_user u ON u.organization_id = o.id WHERE u.password LIKE '!sso_%' GROUP BY o.id, o.name HAVING count(u.id) > 1;`
4. **Unverified email on password sign-up.** Password sign-up does not verify the
   email address, so whoever registers an address first can accept invitations
   sent to it. Prefer Clerk sign-in for invited people, or add email verification
   before relying on password sign-up.
5. **Django admin exposure.** `/admin/` is public behind Django authentication;
   restrict it by IP at the proxy if possible.
6. **Token storage in the browser.** The web app keeps tokens in `localStorage`;
   moving to httpOnly cookies remains on the upgrade plan.
7. **Other manifests.** `k8s/`, `render.yaml` and `railway.json` predate the
   NestJS API and are not part of the supported path.
8. **Keycloak organization claims.** When Keycloak is enabled, an `organization`
   claim joins the oldest workspace with that exact name. Workspace names are not
   unique, so a self-registered workspace can take a name first. Enable Keycloak
   only with organization names you control, or map claims to workspace IDs.
9. **Plan limits.** `max_seats` and `max_projects` are shown in Settings but not
   enforced.
