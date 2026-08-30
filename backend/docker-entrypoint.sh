#!/bin/sh
set -e

echo "=== TeamFlow Backend Initializing ==="

# Configure Git safe directories and defaults for swarm agents
git config --global --add safe.directory /workspace || true
git config --global --add safe.directory /app || true
git config --global user.email "swarm@teamflow.dev" || true
git config --global user.name "TeamFlow AI Swarm" || true
git config --global init.defaultBranch main || true

# Wait for PostgreSQL if DATABASE_URL is provided
if [ -n "$DATABASE_URL" ]; then
  echo "Waiting for database connection..."
  python - <<'EOF'
import sys
import time
import environ
import psycopg2

env = environ.Env()
db_config = env.db_url("DATABASE_URL")

user = db_config.get("USER", "")
password = db_config.get("PASSWORD", "")
host = db_config.get("HOST", "localhost")
port = db_config.get("PORT", 5432)
name = db_config.get("NAME", "")

max_retries = 30
while max_retries > 0:
    try:
        conn = psycopg2.connect(
            dbname=name,
            user=user,
            password=password,
            host=host,
            port=port,
            connect_timeout=3
        )
        conn.close()
        print("Database connection established!")
        sys.exit(0)
    except Exception as e:
        print(f"Waiting for database ({e})... {max_retries} attempts left")
        time.sleep(1)
        max_retries -= 1

print("Error: Database connection timed out.")
sys.exit(1)
EOF
fi

echo "Applying database migrations..."
python manage.py migrate --noinput

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  echo "Seeding demo data..."
  python manage.py seed_demo || echo "Demo data already initialized or skipped."
else
  echo "Skipping demo-data seed. Set SEED_DEMO_DATA=true for a local demo environment."
fi

echo "Collecting static files..."
python manage.py collectstatic --noinput --clear || true

echo "=== TeamFlow Backend Ready. Starting server ==="
exec "$@"
