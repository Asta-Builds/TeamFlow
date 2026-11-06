# TeamFlow One-Command Setup Script (Windows PowerShell)
# Standardized environment setup across frontend, backend-nest, backend (Django), and CLI.

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " TeamFlow One-Command Setup" -ForegroundColor Cyan
Write-Host " Target: $RepoRoot" -ForegroundColor DarkGray
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Setup Backend Python Environment
Write-Host "`n>> [1/4] Setting up Python backend virtual environment & dependencies..." -ForegroundColor Yellow
$backendVenv = Join-Path $RepoRoot "backend\.venv"
$venvPython = Join-Path $backendVenv "Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "Creating Python virtual environment in backend/.venv..." -ForegroundColor DarkGray
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        & uv venv $backendVenv
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m venv $backendVenv
    } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
        & python3 -m venv $backendVenv
    } else {
        throw "Python interpreter not found on system PATH to create virtual environment."
    }
}

$reqFile = Join-Path $RepoRoot "backend\requirements.txt"
$cliDir = Join-Path $RepoRoot "cli"

if (Get-Command uv -ErrorAction SilentlyContinue) {
    Write-Host "Installing dependencies using uv..." -ForegroundColor DarkGray
    & uv pip install -r $reqFile --python $venvPython
    if (Test-Path $cliDir) {
        & uv pip install -e $cliDir --python $venvPython
    }
} else {
    $venvPip = Join-Path $backendVenv "Scripts\pip.exe"
    Write-Host "Installing dependencies using pip..." -ForegroundColor DarkGray
    & $venvPip install -r $reqFile
    if (Test-Path $cliDir) {
        & $venvPip install -e $cliDir
    }
}
Write-Host "Python environment setup complete." -ForegroundColor Green

# 2. Setup Backend-Nest
Write-Host "`n>> [2/4] Setting up backend-nest dependencies..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "backend-nest")
try {
    npm ci --legacy-peer-deps
} finally {
    Pop-Location
}
Write-Host "Backend-nest dependencies installed." -ForegroundColor Green

# 3. Generate Prisma Client
Write-Host "`n>> [3/4] Generating Prisma client types in backend-nest..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "backend-nest")
try {
    if (-not $env:DATABASE_URL) {
        $env:DATABASE_URL = "postgresql://test:test@localhost:5432/test"
    }
    npx prisma generate
} finally {
    Pop-Location
}
Write-Host "Prisma client generated." -ForegroundColor Green

# 4. Setup Frontend
Write-Host "`n>> [4/4] Setting up frontend dependencies..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "frontend")
try {
    npm ci --legacy-peer-deps
} finally {
    Pop-Location
}
Write-Host "Frontend dependencies installed." -ForegroundColor Green

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host " TEAMFLOW SETUP COMPLETED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
