#!/bin/bash
set -euo pipefail

# TeamFlow Railway deployment script.
# Orchestrates Infrastructure-as-Code deployment via Railway CLI.

AUTO_CONFIRM=false

show_help() {
    cat << 'EOF'
Usage: ./scripts/deploy.sh [OPTIONS]

Deploys TeamFlow configuration to Railway using Infrastructure as Code (.railway/railway.ts).

Options:
  -y, --yes      Skip interactive confirmation and apply changes automatically
  -h, --help     Show this help message and exit
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        -y|--yes)
            AUTO_CONFIRM=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Error: Unknown argument: $1" >&2
            show_help >&2
            exit 1
            ;;
    esac
done

echo "Checking prerequisites..."

if ! command -v railway >/dev/null 2>&1; then
    echo "Error: Railway CLI ('railway') is not installed or not in PATH." >&2
    echo "Install it via npm ('npm install -g @railway/cli') or see https://docs.railway.com/guides/cli" >&2
    exit 1
fi

if ! railway whoami >/dev/null 2>&1; then
    echo "Error: Not authenticated with Railway." >&2
    echo "Run 'railway login' to authenticate before deploying." >&2
    exit 1
fi

if ! railway status >/dev/null 2>&1; then
    echo "Error: Directory is not linked to a Railway project." >&2
    echo "Run 'railway link' to link this directory to the target project." >&2
    exit 1
fi

echo "Prerequisites verified. Planning Railway configuration changes..."
echo ""

railway config plan

echo ""
if [ "$AUTO_CONFIRM" != "true" ]; then
    read -r -p "Apply this configuration to Railway? [y/N]: " response
    case "$response" in
        [yY][eE][sS]|[yY])
            ;;
        *)
            echo "Deployment aborted by user." >&2
            exit 1
            ;;
    esac
fi

echo "Applying configuration to Railway..."
railway config apply --yes

echo ""
echo "Configuration successfully applied."
echo ""
echo "Next steps:"
echo "1. Railway automatically triggers deployments from GitHub 'main' for linked services:"
echo "   - teamflow-nginx (public edge ingress)"
echo "   - teamflow-frontend (Next.js web app)"
echo "   - teamflow-backend-nest (NestJS application API)"
echo "   - teamflow-backend (Django web & execution engine)"
echo "   - teamflow-celery (background worker)"
echo ""
echo "2. Monitor deployment progress and service health using:"
echo "   railway status"
echo "   railway logs --service teamflow-nginx"
echo "   railway logs --service teamflow-frontend"
echo "   railway logs --service teamflow-backend-nest"
echo "   railway logs --service teamflow-backend"
echo "   railway logs --service teamflow-celery"
