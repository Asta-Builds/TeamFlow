#!/usr/bin/env bash
# TeamFlow One-Command Lint Script (POSIX / Bash)
# Standardized static checks & linting across frontend, backend-nest, backend (Django), and monorepo gates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=================================================="
echo " TeamFlow One-Command Lint & Static Quality Gates"
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

# 1. Frontend ESLint
echo ""
echo ">> [1/8] Running Frontend ESLint..."
(cd "$REPO_ROOT/frontend" && npm run lint)
echo "Frontend ESLint passed with 0 errors/warnings."

# 2. Backend-Nest ESLint
echo ""
echo ">> [2/8] Running Backend-Nest ESLint..."
(cd "$REPO_ROOT/backend-nest" && npm run lint)
echo "Backend-nest ESLint passed with 0 errors/warnings."

# 3. Monorepo JSCPD Code Duplication Gate
echo ""
echo ">> [3/8] Running Monorepo JSCPD Duplication Gate..."
npx jscpd .
echo "JSCPD duplication check passed within threshold."

# 4. Frontend Knip Dead Code Detection
echo ""
echo ">> [4/8] Running Frontend Knip Dead Code Check..."
(cd "$REPO_ROOT/frontend" && npx knip)
echo "Frontend Knip passed with zero unused exports."

# 5. Backend-Nest Knip Dead Code Detection
echo ""
echo ">> [5/8] Running Backend-Nest Knip Dead Code Check..."
(cd "$REPO_ROOT/backend-nest" && npx knip)
echo "Backend-nest Knip passed with zero unused exports."

# 6. Prisma Schema Validation
echo ""
echo ">> [6/8] Validating Prisma schema in backend-nest..."
export DATABASE_URL="${DATABASE_URL:-postgresql://test:test@localhost:5432/test}"
(cd "$REPO_ROOT/backend-nest" && npx prisma validate)
echo "Prisma schema is valid."

# 7. Django System Check
echo ""
echo ">> [7/8] Running Django System Check..."
export SECRET_KEY="${SECRET_KEY:-test-secret-key-for-local-check-32chars}"
run_python "$REPO_ROOT/backend/manage.py" check
echo "Django system check identified 0 issues."

# 8. Django Migration Drift
echo ""
echo ">> [8/8] Checking Django migration drift..."
run_python "$REPO_ROOT/backend/manage.py" makemigrations --check --dry-run
echo "No unapplied model changes."

echo ""
echo "=================================================="
echo " ALL LINT AND GATE CHECKS PASSED CLEANLY!"
echo "=================================================="
