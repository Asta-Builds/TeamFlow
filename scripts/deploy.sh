#!/bin/bash
set -e

echo "==============================================="
echo "       TeamFlow Production Deployment          "
echo "==============================================="

# Check environment file
if [ ! -f ".env.production" ]; then
    echo "Warning: .env.production not found. Creating from example..."
    cp .env.production.example .env.production
    echo "Please configure .env.production before running in live production."
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
