# Project: TeamFlow Production Engineering Readiness (Phase 0 & Phase 1)

## Architecture
TeamFlow is a multi-service monorepo supporting an agentic software development workspace:
- **`frontend/`**: Next.js 16 (React 19, Tailwind CSS, Lucide icons, Vitest, ESLint 9 Flat Config)
- **`backend-nest/`**: NestJS 12 API Gateway (TypeScript, Prisma 6 ORM, Vitest, WebSocket/SSE)
- **`backend/`**: Django 5.1 / Python 3.13 Core & Microservices (PostgreSQL 16, pgvector, Celery, REST framework)
- **`cli/`**: Python CLI (Typer, Rich, Prompt Toolkit, HTTPX, Unittest)
- **`nginx/`** & **Docker Compose**: Reverse proxy routing, containerization, local development stack
- **`.github/workflows/`**: Continuous integration and autonomous implementer workflows

## Feature Inventory
Every feature from the Phase 0 and Phase 1 Survey is inventoried and assigned to a milestone:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | TypeScript Compiler Gate (Frontend) | `tsc --noEmit` validates Next.js static types with 0 errors | M1 | Survey |
| 2 | TypeScript Compiler Gate (Backend-Nest) | `tsc --noEmit -p tsconfig.json` validates NestJS static types with 0 errors | M1 | Survey |
| 3 | Prisma Validate Gate | `prisma validate` verifies `backend-nest/prisma/schema.prisma` with `DATABASE_URL` fallback | M1 | Survey |
| 4 | ESLint Gate (Frontend) | ESLint 9 flat config enforced with `--max-warnings 0` | M1 | Survey |
| 5 | ESLint Configuration & Gate (Backend-Nest) | Install ESLint 9 config in `backend-nest` to replace/augment oxlint with 0 errors/warnings | M1 | Survey |
| 6 | Knip Dead Code Detection | Monorepo dead code, unused exports, and unlisted dependency removal with zero tolerance | M1 | Survey |
| 7 | JSCPD Code Duplication Detection | Monorepo copy/paste detector with custom thresholds & ignore rules for DTOs/skeletons | M1 | Survey |
| 8 | Django System Check Gate | `python manage.py check` exits 0 with 0 issues | M1 | Survey |
| 9 | Django Migration Drift Gate | `python manage.py makemigrations --check --dry-run` exits 0 with "No changes detected" | M1 | Survey |
| 10 | Zero-Emoji Enforcement | Remove unicode emoji `⚡` from `frontend/src/app/(app)/projects/[id]/page.tsx:1547` per CLAUDE.md | M1 | Survey |
| 11 | Database Schema Lockdown | Red-zone CODEOWNERS protection for `backend-nest/prisma/schema.prisma` | M2 | Survey |
| 12 | Database Migrations Lockdown | Red-zone CODEOWNERS protection for all 11 Django migration directories (`backend/*/migrations/**`) | M2 | Survey |
| 13 | CI/CD Workflow Lockdown | Red-zone CODEOWNERS protection for `.github/workflows/**` and `.github/CODEOWNERS` | M2 | Survey |
| 14 | Docker & Nginx Infrastructure Lockdown | Red-zone CODEOWNERS protection for Dockerfiles, docker-compose, and nginx configs | M2 | Survey |
| 15 | Core Backend & Auth Lockdown | Red-zone CODEOWNERS protection for `backend/teamflow/settings.py` and `backend-nest/src/modules/auth/` | M2 | Survey |
| 16 | One-Command Setup Script | Cross-platform setup script (`scripts/setup.sh` & `scripts/setup.ps1` / root package) | M3 | Survey |
| 17 | One-Command Build Script | Cross-platform build script (`scripts/build.sh` & `scripts/build.ps1` / root package) | M3 | Survey |
| 18 | One-Command Lint Script | Cross-platform lint script (`scripts/lint.sh` & `scripts/lint.ps1` / root package) | M3 | Survey |
| 19 | One-Command Test Script | Cross-platform test runner (`scripts/test.sh` & `scripts/test.ps1`, replacing hardcoded paths) | M3 | Survey |
| 20 | One-Command Seed Script | Cross-platform seed script (`scripts/seed.sh` & `scripts/seed.ps1`) executing `seed_demo.py` | M3 | Survey |
| 21 | Standardized Package.json Scripts | Standardize `typecheck`, `lint`, `test`, `build`, `knip`, `gate` in frontend & backend-nest | M3 | Survey |
| 22 | Automated Implementer Workflow Template | GitHub Actions workflow `.github/workflows/agent-implementer.yml` triggered on issue labeled `agent` | M4 | Survey |
| 23 | Concurrency & Circuit Breakers | Concurrency per issue ID, 25-minute hard timeout, 100-turn cap in implementer workflow | M4 | Survey |
| 24 | Deterministic Gates in Workflow | Workflow steps executing tsc, eslint, knip, jscpd, django checks, and tests before PR creation | M4 | Survey |
| 25 | Failure Handling (`factory-stuck`) | Failure step automatically applying `factory-stuck` label and diagnostic comment on failure | M4 | Survey |
| 26 | Comprehensive E2E Verification Gate | Unified verification verifying all 6 acceptance criteria pass cleanly with exit code 0 | M5 | Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Deterministic Quality Gates | Configure Knip, JSCPD, ESLint (backend-nest), fix dead code, clean exports, fix emoji violation, verify tsc/prisma/django | none | DONE (knip 0 errors, jscpd 1.12% <= 3%, eslint 0 warnings, tsc 0 errors, prisma valid, django clean) |
| 2 | M2: Red-zone CODEOWNERS Guardrails | Establish `.github/CODEOWNERS` covering database schemas, migrations, workflows, docker/nginx configs, core auth | none | DONE (.github/CODEOWNERS created with 53 explicit rules covering 100% of red-zone files) |
| 3 | M3: Standardized One-Command Scripts & Seeds | Create cross-platform root scripts (`setup`, `build`, `lint`, `test`, `seed`), update package.json scripts, fix hardcoded paths | M1 | DONE (created setup, build, lint, test, seed in .sh and .ps1; removed hardcoded paths in test_all.ps1; all scripts exit 0) |
| 4 | M4: Automated Implementer Agent Workflow | Draft `.github/workflows/agent-implementer.yml` with concurrency, 25m timeout, 100-turn cap, deterministic gates, `factory-stuck` | M1, M2 | DONE (.github/workflows/agent-implementer.yml created and validated against SchemaStore schema with all circuit breakers) |
| 5 | M5: Final Verification & Integration Gate | Run and verify all deterministic gates, scripts, seeds, and workflows against all acceptance criteria | M1, M2, M3, M4 | DONE (all 7 deterministic gates, CODEOWNERS, one-command scripts, seed idempotence, and implementer workflow fully verified; Gate: PASS) |

