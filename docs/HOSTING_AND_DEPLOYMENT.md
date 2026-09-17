# TeamFlow hosting and deployment

**Updated:** 2026-09-16

The supported way to run TeamFlow outside a developer machine is
`docker-compose.prod.yml`. The full checklist, routing table, provider contracts
and open items are in the [pre-production runbook](PREPROD_RUNBOOK.md).

## Services

| Service | Image | Purpose |
| --- | --- | --- |
| `nginx` | `nginx:1.27-alpine` | Only published port; routes traffic, rate-limits sign-in |
| `frontend` | `frontend/Dockerfile` | Next.js web app |
| `backend_nest` | `backend-nest/Dockerfile` | NestJS application API (`/api`) |
| `backend` | `backend/Dockerfile` | Django execution service: agents, git, deployments, integrations, Stripe |
| `celery_worker` | same image as `backend` | Background agent runs |
| `db` | `pgvector/pgvector:pg16` | PostgreSQL with pgvector |
| `redis` | `redis:7-alpine` | Celery broker |

Langfuse and LLM providers are external and optional.

## Requirements

- Linux host with Docker Engine 24+ and the Compose plugin.
- 4 vCPU and 8 GB RAM minimum for the stack; more for many concurrent agent runs.
- A TLS-terminating reverse proxy or load balancer in front of the `nginx` container.

## Quick start

```bash
git clone https://github.com/Asta-Builds/TeamFlow.git
cd TeamFlow
cp .env.production.example .env.production   # fill in every value
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
python scripts/smoke_preprod.py --base-url https://teamflow.example.com
```

## TLS with a host reverse proxy

Publish nginx on loopback (`HTTP_BIND=127.0.0.1`, `HTTP_PORT=8080`) and proxy to it:

```nginx
server {
    listen 443 ssl http2;
    server_name teamflow.example.com;
    # ssl_certificate / ssl_certificate_key from certbot or your CA

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;              # server-sent agent events
        proxy_read_timeout 3600s;
    }
}

server {
    listen 80;
    server_name teamflow.example.com;
    return 301 https://$host$request_uri;
}
```

## CI/CD

- `.github/workflows/ci.yml` runs Django tests, migration and deploy checks,
  NestJS lint, type check, unit and HTTP tests, the frontend lint, tests and build,
  validates the production compose and nginx configuration, and builds all images.
- `.github/workflows/deploy.yml` publishes `ghcr.io/<owner>/<repo>-backend`,
  `-backend-nest` and `-frontend` after CI succeeds on `main` (tags `main`,
  `sha-<commit>`) and for `v*.*.*` tags. It does not roll out to any environment.

## Local development

`docker-compose.yml` runs the same services with published ports for debugging
(`3000`, `8000`, `8001`, `3001` for Langfuse). Copy `.env.example` to `.env` first.

## Other manifests

`k8s/`, `render.yaml` and `railway.json` predate the NestJS API and the current
routing. They are not maintained and should not be used without being rebuilt
from `docker-compose.prod.yml`.
