# TeamFlow pre-production runbook

**Updated:** 2026-09-20
**Supported deployment path:** Railway Infrastructure as Code (`.railway/railway.ts`)

This runbook covers configuration, routing, deployment steps, operational procedures,
backups, secret rotation, and known limitations for TeamFlow on Railway.

## 1. Architecture and routing

`teamflow-nginx` is the single public service in the Railway project. Every other service
has its public domain removed and communicates strictly over Railway's private network
(`<service-name>.railway.internal`).

| Service | Railway private host | Port | Public access | Purpose |
| --- | --- | --- | --- | --- |
| `teamflow-nginx` | `teamflow-nginx.railway.internal` | `$PORT` | Yes (`RAILWAY_PUBLIC_DOMAIN`) | Public ingress, reverse proxy, SSL termination passthrough, rate limiting |
| `teamflow-frontend` | `teamflow-frontend.railway.internal` | `3000` | No | Next.js web application |
| `teamflow-backend-nest` | `teamflow-backend-nest.railway.internal` | `8001` | No | NestJS application API (`/api/`) |
| `teamflow-backend` | `teamflow-backend.railway.internal` | `8000` | No | Django execution engine: agents, git, migrations, webhooks, admin |
| `teamflow-celery` | `teamflow-celery.railway.internal` | N/A | No | Celery worker executing agent jobs with attached volume |
| `teamflow-db` | `teamflow-db.railway.internal` | `5432` | No | Managed PostgreSQL 16 with pgvector |
| `teamflow-redis` | `teamflow-redis.railway.internal` | `6379` | No | Managed Redis 7 Celery broker and cache |

nginx routes traffic according to `nginx/default.conf`:

| Path | Target | Notes |
| --- | --- | --- |
| `/` | `teamflow-frontend` | Next.js web application |
| `/api/` | `teamflow-backend-nest` | Application API used by the web app |
| `/api/auth/(login|register|refresh|clerk|keycloak|change-password)` | `teamflow-backend-nest` | Rate limited (20/min per client, burst 20) |
| `/api/agents/events/stream/` | `teamflow-backend-nest` | Server-sent events, unbuffered, chunked transfer |
| `/mcp`, `/.well-known/oauth-*` | `teamflow-backend-nest` | Remote MCP server (only when `MCP_ENABLED=true`) |
| `/api/deployments/<id>/provider_callback/` | `teamflow-backend` | Signed deployment status reports from external provider |
| `/api/billing/webhook/` | `teamflow-backend` | Stripe webhooks, verified with `STRIPE_WEBHOOK_SECRET` |
| `/api/integrations/slack/events/` | `teamflow-backend` | Slack Events API, verified with `SLACK_SIGNING_SECRET` |
| `/admin/`, `/static/` | `teamflow-backend` | Django admin and static files, restricted by `ADMIN_ALLOWED_IPS` |

Railway's private network is IPv6-only. `nginx` resolves `<service-name>.railway.internal`
hostnames at request time using a `resolver` directive (e.g. `resolver [fd12::10] valid=10s;`)
and variables in `proxy_pass` so that dynamically assigned IPv6 addresses are not pinned
across service redeployments.

NestJS calls Django over the private network (`PYTHON_AI_SERVICE_URL=http://teamflow-backend.railway.internal:8000`)
with short-lived tokens signed by `PYTHON_AI_JWT_SECRET`. Django validates caller identity,
role, and workspace before executing operations.

## 2. Before the first deployment

Environment variables are configured in the Railway project dashboard or via CLI configuration.
Never commit secrets to the repository.

Configure the following variables (by name only):

