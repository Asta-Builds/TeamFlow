# NestJS security hardening — implementation report

**Date:** 2026-09-05

**Scope:** Repository diagnosis, two implementation passes, regression tests, and configuration documentation.

**Branch:** `main`

**Operational status:** Source changes verified locally. Running containers were not rebuilt or redeployed.

This report records the work performed during this session. It supersedes older
claims of NestJS production readiness where they conflict with the limitations
below. It is not a complete security certification of TeamFlow.

## Initial diagnosis

The repository contains a Next.js frontend, a NestJS application API, and a
Django/Celery agent backend sharing PostgreSQL. The default development frontend
still targets Django on port 8000, while Compose separately exposes NestJS on
port 8001. Django's earlier hardening was not consistently carried into NestJS.

The review confirmed password-verification bypasses, client-selected roles at
public registration, automatic attachment to an existing organization, fixed JWT
secrets, incomplete tenant filtering, and project searches that broadened access.
NestJS agent dispatch called Django without authentication, then created apparent
execution progress when the upstream request failed. Further review found
unscoped comments, unchecked QA targets and foreign IDs, simulated deployment/SEO
success, and unrestricted availability of mock subscription writes.

## Authentication and account changes

- Removed plaintext and fixed-password login fallbacks. Unsupported stored
  password formats fail closed. Inactive accounts cannot log in or change passwords.
- Added PBKDF2-SHA256 verification for Django accounts and retained NestJS
  verification of existing supported bcrypt hashes.
- New registrations, team-member creation, and password changes write Django's
  PBKDF2-SHA256 format. Hash generation uses a random salt and 1,200,000 iterations.
- Removed the public registration role field and enforced the `member` role in
  the service. Each signup creates a separate organization; omitting its name
  cannot attach an account to the first existing tenant. Organization and user
  creation occur in one database transaction.
- Removed default NestJS signing secrets. Startup requires distinct access and
  refresh secrets of at least 32 characters and rejects the previous defaults.
- Added explicit access/refresh token types and unique token identifiers. Access
  authentication rejects refresh-typed tokens; refresh rejects the wrong type.
  Signature verification is restricted to HS256.
- Ordinary users cannot edit other members' profiles or change protected role,
  account-status, or active-state fields. User creation requires an organization.

Main files: `backend-nest/src/auth/`, `backend-nest/src/users/`.

## Tenant, project, and task authorization

The shared helpers in `backend-nest/src/common/access.ts` require an organization,
build project/task visibility filters, and validate referenced users. Privileged
users retain organization-scoped access; ordinary project access requires
ownership or membership.

| Area | Implemented behavior |
| --- | --- |
| Project search | Search conditions intersect with membership restrictions instead of joining the same authorization `OR`. |
| Project access | Missing organization no longer allows privileged cross-tenant detail/update/delete access. |
| Project members | Every member ID must belong to the current organization; IDs are validated and deduplicated. Membership replacement and project fields use one nested Prisma write. |
| Task reads | Lists, details, assigned-task views, comments, and activity feeds filter by tenant and project visibility. |
| Task writes | Creation requires a visible project. Assignees must belong to the tenant. Ordinary task edits/deletion require creator or assignee ownership in addition to visibility. |
| QA | Dedicated review actions load an accessible task, require QA/privileged permission, and require the QA stage. Their mutations also constrain tenant and stage. Ordinary users cannot write QA result fields or mark tickets done. |
| Comments | The controller passes the authenticated user to list queries. Adding a comment requires access to its task. |
| Agent visibility | Member event feeds filter by visible project; privileged feeds remain tenant-scoped. Traces filter through visible tasks. |
| Personal plans | Creating a plan item requires a visible task. A focus session can reference only the user's own plan item in the current organization. Personal operations require an organization; session/item ownership checks also check tenant. |
| Notifications | Listing and marking read constrain both recipient and organization. |
| Deployment/SEO reads | Missing-tenant and cross-tenant access gaps were closed in the reviewed endpoints. |

Task DTOs now validate documented status/type/priority values, positive reference
IDs, and compliance-score bounds. Project DTOs validate member IDs individually.

## Agent dispatch and truthful operation status

NestJS dispatch now requires a privileged caller and an organization-scoped task.
It signs a 60-second HS256 SimpleJWT-compatible access token identifying that
caller, then sends it to Django. Django retains its own active-user, role, and
tenant checks before queueing work.

The API returns HTTP 202 only after Django returns 202. Upstream authorization
and not-found failures remain errors. Other failures, missing bridge settings,
unexpected responses, and timeouts produce HTTP 503. NestJS no longer fabricates
traces, completed steps, or start events. It does not automatically retry: a
timeout can happen after Django has accepted a job, so operators should inspect
traces before retrying.

