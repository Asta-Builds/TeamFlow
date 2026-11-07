#!/usr/bin/env bash
# TeamFlow One-Command Test Script (POSIX / Bash)
# Runs unit and integration test suites across frontend, backend-nest, backend Django, and CLI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=================================================="
echo " TeamFlow One-Command Test Runner"
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

# 1. Frontend Unit Tests (Vitest)
echo ""
echo ">> [1/4] Running Frontend Vitest Suite..."
(cd "$REPO_ROOT/frontend" && npm test)
echo "Frontend tests passed."

# 2. Backend-Nest Unit Tests (Vitest)
echo ""
echo ">> [2/4] Running Backend-Nest Vitest Suite..."
(cd "$REPO_ROOT/backend-nest" && npm test)
echo "Backend-nest tests passed."

# 3. Backend Django Unit Tests
echo ""
echo ">> [3/4] Running Backend Django Hermetic Test Suite..."
export SECRET_KEY="${SECRET_KEY:-test-secret-key-32-chars-minimum-length}"
(cd "$REPO_ROOT/backend" && run_python manage.py test accounts.tests --noinput)
echo "Backend Django tests passed."

# 4. CLI Unit Tests
echo ""
echo ">> [4/4] Running CLI Unit Tests..."
(cd "$REPO_ROOT/cli" && run_python -m unittest discover -s tests -t .)
echo "CLI tests passed."

echo ""
echo "=================================================="
echo " ALL TEST SUITES PASSED SUCCESSFULLY!"
echo "=================================================="
