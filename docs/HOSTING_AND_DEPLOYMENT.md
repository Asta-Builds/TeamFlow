# 🚀 TeamFlow Hosting & Production Deployment Guide

This guide covers complete self-hosting and production deployment for **TeamFlow**, including Docker Compose, GPU passthrough (NVIDIA CUDA), Keycloak SSO, PostgreSQL + pgvector, SSL certificates, and Cloud hosting (Render, Railway, Kubernetes, VPS).

---

## 📋 System Requirements

| Component | Minimum Specification | Recommended (Production / AI Swarm) |
| :--- | :--- | :--- |
| **Operating System** | Ubuntu 22.04 LTS / Debian 12 / Windows 11 WSL2 | Ubuntu 24.04 LTS / Debian 12 |
| **CPU** | 4 Cores (x86_64) | 8+ Cores |
| **RAM** | 8 GB | 16 GB - 32 GB |
| **GPU (AI Swarm)** | CPU Inference (Fallback) | **NVIDIA GPU with 8GB - 12GB+ VRAM** (e.g. RTX 3060, RTX 4070, A10G, T4) |
| **Storage** | 25 GB SSD | 100 GB NVMe SSD |

---

## ⚡ Option 1: Quickstart with Docker Compose (Recommended)

### 1. Clone the Repository
```bash
git clone https://github.com/Asta-Builds/TeamFlow.git
cd TeamFlow
```

### 2. Configure Environment Variables
Copy and adjust `.env.production`:
```bash
cp .env.production.example .env.production
```

Key environment variables in `.env.production`:
```ini
DEBUG=False
SECRET_KEY=generate-a-strong-random-64-char-secret-key
ALLOWED_HOSTS=teamflow.yourdomain.com,localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=https://teamflow.yourdomain.com,http://localhost:3000

# Database & Cache
DATABASE_URL=postgres://teamflow:your_secure_password@db:5432/teamflow
REDIS_URL=redis://redis:6379/0

# Keycloak SSO
KEYCLOAK_URL=http://keycloak:8080/realms/teamflow
KEYCLOAK_CLIENT_ID=teamflow-app
KEYCLOAK_CLIENT_SECRET=
NEXT_PUBLIC_KEYCLOAK_URL=https://auth.yourdomain.com

# Integration credentials (optional, but never commit these values)
SLACK_SIGNING_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_GROWTH=
STRIPE_PRICE_ENTERPRISE=

# Ollama GPU Backend
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5-coder:7b
OLLAMA_KEEP_ALIVE=-1
OLLAMA_FLASH_ATTENTION=1

# Observability
LANGFUSE_PUBLIC_KEY=pk-lf-prod-teamflow
LANGFUSE_SECRET_KEY=sk-lf-prod-teamflow
LANGFUSE_HOST=http://langfuse:3000
```

### 3. Launch Stack with GPU Support
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up --build -d
```

The production composition fails fast when the database password, Keycloak admin
credentials, Django secret, allowed hosts, CORS origins, or CSRF origins are
missing. It does not seed demonstration users. Local demo data is enabled only
by `docker-compose.yml` through `SEED_DEMO_DATA=true`.

### 4. Verify Services Health
```bash
docker compose ps
```

| Service | Port | Description |
| :--- | :--- | :--- |
| **Frontend** | `3000` | Next.js 16 App Router UI |
| **Backend API** | `8000` | Django REST Framework API & Swagger Docs |
| **Keycloak SSO** | `8080` | Identity Provider & OAuth 2.0 / OpenID Connect |
| **Ollama GPU** | `11434` | Local LLM inference engine on NVIDIA CUDA |
| **Langfuse** | `3001` | Agent execution traces & LLM observability |
| **PostgreSQL** | `5432` | Postgres 16 with pgvector extension |
| **Redis** | `6379` | Cache & realtime message queue |

---

## 🎮 Enabling NVIDIA GPU Passthrough (CUDA)

For Linux servers (Ubuntu/Debian):

1. **Install NVIDIA Container Toolkit:**
   ```bash
   distribution=$(. /etc/os-release;echo $ID$VERSION_ID) \
   && curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
   && curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
      sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
      sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
   sudo apt-get update
   sudo apt-get install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```

2. **Verify GPU in Container:**
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
   ```

---

## 🔒 Nginx Reverse Proxy & SSL (Let's Encrypt)

Create an Nginx configuration `/etc/nginx/sites-available/teamflow`:

```nginx
server {
    server_name teamflow.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable SSL certificate with Certbot:
```bash
sudo certbot --nginx -d teamflow.yourdomain.com
```

---

## ☁️ Cloud Platforms (Render, Railway, Kubernetes)

- **Render:** Connect GitHub repo. Render will detect `render.yaml` and provision web services and database automatically.
- **Railway:** One-click template with `railway.json`.
- **Kubernetes:** Manifests located in `k8s/`:
  ```bash
  kubectl apply -f k8s/namespace.yaml
  # Create this locally from real, uncommitted values first.
  kubectl -n teamflow create secret generic teamflow-secrets \
    --from-literal=SECRET_KEY='...' \
    --from-literal=DATABASE_URL='postgres://...' \
    --from-literal=CELERY_BROKER_URL='redis://...' \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl apply -f k8s/configmap-secrets.yaml
  kubectl apply -f k8s/backend-deployment.yaml
  kubectl apply -f k8s/frontend-deployment.yaml
  kubectl apply -f k8s/ingress.yaml
  ```

## CI/CD boundary

`.github/workflows/ci.yml` validates migrations, backend tests, frontend lint,
and the production build. `.github/workflows/deploy.yml` publishes verified
backend and frontend images to GHCR; it intentionally does not apply a release
to a cloud account or Kubernetes cluster. Connect that publish step to a
CEO-approved target and store deployment credentials in the target platform's
secrets manager before enabling automatic rollout.
