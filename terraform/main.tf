terraform {
  required_version = ">= 1.5.0"
  required_providers {
    railway = {
      source  = "terraform-community-providers/railway"
      version = ">= 0.4.0"
    }
  }
}

provider "railway" {
  token = var.railway_token != "" ? var.railway_token : null
}

# 1. TeamFlow Managed Project
resource "railway_project" "teamflow" {
  name        = var.project_name
  description = "TeamFlow: Autonomous AI Multi-Agent Virtual Tech Management Platform"
}

# 2. Database Service (PostgreSQL 16 + pgvector)
resource "railway_service" "db" {
  name       = "teamflow-db"
  project_id = railway_project.teamflow.id
}

# 3. Redis Service (Cache & Broker)
resource "railway_service" "redis" {
  name       = "teamflow-redis"
  project_id = railway_project.teamflow.id
}

# 4. Django REST Backend Core API
resource "railway_service" "backend" {
  name       = "teamflow-backend"
  project_id = railway_project.teamflow.id
}

# 5. Celery Autonomous Swarm Worker
resource "railway_service" "celery" {
  name       = "teamflow-celery"
  project_id = railway_project.teamflow.id
}

# 6. Next.js 16 SuperDesign Frontend
resource "railway_service" "frontend" {
  name       = "teamflow-frontend"
  project_id = railway_project.teamflow.id
}

# Outputs
output "railway_project_id" {
  value       = railway_project.teamflow.id
  description = "ID of the provisioned Railway project"
}

output "services" {
  value = {
    db       = railway_service.db.id
    redis    = railway_service.redis.id
    backend  = railway_service.backend.id
    celery   = railway_service.celery.id
    frontend = railway_service.frontend.id
  }
  description = "IDs of the provisioned TeamFlow services on Railway"
}