1. **Shared cross-service secrets.**
   - `PYTHON_AI_JWT_SECRET`: Shared HMAC signing secret between `teamflow-backend-nest` and `teamflow-backend`. Must be identical on both services.
   - `DEPLOY_HOOK_SECRET`: HMAC-SHA256 signature secret for external deployment provider callbacks (`X-TeamFlow-Signature`).
   - `DJANGO_SECRET_KEY`: Django secret key used for session signing and cryptographic tokens.
   - `JWT_SECRET` and `JWT_REFRESH_SECRET`: NestJS JWT access and refresh token signing keys.
   - `DJANGO_SUPERUSER_PASSWORD` and `DJANGO_SUPERUSER_EMAIL`: Superuser credentials for Django admin. Note that `init_admin` runs on startup of `teamflow-backend` (`APP_ROLE=web`) and sets this password on both admin accounts at every start; if either variable is unset, it creates or changes no account.
   - `ADMIN_ALLOWED_IPS`: Comma-separated list of IPv4/IPv6 addresses allowed to access `/admin/`.
2. **Network and origin configuration.**
   - `FRONTEND_URL`: Public HTTPS origin (e.g. `https://${{teamflow-nginx.RAILWAY_PUBLIC_DOMAIN}}`).
   - `PYTHON_AI_SERVICE_URL`: Internal URL for NestJS to reach Django (`http://teamflow-backend.railway.internal:8000`).
   - `ALLOWED_HOSTS`: Set to include public domain, `teamflow-backend.railway.internal`, and `teamflow-nginx.railway.internal`.
   - `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`: Set to public HTTPS domain.
   - `DATABASE_URL`: Injected via Railway reference `${{teamflow-db.DATABASE_URL}}`.
   - `REDIS_URL`: Injected via Railway reference `${{teamflow-redis.REDIS_URL}}`.
3. **Authentication (Clerk).**
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_ISSUER`, `CLERK_AUTHORIZED_PARTIES`.
4. **AI Agents and model providers.**
   - At least one of `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `OLLAMA_BASE_URL`.
   - `GEMINI_MODEL`, `OPENAI_MODEL`, `OLLAMA_MODEL` (optional overrides).
   - `AGENT_VERIFY_EXECUTOR`: Verification engine for agent-generated code.
   - `AGENT_REQUIRE_RELEASE_APPROVAL`: Enforce release approval before agent release triggers.
   - `AGENT_EMAIL_DOMAIN`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `AGENT_PROTECTED_REPOS`.
5. **GitHub integration.**
   - `AGENT_ALLOW_PLATFORM_GITHUB_TOKEN` (set to `false` for multi-tenant deployments).
   - `GITHUB_API_URL`, `GITHUB_WEB_URL` (for GitHub Enterprise).
