#!/usr/bin/env bash
# TeamFlow One-Command Database Seed Script (POSIX / Bash)
# Seeds the database with default organization, CEO user, agent seats, projects, and sample tickets.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=================================================="
echo " TeamFlow One-Command Database Seed"
echo " Target: $REPO_ROOT"
echo "=================================================="

get_python() {
    if [ -x "$REPO_ROOT/backend/.venv/bin/python" ]; then
        echo "$REPO_ROOT/backend/.venv/bin/python"
    elif [ -x "$REPO_ROOT/backend/.venv/Scripts/python.exe" ]; then
        echo "$REPO_ROOT/backend/.venv/Scripts/python.exe"
    elif [ -x "$REPO_ROOT/.venv/bin/python" ]; then
        echo "$REPO_ROOT/.venv/bin/python"
    elif [ -x "$REPO_ROOT/.venv/Scripts/python.exe" ]; then
        echo "$REPO_ROOT/.venv/Scripts/python.exe"
    elif [ -n "${VIRTUAL_ENV:-}" ] && [ -x "${VIRTUAL_ENV}/bin/python" ]; then
        echo "${VIRTUAL_ENV}/bin/python"
    elif command -v uv >/dev/null 2>&1; then
        echo "uv-run"
    elif command -v python3 >/dev/null 2>&1; then
        echo "python3"
    elif command -v python >/dev/null 2>&1; then
        echo "python"
    else
        echo "Error: Python interpreter not found." >&2
        exit 1
    fi
}

run_python() {
    local py
    py="$(get_python)"
    if [ "$py" = "uv-run" ]; then
        uv run python "$@"
    else
        "$py" "$@"
    fi
}

# 1. Environment Defaults
export SECRET_KEY="${SECRET_KEY:-test-secret-key-32-chars-minimum-length}"

# 2. Apply Database Migrations
echo ""
echo ">> [1/3] Ensuring database migrations are applied..."
(cd "$REPO_ROOT/backend" && run_python manage.py migrate --noinput)
echo "Database migrations verified/applied."

# 3. Seed Demo Data (seed_demo.py)
echo ""
echo ">> [2/3] Executing Django seed_demo management command..."
(cd "$REPO_ROOT/backend" && run_python manage.py seed_demo)
echo "Core workspace, users, and tasks seeded successfully."

# 4. Optional Langfuse Seed
echo ""
echo ">> [3/3] Checking Langfuse telemetry configuration..."
LANGFUSE_SCRIPT="$REPO_ROOT/scripts/seed_langfuse.js"
if [ -n "${LANGFUSE_PUBLIC_KEY:-}" ] && [ -n "${LANGFUSE_SECRET_KEY:-}" ] && [ -f "$LANGFUSE_SCRIPT" ]; then
    echo "Seeding Langfuse tracing credentials..."
    node "$LANGFUSE_SCRIPT"
    echo "Langfuse seed completed."
else
    echo "Langfuse environment variables not set; skipping Langfuse seed."
fi

echo ""
echo "=================================================="
echo " DATABASE SEEDING COMPLETED SUCCESSFULLY!"
echo "=================================================="
