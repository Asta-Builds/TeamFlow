# TeamFlow

Internal **project & ticket management platform** — the first build of the
[Virtual Tech Company Blueprint](./Virtual_Tech_Company_Blueprint.md). A
lightweight blend of Linear and Notion where the team tracks projects,
tickets, and deployments in one place.

- **Backend:** Django + Django REST Framework, JWT auth, SQLite (dev) / Postgres (prod)
- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4
- **Docs:** OpenAPI schema + Swagger UI at `/api/docs/`

```
TeamFlow/
├─ backend/     # Django REST API (accounts, projects, tasks, deployments, seo)
├─ frontend/    # Next.js app (dashboard, projects, Kanban board, team, deployments)
└─ Virtual_Tech_Company_Blueprint.md
```

## Quick start with Docker (Recommended)

Run the entire stack (PostgreSQL database, Django API backend, Next.js frontend) with a single command:

```bash
docker compose up --build -d
```

- **Frontend App:** [http://localhost:3000](http://localhost:3000)
- **Backend API & Swagger Docs:** [http://localhost:8000/api/docs/](http://localhost:8000/api/docs/)
- **Demo Login:** `lead@teamflow.dev` (or any `@teamflow.dev` email) with password `teamflow-demo-pw`

To view logs or stop the containers:
```bash
docker compose logs -f
docker compose down
```

## Manual Local Development

### 1. Backend (API on http://127.0.0.1:8000)

```bash
# from the repo root — a .venv already exists
.venv/Scripts/python.exe -m pip install -r backend/requirements.txt   # Windows
# source .venv/bin/activate && pip install -r backend/requirements.txt # macOS/Linux

cd backend
python manage.py migrate
python manage.py seed_demo        # demo team + project + tickets
python manage.py runserver 127.0.0.1:8000
```

Demo login: any `@teamflow.dev` email (e.g. `lead@teamflow.dev`) with password
`teamflow-demo-pw`. Create an admin with `python manage.py createsuperuser`.

### 2. Frontend (app on http://localhost:3000)

```bash
cd frontend
npm install          # already installed if scaffolded here
npm run dev
```

The frontend reads the API base URL from `frontend/.env.local`
(`NEXT_PUBLIC_API_URL`, defaults to `http://127.0.0.1:8000/api`).

## API surface

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/{register,login,refresh,logout}/`, `GET /api/auth/me/` |
| Users | `/api/users/` |
| Projects | `/api/projects/` |
| Tasks | `/api/tasks/` (+ `/api/tasks/{id}/comments/`) |
| Comments | `/api/comments/` |
| Deployments | `/api/deployments/` (+ `/{id}/status/`) |
| SEO audits | `/api/seo/audits/` |
| Docs | `/api/schema/`, `/api/docs/` |

Auth uses JWT (SimpleJWT). Send `Authorization: Bearer <access>` on API calls.
Reads are open to any authenticated user; project/task edits are restricted to
the owner/assignee or a privileged role (Tech Lead / CEO); deployments and SEO
audits are privileged-write.

## Tests

```bash
# Run backend test suite
cd backend && python manage.py test

# Run frontend build & lint
cd frontend && npm run build
```

## Production Deployment

TeamFlow is fully prepared for multi-environment deployment (Docker, Nginx, Kubernetes, Render, Railway, AWS):

### 1. Full Production Stack with Docker Compose (Nginx + PostgreSQL + Redis + Celery + Django + Next.js)

```bash
# Windows
.\scripts\deploy.ps1

# Linux / macOS
chmod +x ./scripts/deploy.sh
./scripts/deploy.sh

# Or directly with Docker Compose:
docker compose -f docker-compose.prod.yml --env-file .env.production up --build -d
```

### 2. Cloud Platforms

- **Render:** Blueprint configured in [`render.yaml`](./render.yaml). Link your GitHub repository to Render for automatic 1-click deployment of database, Redis, Celery worker, backend API, and frontend.
- **Railway:** Configuration in [`railway.json`](./railway.json).
- **Kubernetes:** Production manifests located in [`k8s/`](./k8s/) (`namespace.yaml`, `configmap-secrets.yaml`, `backend-deployment.yaml`, `frontend-deployment.yaml`, `ingress.yaml`).
- **Terraform / AWS:** Infrastructure as code scaffolding in [`terraform/`](./terraform/).

### 3. CI/CD Pipelines

- **CI Workflow:** [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) automatically runs Django unit tests, database migrations check, and Next.js typechecking on every push / pull request.
- **CD Workflow:** [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) packages and publishes production Docker images to GitHub Container Registry (GHCR).