6. **Deployments and billing.**
   - `DEPLOY_HOOK_URL_<ENV>`, `DEPLOY_CALLBACK_BASE_URL`.
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_ENTERPRISE`.
   - `BILLING_PRICE_LABEL_STARTER`, `BILLING_PRICE_LABEL_GROWTH`, `BILLING_PRICE_LABEL_ENTERPRISE`.

## 3. Deploy

Deployments use Railway's Infrastructure as Code defined in `.railway/railway.ts` and automated
Git deployments from `main`.

### 3.1 Initial deployment

1. Link local repository to the Railway project:
   ```bash
   railway link
   ```
   Select project `eloquent-nourishment` and environment `production`.

2. Inspect the configuration plan:
   ```bash
   bash scripts/deploy.sh
   # or in PowerShell:
   .\scripts\deploy.ps1
   ```
   The script executes `railway config plan`, displays pending resource changes, and requires
   explicit confirmation before applying.

3. Non-interactive apply (CI or reviewed by tech lead):
   ```bash
   bash scripts/deploy.sh --yes
   # or in PowerShell:
   .\scripts\deploy.ps1 -Yes
   ```

4. Verify service startup and watch logs:
   ```bash
   railway status
   railway logs --service teamflow-nginx
   railway logs --service teamflow-backend-nest
   railway logs --service teamflow-backend
   railway logs --service teamflow-celery
   railway logs --service teamflow-frontend
   ```

### 3.2 Database migrations

`teamflow-backend` automatically applies pending migrations during startup (`APP_ROLE=web`).
`teamflow-celery` runs with `APP_ROLE=worker` and skips migrations. The managed Postgres
instance already has the `vector` extension enabled.

Workspace membership migration (`organizations.0003_backfill_memberships`): Review backfilled
memberships after initial deployment:
```sql
SELECT u.email, m.role FROM organizations_membership m JOIN accounts_user u ON u.id = m.user_id ORDER BY m.organization_id, m.role;
```

### 3.3 Ongoing deployments

Railway automatically redeploys services linked to GitHub when commits land on `main`. Rolling
back TeamFlow itself requires redeploying the previous deployment or SHA tag through the Railway
dashboard or CLI. Because Django migrations are forward-only, review migrations before rolling
back across schema updates.

## 4. Verify

Run the pre-production smoke test against the public domain:

```bash
python scripts/smoke_preprod.py --base-url https://<public-domain>
```

The script signs up two throwaway workspaces and validates routing, session rotation,
revocation, tenant isolation, and verification that unconfigured billing/deployment providers
fail cleanly without mock executions.

### 4.1 Agent swarm smoke test (`scripts/agent_smoke.py`)

Validates ticket processing through the agent swarm in an isolated workspace:

```bash
python scripts/agent_smoke.py [options]
```

Options:
- `--yes`: Run without interactive confirmation prompt against the target database.
- `--title "<title>"`: Throwaway ticket title.
- `--description "<desc>"`: Throwaway ticket description.
- `--no-record`: Disable recording LLM responses to disk.
- `--record-dir <path>`: Directory to capture live model responses for replay fixtures.
- `--engine {chain,graph}`: Swarm execution engine (`chain` or `graph`).
- `--keep`: Retain throwaway database rows instead of deleting them on exit.

Exit codes:
- `0`: Swarm completed successfully and all claimed files were committed to git.
- `1`: Run failed (unconfigured provider, execution exception, or unfinished workflow).
- `2`: Run completed, but mismatch found between claimed files and actual git commits.
- `3`: Run completed and files committed, but QA was unverified (ticket is waiting for reviewer).

Note on QA verification on Railway: Because Railway services do not have a Docker daemon and
cannot run Docker-in-Docker, automated test container execution by QA agents cannot run directly
inside the Railway container. In Railway deployments, QA verification runs via GitHub Actions
workflows or external runners; the expected outcome for a swarm run without an external runner
is exit code 3.

## 5. Deployment provider contract

TeamFlow hands deployments to an external deploy hook and records only what the provider
reports (`backend/deployments/providers.py`).

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
{ "status": "success", "logs": "...", "commit_sha": "abc1234" }
```

`status` is one of `in_progress`, `success`, `failed`, `rolled_back`, `cancelled`.
Unsigned callbacks get 401; callbacks after a final status get 409.

## 6. Operations, backups, and restore drill

### 6.1 Database backups

Run automated backups via the provided Railway backup scripts:
```bash
# Bash (Linux / Git Bash)
bash scripts/railway_backup.sh ./backups 7 teamflow-db

# PowerShell
.\scripts\railway_backup.ps1 -BackupDir ./backups -Keep 7 -ServiceName teamflow-db
```

The backup script:
- Executes `pg_dump` through `railway run --service teamflow-db` without exposing credentials or connection strings.
- Compresses the dump with gzip into a timestamped file (`teamflow_db_YYYYMMDD_HHMMSS.sql.gz`).
- Verifies the dump is non-empty and reports its size.
- Retains the latest N backups (default: 7) and removes older ones.

### 6.2 Volume snapshots (`generated_projects`)

Railway persistent volumes have no built-in snapshot mechanism in this configuration. The
`generated_projects` volume attached to `teamflow-celery` holds transient working checkouts
for agent tasks. Workspaces inside `generated_projects` are recreated from GitHub repositories
rather than restored from backups.

To inspect active volumes:
```bash
railway volume list
```

### 6.3 Restore drill

A backup is not a backup until a restore has been tested.

Perform periodic restore drills to verify backup validity and recovery readiness.

1. Start a local scratch PostgreSQL instance with `pgvector`:
   ```bash
   docker run -d --name teamflow-scratch-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=railway_scratch -p 5533:5432 pgvector/pgvector:pg16
   ```

2. Wait for database readiness:
   ```bash
   docker exec -i teamflow-scratch-db pg_isready -U postgres
   ```

