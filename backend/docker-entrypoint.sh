#!/bin/sh
set -e

# APP_ROLE=web    -> wait for the database, migrate, collect static files, then run the command.
# APP_ROLE=worker -> wait for the database, then run the command (no migrations).
APP_ROLE="${APP_ROLE:-web}"
APP_USER="app"

# Start as root only to prepare writable volumes, then drop privileges.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /workspace/generated_projects /app/staticfiles
  # Only touch entries with the wrong owner (volumes created by older root images).
  find /workspace/generated_projects /app/staticfiles ! -user "$APP_USER" -exec chown "$APP_USER:$APP_USER" {} + 2>/dev/null || true
  export HOME="/home/$APP_USER"
  exec setpriv --reuid="$APP_USER" --regid="$APP_USER" --init-groups "$0" "$@"
fi

echo "=== TeamFlow backend (${APP_ROLE}) initializing as $(id -un) ==="

# Git defaults for agent workspaces. Agent commands run only inside
# /workspace/generated_projects (see agents/git_service.py).
git config --global --add safe.directory '/workspace/generated_projects/*' || true
git config --global init.defaultBranch main || true
if [ -n "${GIT_AUTHOR_NAME:-}" ] && [ -n "${GIT_AUTHOR_EMAIL:-}" ]; then
  git config --global user.name "$GIT_AUTHOR_NAME" || true
  git config --global user.email "$GIT_AUTHOR_EMAIL" || true
fi

# Wait for PostgreSQL if DATABASE_URL is provided
if [ -n "${DATABASE_URL:-}" ]; then
  echo "Waiting for database connection..."
  python - <<'EOF'
import sys
import time
import environ
import psycopg2

env = environ.Env()
db_config = env.db_url("DATABASE_URL")

for attempt in range(30, 0, -1):
    try:
        conn = psycopg2.connect(
            dbname=db_config.get("NAME", ""),
            user=db_config.get("USER", ""),
            password=db_config.get("PASSWORD", ""),
            host=db_config.get("HOST", "localhost"),
            port=db_config.get("PORT", 5432),
            connect_timeout=3,
        )
        conn.close()
        print("Database connection established.")
        sys.exit(0)
    except Exception as exc:
        print(f"Waiting for database ({exc.__class__.__name__})... {attempt} attempts left")
        time.sleep(1)

print("Error: database connection timed out.")
sys.exit(1)
EOF
fi

if [ "$APP_ROLE" = "web" ]; then
  echo "Applying database migrations..."
  python manage.py migrate --noinput

  echo "Ensuring platform admin account..."
  python manage.py init_admin || echo "Admin initialization skipped."

  if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
    echo "Seeding demo data..."
    python manage.py seed_demo || echo "Demo data already initialized or skipped."
  fi

  echo "Collecting static files..."
  python manage.py collectstatic --noinput --clear
fi

echo "=== TeamFlow backend (${APP_ROLE}) ready ==="
exec "$@"
