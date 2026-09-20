# TeamFlow Railway deployment script.
# Orchestrates Infrastructure-as-Code deployment via Railway CLI.

[CmdletBinding()]
param(
    [Alias("y")]
    [switch]$Yes,

    [Alias("h")]
    [switch]$Help
)

$ErrorActionPreference = "Stop"

function Show-Help {
    Write-Host @"
Usage: .\scripts\deploy.ps1 [OPTIONS]

Deploys TeamFlow configuration to Railway using Infrastructure as Code (.railway/railway.ts).

Options:
  -Yes, -y       Skip interactive confirmation and apply changes automatically
  -Help, -h      Show this help message and exit
"@
}

if ($Help) {
    Show-Help
    exit 0
}

Write-Host "Checking prerequisites..."

$railwayCmd = Get-Command railway -ErrorAction SilentlyContinue
if (-not $railwayCmd) {
    Write-Error "Railway CLI ('railway') is not installed or not in PATH.`nInstall it via npm ('npm install -g @railway/cli') or see https://docs.railway.com/guides/cli"
    exit 1
}

$whoamiOutput = & railway whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Not authenticated with Railway.`nRun 'railway login' to authenticate before deploying."
    exit 1
}

$statusOutput = & railway status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Directory is not linked to a Railway project.`nRun 'railway link' to link this directory to the target project."
    exit 1
}

Write-Host "Prerequisites verified. Planning Railway configuration changes..."
Write-Host ""

& railway config plan
if ($LASTEXITCODE -ne 0) {
    Write-Error "railway config plan failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Host ""
if (-not $Yes) {
    $confirmation = Read-Host "Apply this configuration to Railway? [y/N]"
    if ($confirmation -notmatch "^[yY]([eE][sS])?$") {
        Write-Host "Deployment aborted by user."
        exit 1
    }
}

Write-Host "Applying configuration to Railway..."
& railway config apply --yes
if ($LASTEXITCODE -ne 0) {
    Write-Error "railway config apply failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Configuration successfully applied."
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Railway automatically triggers deployments from GitHub 'main' for linked services:"
Write-Host "   - teamflow-nginx (public edge ingress)"
Write-Host "   - teamflow-frontend (Next.js web app)"
Write-Host "   - teamflow-backend-nest (NestJS application API)"
Write-Host "   - teamflow-backend (Django web & execution engine)"
Write-Host "   - teamflow-celery (background worker)"
Write-Host ""
Write-Host "2. Monitor deployment progress and service health using:"
Write-Host "   railway status"
Write-Host "   railway logs --service teamflow-nginx"
Write-Host "   railway logs --service teamflow-frontend"
Write-Host "   railway logs --service teamflow-backend-nest"
Write-Host "   railway logs --service teamflow-backend"
Write-Host "   railway logs --service teamflow-celery"