3. Restore the latest backup dump into the scratch database:
   ```bash
   gunzip -c backups/teamflow_db_<timestamp>.sql.gz | docker exec -i teamflow-scratch-db psql -U postgres -d railway_scratch
   ```
   Or under PowerShell:
   ```powershell
   gzip -dc backups\teamflow_db_<timestamp>.sql.gz | docker exec -i teamflow-scratch-db psql -U postgres -d railway_scratch
   ```

4. Verify data integrity and migration status against the scratch database:
   ```bash
   cd backend
   DATABASE_URL=postgresql://postgres:postgres@localhost:5533/railway_scratch ..\.venv\Scripts\python.exe manage.py migrate --check
   DATABASE_URL=postgresql://postgres:postgres@localhost:5533/railway_scratch ..\.venv\Scripts\python.exe manage.py check
   ```

5. Tear down the scratch container:
   ```bash
   docker rm -f teamflow-scratch-db
   ```

### 6.4 Routine maintenance

- **Logs:** View real-time logs via `railway logs --service <service-name>`.
- **Expired sessions:** Run `railway ssh -s teamflow-backend -- python manage.py flushexpiredtokens` periodically.
- **Celery concurrency:** Controlled via `CELERY_CONCURRENCY` (default: 2).

## 7. Secret rotation

When rotating secrets, update the appropriate service variables in Railway. The table below
details what breaks when each secret rotates and the necessary precautions:

| Secret | Affected services | Impact when rotated |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | `teamflow-backend`, `teamflow-celery` | Invalidates every active Django session and cryptographic cookie immediately. All logged-in users are forced to re-authenticate. |
| `PYTHON_AI_JWT_SECRET` | `teamflow-backend-nest`, `teamflow-backend` | Must be rotated on both services simultaneously. If mismatched between NestJS and Django, every bridged internal API call fails with 401 Unauthorized. |
| `JWT_SECRET` | `teamflow-backend-nest` | Invalidates all outstanding NestJS access tokens immediately. Clients with valid refresh tokens will exchange them for new access tokens. |
| `JWT_REFRESH_SECRET` | `teamflow-backend-nest` | Invalidates all refresh tokens across all users. Every user must perform a fresh login. |
| `DEPLOY_HOOK_SECRET` | `teamflow-backend`, external deploy provider | Mismatch causes external deploy provider callbacks to fail with 401 Unauthorized. Update both Railway and the external deployment hook receiver together. |
| `DJANGO_SUPERUSER_PASSWORD` | `teamflow-backend` | Updates the superuser password on the next container start via `init_admin`. While it is unset, `init_admin` leaves the accounts alone. |
| `DATABASE_URL` | `teamflow-backend`, `teamflow-celery`, `teamflow-db` | Managed by Railway. Changing the Postgres password requires updating dependent services (Railway variable references `${{teamflow-db.DATABASE_URL}}` propagate automatically on redeploy). |
| `REDIS_URL` | `teamflow-backend`, `teamflow-celery`, `teamflow-redis` | Managed by Railway. Variable references `${{teamflow-redis.REDIS_URL}}` propagate automatically on redeploy. |
| `STRIPE_WEBHOOK_SECRET` | `teamflow-backend` | Webhook verification fails for Stripe events until updated in sync with Stripe dashboard. |
| `SLACK_SIGNING_SECRET` | `teamflow-backend` | Slack event verification fails until updated in sync with Slack App settings. |

## 8. Known limitations

- **Deploy receiver job state:** The standalone deploy receiver (`deploy-receiver`) tracks deployment executions in memory without persistent queue storage. Restarting or redeploying the receiver process terminates in-flight deployment jobs.
- **Agent workspaces:** Agent checkouts live exclusively on the worker's attached volume (`generated_projects` mounted on `teamflow-celery`). Railway volumes attach to exactly one service; the web service does not mount this volume and coordinates file operations via Git or Celery tasks.
- **QA verification on Railway:** Railway container instances do not run a Docker daemon and cannot support Docker-in-Docker execution. Automated test verification by QA agents requiring container builds must be run via GitHub Actions workflows or external test runners.

## 9. Security model in this release

