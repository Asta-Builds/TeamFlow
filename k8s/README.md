# TeamFlow Kubernetes (k8s) & Terraform Deployment Guide

## 1. Kubernetes Deployment Architecture

The Kubernetes configuration in this directory deploys the complete TeamFlow architecture in the `teamflow` namespace:

- **Namespace**: `k8s/namespace.yaml`
- **Config & Secrets**: `k8s/configmap.yaml` & `k8s/secrets.yaml.example`
- **Database**: `k8s/postgres.yaml` (PostgreSQL 16 + pgvector with 10Gi PersistentVolumeClaim)
- **Caches & Queues**:
  - `k8s/redis.yaml` (Redis 7)
  - `k8s/rabbitmq.yaml` (RabbitMQ 3.13 with AMQP and Management UI on port 15672)
- **Application Services**:
  - `k8s/backend-deployment.yaml` (Django REST Framework core service with readiness/liveness probes)
  - `k8s/celery.yaml` (Autonomous Agent Celery worker)
  - `k8s/frontend-deployment.yaml` (Next.js 16 SuperDesign UI with internal `/api` reverse proxy)
- **Ingress**: `k8s/ingress.yaml` (Ingress-Nginx with TLS support)

---

### Step-by-Step Kubernetes Deployment

#### Prerequisites
1. A running Kubernetes cluster (GKE, EKS, AKS, or local Minikube / Kind / Docker Desktop).
2. `kubectl` connected to your cluster (`kubectl cluster-info`).

#### Step 1: Create Namespace and Secrets
```bash
# 1. Create the teamflow namespace
kubectl apply -f k8s/namespace.yaml

# 2. Copy the secrets template and configure your passwords
cp k8s/secrets.yaml.example k8s/secrets.yaml
# Edit k8s/secrets.yaml with your production passwords and secrets

# 3. Apply ConfigMap and Secrets
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml
```

#### Step 2: Deploy Data Layer (Postgres + Redis + RabbitMQ)
```bash
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/rabbitmq.yaml

# Wait for database and broker to become ready:
kubectl wait --namespace=teamflow --for=condition=ready pod -l app=teamflow-db --timeout=120s
kubectl wait --namespace=teamflow --for=condition=ready pod -l app=teamflow-redis --timeout=60s
kubectl wait --namespace=teamflow --for=condition=ready pod -l app=teamflow-rabbitmq --timeout=60s
```

#### Step 3: Deploy Application Services
```bash
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/celery.yaml
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/ingress.yaml
```

#### Step 4: Verify Deployment
```bash
kubectl get pods,services,ingress -n teamflow
```

---

## 2. Terraform AWS Deployment (`terraform/`)

The Terraform files in `terraform/` define an AWS cloud infrastructure:
- **VPC** (10.0.0.0/16) with 2 Public Subnets across availability zones
- **Internet Gateway & Route Tables**
- **ECS Cluster** (`teamflow-prod-cluster`)
- **S3 Bucket** for media assets and deployment artifacts

### Deploying with Terraform

#### Prerequisites
Set your AWS credentials in your environment:
```powershell
$env:AWS_ACCESS_KEY_ID="your-access-key-id"
$env:AWS_SECRET_ACCESS_KEY="your-secret-access-key"
$env:AWS_REGION="us-east-1"
```

#### Execution
```bash
cd terraform
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```
