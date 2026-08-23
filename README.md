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

## Quick start

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
cd backend && python manage.py test
```

## Roadmap (per the blueprint)

- Celery + Redis for async jobs (email, real SEO crawls, webhooks)
- Postgres in staging/prod via `DATABASE_URL`
- GitHub Actions CI/CD, Terraform infra, Grafana + Prometheus monitoring
- Design system + marketing site (second frontend surface)