- **Sessions.** Access tokens last one hour and carry a session id. Refresh tokens
  are single-use and rotated; replaying one ends every session of that user.
  Logout ends the current session. A password change (or linking a verified
  Clerk identity) ends all other sessions. Sessions are stored in Django's token blacklist
  tables as SHA-256 fingerprints. Existing sessions from earlier releases are rejected,
  so users sign in again once.
- **Clerk.** A Clerk session token is required and verified against the configured issuer
  only; client-supplied e-mail or user ids are ignored. New Clerk users get their own
  workspace. Django's legacy Clerk endpoint is disabled.
- **People and AI agents.** People hold one of three workspace roles: CEO, Admin or Member.
  Specialist roles (PM, Tech Lead, Backend, Frontend, DevOps, QA, Designer, SEO) belong only
  to AI agent seats, which live in one workspace, have no memberships and can never sign in
  or hold a session. Every sign-up (password, Clerk or Keycloak without an organization claim)
  founds a new workspace on the Starter plan with the person as its CEO. Addresses of the form
  `<key>+organization-<id>@AGENT_EMAIL_DOMAIN` are reserved for agent seats.
- **Workspaces.** A person can belong to several workspaces (`organizations_membership`) with
  a role in each. The account row caches the active workspace and role; every request re-reads
  the seat, and a session whose active workspace has no seat gets no workspace access. Users see
  and act only within their active workspace; switching requires a seat there (platform staff
  excepted). Creating a workspace keeps the creator's other workspaces.
- **Invitations.** Admins and CEOs invite by email with a workspace role; only a CEO grants
  or revokes CEO or Admin, nobody changes their own role, and a workspace always keeps one CEO.
  Invitations never move anyone: the person sees them in the app after signing in and accepts or
  declines. An invitation to an email without an account creates a placeholder that the person
  claims by signing in with Clerk using that email (password sign-up is refused). Accepting an
  invitation always requires a verified Clerk identity. Removing someone (or leaving) ends their
  project access in that workspace and moves them to another of their workspaces. Admins cannot
  edit CEO or Admin accounts, and nobody but the person (or platform staff) edits the profile
  of someone who also belongs to other workspaces.
- **Agents.** Git commands run only inside `generated_projects/<project>/`, never in the platform
  checkout, never against `AGENT_PROTECTED_REPOS`, and never against a repository guessed from
  a folder name. Push, pull, merge and PR results are reported as they happened. Prompt directives
  (pull, build, push) require explicit phrases, and prompts never push `main`.
- **No invented work.** Agent replies, plans and code come from the configured model; with no
  provider the request fails with 503 instead of returning a scripted answer. Token counts and
  costs are reported only when a provider reports them, repository creation without a GitHub
  token fails instead of returning a fake repository, and SEO audits store only measured values.
- **Outbound requests.** SEO audits fetch only public http(s) addresses on default ports,
  re-checked for every connection and redirect.
- **Webhooks.** Deployment callbacks (HMAC), Stripe and Slack events are verified.

## 10. Open items that need a decision or an owner

1. **Exposed GitHub token and repository hygiene.** Open: Local token revoked, stray branches pruned; keep remote URL sanitized.
2. **Deployment provider.** Open: External deploy hook provider selection pending production staging target.
3. **Data created by the old Clerk sign-in.** Open: Audit query available to check for shared domain workspaces.
4. **Unverified email on password sign-up.** Open: Invitation acceptance requires Clerk-verified email.
5. **Django admin exposure.** Resolved in Phase 4: Django is private on Railway internal network; `/admin/` is routed strictly through `teamflow-nginx` with IP filtering via `ADMIN_ALLOWED_IPS`.
6. **Token storage in the browser.** Open: `localStorage` used; httpOnly cookie migration on roadmap.
7. **Other manifests.** Resolved in Phase 4: `railway.json` replaced by Infrastructure as Code (`.railway/railway.ts`); legacy `k8s/` and `render.yaml` remain deprecated.
8. **Keycloak organization claims.** Open: Configure only with controlled tenant organization claims.
9. **Plan limits.** Open: Limits displayed in UI; server-side enforcement pending.
