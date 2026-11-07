#!/usr/bin/env bash
# TeamFlow One-Command Setup Script (POSIX / Bash)
# Standardized environment setup across frontend, backend-nest, backend (Django), and CLI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=================================================="
echo " TeamFlow One-Command Setup"
echo " Target: $REPO_ROOT"
echo "=================================================="

# 1. Setup Backend Python Environment
echo ""
echo ">> [1/4] Setting up Python backend virtual environment & dependencies..."
BACKEND_VENV="$REPO_ROOT/backend/.venv"
VENV_PYTHON=""

if [ -x "$BACKEND_VENV/bin/python" ]; then
    VENV_PYTHON="$BACKEND_VENV/bin/python"
elif [ -x "$BACKEND_VENV/Scripts/python.exe" ]; then
    VENV_PYTHON="$BACKEND_VENV/Scripts/python.exe"
else
    echo "Creating Python virtual environment in backend/.venv..."
    if command -v uv >/dev/null 2>&1; then
        uv venv "$BACKEND_VENV"
    elif command -v python3 >/dev/null 2>&1; then
        python3 -m venv "$BACKEND_VENV"
    elif command -v python >/dev/null 2>&1; then
        python -m venv "$BACKEND_VENV"
    else
        echo "Error: Python interpreter not found on system PATH." >&2
        exit 1
    fi

    if [ -x "$BACKEND_VENV/bin/python" ]; then
        VENV_PYTHON="$BACKEND_VENV/bin/python"
    elif [ -x "$BACKEND_VENV/Scripts/python.exe" ]; then
        VENV_PYTHON="$BACKEND_VENV/Scripts/python.exe"
    fi
fi

REQ_FILE="$REPO_ROOT/backend/requirements.txt"
CLI_DIR="$REPO_ROOT/cli"

if command -v uv >/dev/null 2>&1; then
    echo "Installing dependencies using uv..."
    uv pip install -r "$REQ_FILE" --python "$VENV_PYTHON"
    if [ -d "$CLI_DIR" ]; then
        uv pip install -e "$CLI_DIR" --python "$VENV_PYTHON"
    fi
else
    VENV_PIP=""
    if [ -x "$BACKEND_VENV/bin/pip" ]; then
        VENV_PIP="$BACKEND_VENV/bin/pip"
    elif [ -x "$BACKEND_VENV/Scripts/pip.exe" ]; then
        VENV_PIP="$BACKEND_VENV/Scripts/pip.exe"
    fi
    echo "Installing dependencies using pip..."
    "$VENV_PIP" install -r "$REQ_FILE"
    if [ -d "$CLI_DIR" ]; then
        "$VENV_PIP" install -e "$CLI_DIR"
    fi
fi
echo "Python environment setup complete."

# 2. Setup Backend-Nest
echo ""
echo ">> [2/4] Setting up backend-nest dependencies..."
(cd "$REPO_ROOT/backend-nest" && npm ci --legacy-peer-deps)
echo "Backend-nest dependencies installed."

# 3. Generate Prisma Client
echo ""
echo ">> [3/4] Generating Prisma client types in backend-nest..."
export DATABASE_URL="${DATABASE_URL:-postgresql://test:test@localhost:5432/test}"
(cd "$REPO_ROOT/backend-nest" && npx prisma generate)
echo "Prisma client generated."

# 4. Setup Frontend
echo ""
echo ">> [4/4] Setting up frontend dependencies..."
(cd "$REPO_ROOT/frontend" && npm ci --legacy-peer-deps)
echo "Frontend dependencies installed."

# Factory pre-commit hook (staged files only; CI runs every gate)
echo ""
echo ">> Installing the git pre-commit hook..."
git -C "$REPO_ROOT" config core.hooksPath .githooks
echo "Pre-commit hook active (.githooks/pre-commit)."

echo ""
echo "=================================================="
echo " TEAMFLOW SETUP COMPLETED SUCCESSFULLY!"
echo "=================================================="
