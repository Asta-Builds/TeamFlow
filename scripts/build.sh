#!/usr/bin/env bash
# TeamFlow One-Command Build Script (POSIX / Bash)
# Builds backend-nest and frontend production artifacts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "=================================================="
echo " TeamFlow One-Command Build"
echo " Target: $REPO_ROOT"
echo "=================================================="

# 1. Build Backend-Nest
echo ""
echo ">> [1/2] Building backend-nest API Gateway..."
if [ ! -f "$REPO_ROOT/backend-nest/node_modules/@prisma/client/index.d.ts" ]; then
    echo "Prisma client missing, generating before build..."
    export DATABASE_URL="${DATABASE_URL:-postgresql://test:test@localhost:5432/test}"
    (cd "$REPO_ROOT/backend-nest" && npx prisma generate)
fi
(cd "$REPO_ROOT/backend-nest" && npm run build)
echo "Backend-nest build succeeded."

# 2. Build Frontend
echo ""
echo ">> [2/2] Building frontend Next.js application..."
(cd "$REPO_ROOT/frontend" && npm run build)
echo "Frontend build succeeded."

echo ""
echo "=================================================="
echo " ALL BUILDS COMPLETED SUCCESSFULLY!"
echo "=================================================="
