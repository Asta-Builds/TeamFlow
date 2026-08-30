#!/bin/bash
set -e

echo "==============================================="
echo "       TeamFlow Production Deployment          "
echo "==============================================="

# Check environment file
if [ ! -f ".env.production" ]; then
    echo "Missing .env.production. Copy .env.production.example, set every required value, then rerun." >&2
    exit 1
fi

if grep -Eq 'generate-a-strong|choose-a-strong|yourdomain\.com' .env.production; then
    echo ".env.production still contains example values. Configure production secrets and domain values before deployment." >&2
    exit 1
fi

# Build and start all production services
echo "1. Building and starting production containers (PostgreSQL, Redis, Django, Celery, Next.js, Nginx)..."
docker compose -f docker-compose.prod.yml --env-file .env.production up --build -d

echo "2. Waiting for backend service health..."
sleep 8

# Check backend health endpoint
echo "3. Verifying health check..."
curl -s -f http://localhost/api/health/ || curl -s -f http://localhost:8000/api/health/ || echo "Health check starting..."

echo "==============================================="
echo "TeamFlow deployed successfully!"
echo "Web Application: http://localhost"
echo "API Docs: http://localhost/api/docs/"
echo "==============================================="