Agent status now requires authentication and queries Django's runtime checks
instead of returning constant readiness.

NestJS deployment creation, rollback, and SEO audit creation now return HTTP 503
because no real execution provider is wired to those methods. They no longer
write invented deployment logs, success statuses, or audit scores. Existing
historical records were not removed or rewritten.

Mock billing requires an explicit `ALLOW_MOCK_BILLING=true` setting together with
`NODE_ENV=development` or `NODE_ENV=test`. Production always rejects it. Mock
responses include `mock: true`, and subscription tiers are validated. A real
billing provider was not implemented.

## Configuration and dependency work

See [NestJS security setup](NESTJS_SECURITY_SETUP.md) for exact configuration,
commands, compatibility notes, and session invalidation behavior.

- Root development Compose now requires externally configured `JWT_SECRET`,
  `JWT_REFRESH_SECRET`, and `DJANGO_SECRET_KEY` instead of the previous fixed
  application signing keys.
- Django and its worker receive `DJANGO_SECRET_KEY` as `SECRET_KEY`. NestJS
  receives the same value as `PYTHON_AI_JWT_SECRET` for the authenticated bridge.
- Updated the NestJS environment example and root quickstart documentation.
- `npm ci` initially failed on a lockfile inconsistency. `npm install` repaired
  dependency resolution; `npm ci --dry-run` then passed. No new runtime package
  was added, and the declared dependency versions were not changed.
- Generated the local Prisma client. No schema changes or migrations were added.
- Added build-before-test lifecycle scripts for HTTP and Django compatibility checks.

## Verification completed

| Check | Result and scope |
| --- | --- |
| `npm test` | **62 tests passed across 6 files.** Includes authentication, tenantless and inaccessible-object requests, foreign references, QA gates, atomic membership writes, and disabled simulations. Database/HTTP boundaries are mocked. |
| `npm run test:e2e` | **6 HTTP tests passed.** Builds the actual application, starts NestJS with a mocked Prisma provider, and checks API metadata, authentication, controller scoping, rejected comment writes, DTO validation, and token-type rejection. |
| `npm run build` | Passed, including builds run by the test lifecycle scripts. |
| `npm run lint` | Passed with two existing unused-import warnings in deployment and pulse DTOs. |
| `npm run test:django-compat` | Passed against Django and SimpleJWT libraries in the running backend container. Django verified a newly generated password hash and accepted the generated bridge-token format using a temporary test signing key. No database writes or jobs. |
| `docker compose config --quiet` | Passed using synthetic validation values for the required secrets. No containers were started or changed. |
| `git diff --check` | Passed. |

New service regression suites are in `src/auth/security.spec.ts`,
`src/agents/agents.service.spec.ts`, `src/common/access.spec.ts`,
`src/projects/projects.service.spec.ts`, and `src/users/users.service.spec.ts`.
The obsolete Hello World HTTP fixture was replaced in `test/app.e2e-spec.ts`.
The reproducible Django check is `scripts/verify-django-compat.mjs`.

Installation still reports existing Node-engine and TypeScript peer-dependency
warnings. Local Node was 22.17.0; some installed Angular tooling requests a newer
Node version. Builds/tests passed in this environment; that does not resolve
those compatibility warnings.

The initial diagnostic launched frontend lint without a completed result in that
turn. No frontend lint/build success is claimed for this session, and no frontend
application code was changed.

## Remaining work and operational limits

1. Running containers still use their existing images/configuration. These source
   changes are not proof that the running deployment is hardened. Configure the
   secrets and perform a separate controlled rollout before relying on them.
2. Full integration against real PostgreSQL through both APIs and Celery job
   completion is still unverified. The compatibility check validates formats and
   libraries, not the production signing-key configuration or job lifecycle.
3. Frontend routing and Keycloak migration to NestJS remain incomplete. Django's
   deployment/SEO implementations were not changed; its existing behavior still
   needs separate review and real provider integration.
4. Logout token revocation, refresh-token reuse detection, and comprehensive
   session invalidation on password change remain unimplemented.
5. Existing raw NestJS bcrypt passwords remain usable through NestJS; Django's
   default hasher configuration requires a password change for those accounts.
   Unsupported password formats require a trusted password-reset process.
6. New public accounts have a member role in their own organization. Elevated
   workspace roles require a trusted administrative provisioning process.
7. This is a focused hardening pass, not an exhaustive audit of every Django,
   infrastructure, agent-tool, and deployment path. No external security scan or
   real deployment, rollback, SEO audit, payment, or agent execution was performed.
