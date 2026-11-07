# TeamFlow — Claude Code & Agent Guidelines

TeamFlow is an autonomous AI software company platform where specialized agents plan, code, review, test, and deploy full-stack applications in isolated repositories.

---

## 1. Monorepo Architecture & Services

| Directory | Role | Stack | Port |
|---|---|---|---|
| `frontend/` | Web Client & Reasoning Terminal | Next.js 16 (App Router, React 19, Tailwind CSS, Turbopack) | 3000 |
| `backend-nest/` | Type-Safe API Gateway & Event Stream | NestJS 12, Prisma ORM Client, SSE Distributor | 8001 |
| `backend/` | AI Agent Engine, Celery Workers, RAG | Django 5 REST Framework, LangGraph, Antigravity SDK | 8000 |
| `cli/` | Developer & Agent CLI Tool | Python 3.10+ Click / Typer CLI | — |
| `deploy-receiver/` | Ephemeral Deployment Receiver | Node.js / Docker runner | 9000 |
| `nginx/` | Reverse Proxy & Routing | Nginx Alpine | 80 / 443 |

---

## 2. Strict Engineering Rules

### 2.1 UI & Frontend Standards (`frontend/`)
- **Zero-Emoji Policy**: NEVER use raw emojis in UI code. All icons must be imported as vector components from `lucide-react` (with `aria-hidden="true"` when paired with labels).
- **Interactive Feedback**: Always use **Sonner toasts** (`toast.success()`, `toast.error()`, `toast.promise()`) instead of browser dialogs or native `alert()`.
- **Styling**: SuperDesign dark canvas (`bg-slate-950`), cards (`bg-slate-900/90`), hairline borders (`border-slate-800`).
- **Real-Time Streaming**: Stream reasoning steps via SSE from `/api/agents/events/stream/`. UI latency must remain under 200ms.

### 2.2 Data Access & Boundaries
- **Frontend**: NEVER connect directly to the database. All CRUD operations go through the NestJS Gateway (`/api/...`).
- **NestJS Gateway**: Uses Prisma Client with mapped tables (`@@map`) matching the PostgreSQL 16 schema.
- **Django Engine**: Uses Django ORM for migrations and agent worker states, plus `pgvector` for embeddings.
- **Never bypass the Gateway** from the frontend client.
- These boundaries are enforced, not just written down: ESLint `no-restricted-imports` blocks database
  drivers and other packages' code in `frontend/`, and other packages' code in `backend-nest/`; ruff
  `TID251` (`cli/ruff.toml`) blocks Django, DRF and Celery imports in `cli/`.

### 2.3 Size and complexity limits
- Functions stay at cyclomatic complexity 15 or less, and files at 300 lines or less (blank lines and
  comments excluded; tests are exempt from the line limit). ESLint fails the build otherwise.
- Files that were already over the limits are listed in `frontend/eslint.legacy.mjs` and
  `backend-nest/eslint.legacy.mjs`, and older Python findings in the `per-file-ignores` of `ruff.toml`.
  These lists only shrink: when you split or clean one of those files, delete its entry. Never add one;
  split the file instead.

### 2.4 Verification Commands (Run Before Submitting)
- **Everything at once**: `scripts/lint.sh` (or `scripts/lint.ps1`) runs all nine gates: ESLint x2,
  jscpd, knip x2, `prisma validate`, Django `check`, `makemigrations --check`, and ruff.
- **Pre-commit hook**: `scripts/setup.sh` sets `core.hooksPath` to `.githooks`, which lints the staged
  TypeScript and Python files before each commit. CI runs every gate regardless.
- **Frontend**:
  ```bash
  cd frontend
  npm run lint
  npx tsc --noEmit
  npm test
  npm run build
  ```
- **Backend NestJS**:
  ```bash
  cd backend-nest
  npm run lint
  npx tsc --noEmit -p tsconfig.json
  npm test
  npm run test:e2e
  ```
- **Backend Django**:
  ```bash
  cd backend
  python manage.py check
  python manage.py makemigrations --check --dry-run
  python manage.py test --noinput
  ```
- **Python lint** (repo root): `ruff check backend cli` (CI uses ruff 0.17.4).
- **End-to-end journeys** (with the stack running): `cd e2e && npm ci && npm run test:smoke`. CI runs
  `@smoke` and `@visual` on every PR and the full suite nightly (`.github/workflows/e2e.yml`).

### 2.5 Critical user journeys (`e2e/`)
- The journeys that must never break are listed in `e2e/README.md`, each with its Playwright test.
- If you change one of those flows, update its test in the same PR. If you add a user-facing flow,
  add a journey and tag it `@smoke` if every PR should run it.
- E2E tests use the real stack: never mock the API or the database there. Each test creates its own
  account with a random password; never commit credentials or reuse accounts between tests.
- A failing `toHaveScreenshot` is a visual change. If it's intended, delete the old baseline and
  commit the one CI records (`visual-baselines` artifact). Never raise the tolerance to get green.

### 2.6 MCP servers (`.mcp.json`)
Claude Code asks you to approve these the first time. Secrets come from your environment, never the file.

| Server | What it gives an agent | Set up |
|---|---|---|
| `github` | Read-only GitHub: issues, PRs, CI runs (`/mcp/readonly`) | Export `GITHUB_MCP_PAT`, a fine-grained token with read access to this repo |
| `postgres` | Read-only SQL on your local dev database (`--access-mode=restricted`) | Install `uv`; export `TEAMFLOW_DATABASE_URI=postgresql://USER:PASSWORD@localhost:5532/DB` with the values from `.env` |
| `sentry` | Errors, traces and releases from Sentry | Nothing; the first use opens a Sentry login in the browser |

Never point the `postgres` server at production, and never switch it to `unrestricted`.

---

## 3. The "Never Do" List

1. **NEVER use raw emojis** in any frontend component, markup, or notification. Use `lucide-react`.
2. **NEVER alter or weaken CI safety workflows** (`.github/workflows/ci.yml`, `deploy.yml`). These are locked Red-Zone files.
3. **NEVER edit generated migrations manually** without running dry-run checks on both Django (`makemigrations --check`) and Prisma (`prisma validate`).
4. **NEVER re-implement existing utility functions**. Check `@/components/ui`, `lib/`, and existing services before writing new helpers.
5. **NEVER hardcode test logic or mock invariants** to artificially pass a failing test.
6. **NEVER store structured objects via `JSON.stringify`** into untyped text columns when a typed relational schema exists.
7. **NEVER bypass JWT authentication** or Keycloak token validation.
8. **NEVER loosen a quality gate to get green**: no raising limits, no new entries in the legacy lists
   (`eslint.legacy.mjs`, `per-file-ignores` in `ruff.toml`), no `--no-verify`, no `eslint-disable` for
   `complexity`, `max-lines` or `no-restricted-imports`. Split the code instead.

---

## 4. Blast-Radius Awareness for PRs

- **Green Zone (Fast Path)**: Changes strictly inside `frontend/src/app/**` (page layouts, presentation cards).
- **Yellow Zone (Skim Review)**: `frontend/src/components/ui/**`, `backend-nest/src/modules/**`, CLI scripts.
- **Red Zone (Deep Review Mandatory)**: `backend/core/**`, `backend-nest/prisma/schema.prisma`, `backend/*/migrations/**`, `.github/workflows/**`, `docker-compose*.yml`, and the gate configs (`ruff.toml`, `*/eslint.config.mjs`, `*/eslint.legacy.mjs`, `.jscpd.json`, `*/knip.json`, `.githooks/**`, `.mcp.json`).

