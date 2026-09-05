# Authentication and agent bridge setup

Set `JWT_SECRET` and `JWT_REFRESH_SECRET` to distinct random values of at least
32 characters. The API refuses to start with missing secrets or the previous
TeamFlow defaults. For example, generate each value separately with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

For the root development Docker Compose stack, put `JWT_SECRET`,
`JWT_REFRESH_SECRET`, and a separately generated `DJANGO_SECRET_KEY` in the
root `.env`. Compose passes `DJANGO_SECRET_KEY` to Django and its worker, and
to NestJS as `PYTHON_AI_JWT_SECRET`. Do not commit these values.

When running the services separately, set `PYTHON_AI_JWT_SECRET` in NestJS to
Django's SimpleJWT signing key (`SECRET_KEY` unless overridden). The bridge
uses HS256 and short-lived access tokens identifying the authenticated caller.
Both services must use the same user database. Django still checks the user's
active status, role and organization before queuing agent work.

Agent dispatch returns HTTP 202 only after Django confirms acceptance. Missing
bridge configuration, upstream errors and timeouts return errors; NestJS does
not create simulated execution records or automatically retry. After a timeout,
check traces before retrying because Django might already have queued the job.
Agent status is now authenticated and reflects Django's runtime checks.

New public registrations receive the member role in a newly created organization.
They cannot select a privileged role or join an existing organization by omitting
its name. Existing privileged operators must provision elevated roles through a
trusted administrative process. Organization creation and account creation use
one transaction.

New and changed passwords use Django's PBKDF2-SHA256 format. Existing NestJS
bcrypt hashes remain supported by NestJS. Unsupported password formats fail
closed and require a password reset; there are no plaintext or fixed-password
fallbacks. Django's default password configuration does not verify old raw
NestJS bcrypt hashes, so those accounts need a password change for Django login.

Changing signing keys invalidates existing sessions. Old NestJS tokens without
an explicit access/refresh token type are also rejected; users must log in again.
This change does not implement token revocation on logout or refresh-token reuse
detection, and does not complete frontend routing or Keycloak migration to NestJS.

Validation from `backend-nest`:

```powershell
npm ci
npx prisma generate
npm test
npm run build
npm run lint
```

The regression tests mock database and HTTP boundaries. They do not substitute
for a live PostgreSQL, Django and Celery integration test.

## Additional access checks

Task lists, task details, comments, activity feeds and agent traces enforce
organization and project visibility. Ordinary members can edit or delete only
tickets they created or are assigned. QA result fields require QA or privileged
access, and dedicated QA actions require an accessible ticket in the QA stage.

Task assignees and project members must belong to the caller's organization.
Project membership replacement and project field updates use one nested Prisma
write. Personal plan items require a visible task; focus sessions can reference
only the caller's plan items in their current organization.

NestJS deployment, rollback and SEO creation now return HTTP 503 because no real
execution provider is wired to those endpoints. They no longer write fabricated
success records, logs or audit scores. Existing historical records are retained.
Mock billing requires both `ALLOW_MOCK_BILLING=true` and `NODE_ENV=development`
or `NODE_ENV=test`; it is always disabled in production. Responses explicitly
identify simulated billing with `mock: true`.

These changes are in the NestJS API. Django's deployment/SEO implementations and
the frontend's default Django routing have not been migrated by this patch.

Additional verification commands:

```powershell
npm run test:e2e
npm run test:django-compat
```

The HTTP suite automatically builds and tests the compiled NestJS application
with a mocked database. The Django compatibility check automatically builds,
then runs against the Django libraries in the running `teamflow-backend`
container (override with `DJANGO_TEST_CONTAINER`). It uses synthetic passwords
and a temporary signing key to verify password and SimpleJWT compatibility.
It does not write database records or enqueue any work.
