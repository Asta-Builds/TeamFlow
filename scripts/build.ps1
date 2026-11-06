# TeamFlow One-Command Build Script (Windows PowerShell)
# Builds backend-nest and frontend production artifacts.

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " TeamFlow One-Command Build" -ForegroundColor Cyan
Write-Host " Target: $RepoRoot" -ForegroundColor DarkGray
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Build Backend-Nest
Write-Host "`n>> [1/2] Building backend-nest API Gateway..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "backend-nest")
try {
    if (-not (Test-Path "node_modules\@prisma\client\index.d.ts")) {
        Write-Host "Prisma client missing, generating before build..." -ForegroundColor DarkGray
        if (-not $env:DATABASE_URL) {
            $env:DATABASE_URL = "postgresql://test:test@localhost:5432/test"
        }
        npx prisma generate
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Backend-nest build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "Backend-nest build succeeded." -ForegroundColor Green

# 2. Build Frontend
Write-Host "`n>> [2/2] Building frontend Next.js application..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "frontend")
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "Frontend build succeeded." -ForegroundColor Green

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host " ALL BUILDS COMPLETED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
