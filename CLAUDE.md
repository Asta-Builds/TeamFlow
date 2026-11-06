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

### 2.3 Verification Commands (Run Before Submitting)
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

---

## 3. The "Never Do" List

1. **NEVER use raw emojis** in any frontend component, markup, or notification. Use `lucide-react`.
2. **NEVER alter or weaken CI safety workflows** (`.github/workflows/ci.yml`, `deploy.yml`). These are locked Red-Zone files.
3. **NEVER edit generated migrations manually** without running dry-run checks on both Django (`makemigrations --check`) and Prisma (`prisma validate`).
4. **NEVER re-implement existing utility functions**. Check `@/components/ui`, `lib/`, and existing services before writing new helpers.
5. **NEVER hardcode test logic or mock invariants** to artificially pass a failing test.
6. **NEVER store structured objects via `JSON.stringify`** into untyped text columns when a typed relational schema exists.
7. **NEVER bypass JWT authentication** or Keycloak token validation.

---

## 4. Blast-Radius Awareness for PRs

- **Green Zone (Fast Path)**: Changes strictly inside `frontend/src/app/**` (page layouts, presentation cards).
- **Yellow Zone (Skim Review)**: `frontend/src/components/ui/**`, `backend-nest/src/modules/**`, CLI scripts.
- **Red Zone (Deep Review Mandatory)**: `backend/core/**`, `backend-nest/prisma/schema.prisma`, `backend/*/migrations/**`, `.github/workflows/**`, `docker-compose*.yml`.