## Interface Contracts
### Gate Execution Contract ↔ Monorepo Services
- Every deterministic gate script must exit code `0` on clean pass and code `1+` on any failure.
- `DATABASE_URL` must be provided with fallback (`postgresql://test:test@localhost:5432/test`) during Prisma schema validation so offline / pre-commit validation does not require active database network connections.
- `SECRET_KEY` must be passed with minimum 32 chars for Django system checks (`python manage.py check`).
- ESLint must run with `--max-warnings 0`.

### CODEOWNERS Contract ↔ GitHub Branch Protection
- Syntax must adhere to GitHub CODEOWNERS format.
- Every red-zone file category must have explicit patterns mapped to designated owners (`@abdelilah` / team lead).

### Script Contract ↔ Environment
- All scripts must operate dynamically relative to repository root (`PSScriptRoot` or `$(cd "$(dirname "$0")/.." && pwd)`), without hardcoded absolute drive letters (e.g. `f:\...`).
- Python scripts must use environment detection (active venv, `.venv/Scripts/python`, `uv run`, or system `python`).

## Code Layout
- `TeamFlow/frontend/`: Next.js application
  - `knip.json`: Knip configuration for frontend
  - `package.json`: Updated with standardized scripts (`typecheck`, `knip`, `gate`)
  - `src/app/(app)/projects/[id]/page.tsx`: Fixed zero-emoji violation
- `TeamFlow/backend-nest/`: NestJS application
  - `eslint.config.mjs`: ESLint configuration for NestJS
  - `knip.json`: Knip configuration for backend-nest
  - `package.json`: Updated with ESLint dependencies and standardized scripts
  - Cleaned dead files: `src/app.service.ts`, `src/common/decorators/roles.decorator.ts`, `src/common/guards/roles.guard.ts`
- `TeamFlow/.jscpd.json`: Root JSCPD configuration file
- `TeamFlow/.github/`:
  - `CODEOWNERS`: Explicit ownership rules for red-zone files
  - `workflows/ci.yml`: CI workflow incorporating deterministic quality gates
  - `workflows/agent-implementer.yml`: Automated implementer agent workflow template
- `TeamFlow/scripts/`:
  - `setup.sh` / `setup.ps1`: One-command environment and dependency setup
  - `build.sh` / `build.ps1`: One-command build across all services
  - `lint.sh` / `lint.ps1`: One-command linting and static checks across all services
  - `test.sh` / `test.ps1`: One-command unit & integration test runner
  - `seed.sh` / `seed.ps1`: One-command database seeding runner
