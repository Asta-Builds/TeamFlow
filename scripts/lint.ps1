# TeamFlow One-Command Lint Script (Windows PowerShell)
# Standardized static checks & linting across frontend, backend-nest, backend (Django), and monorepo gates.

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " TeamFlow One-Command Lint & Static Quality Gates" -ForegroundColor Cyan
Write-Host " Target: $RepoRoot" -ForegroundColor DarkGray
Write-Host "==================================================" -ForegroundColor Cyan

function Get-PythonPath {
    if (Test-Path (Join-Path $RepoRoot "backend\.venv\Scripts\python.exe")) {
        return (Join-Path $RepoRoot "backend\.venv\Scripts\python.exe")
    }
    if (Test-Path (Join-Path $RepoRoot ".venv\Scripts\python.exe")) {
        return (Join-Path $RepoRoot ".venv\Scripts\python.exe")
    }
    if ($env:VIRTUAL_ENV -and (Test-Path (Join-Path $env:VIRTUAL_ENV "Scripts\python.exe"))) {
        return (Join-Path $env:VIRTUAL_ENV "Scripts\python.exe")
    }
    if (Get-Command uv -ErrorAction SilentlyContinue) { return "uv" }
    if (Get-Command python -ErrorAction SilentlyContinue) { return "python" }
    return "python3"
}

$pyPath = Get-PythonPath

function Invoke-Py {
    param([string]$ScriptPath, [string[]]$Arguments)
    if ($pyPath -eq "uv") {
        & uv run python $ScriptPath @Arguments
    } else {
        & $pyPath $ScriptPath @Arguments
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Python step failed with exit code $LASTEXITCODE"
    }
}

# 1. Frontend ESLint
Write-Host "`n>> [1/8] Running Frontend ESLint..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "frontend")
try {
    npm run lint
    if ($LASTEXITCODE -ne 0) { throw "Frontend ESLint failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "Frontend ESLint passed with 0 errors/warnings." -ForegroundColor Green

# 2. Backend-Nest ESLint
Write-Host "`n>> [2/8] Running Backend-Nest ESLint..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "backend-nest")
try {
    npm run lint
    if ($LASTEXITCODE -ne 0) { throw "Backend-nest ESLint failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "Backend-nest ESLint passed with 0 errors/warnings." -ForegroundColor Green

# 3. Monorepo JSCPD Code Duplication Gate
Write-Host "`n>> [3/8] Running Monorepo JSCPD Duplication Gate..." -ForegroundColor Yellow
npx jscpd .
if ($LASTEXITCODE -ne 0) { throw "JSCPD clone detection failed with exit code $LASTEXITCODE" }
Write-Host "JSCPD duplication check passed within threshold." -ForegroundColor Green

# 4. Frontend Knip Dead Code Detection
Write-Host "`n>> [4/8] Running Frontend Knip Dead Code Check..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "frontend")
try {
    npx knip
    if ($LASTEXITCODE -ne 0) { throw "Frontend Knip check failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "Frontend Knip passed with zero unused exports." -ForegroundColor Green

# 5. Backend-Nest Knip Dead Code Detection
Write-Host "`n>> [5/8] Running Backend-Nest Knip Dead Code Check..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "backend-nest")
try {
    npx knip
    if ($LASTEXITCODE -ne 0) { throw "Backend-nest Knip check failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "Backend-nest Knip passed with zero unused exports." -ForegroundColor Green

# 6. Prisma Schema Validation
Write-Host "`n>> [6/8] Validating Prisma schema in backend-nest..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "backend-nest")
try {
    if (-not $env:DATABASE_URL) {
        $env:DATABASE_URL = "postgresql://test:test@localhost:5432/test"
    }
    npx prisma validate
    if ($LASTEXITCODE -ne 0) { throw "Prisma validate failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "Prisma schema is valid." -ForegroundColor Green

# 7. Django System Check
Write-Host "`n>> [7/8] Running Django System Check..." -ForegroundColor Yellow
if (-not $env:SECRET_KEY) {
    $env:SECRET_KEY = "test-secret-key-for-local-check-32chars"
}
Invoke-Py (Join-Path $RepoRoot "backend\manage.py") @("check")
Write-Host "Django system check identified 0 issues." -ForegroundColor Green

# 8. Django Migration Drift
Write-Host "`n>> [8/8] Checking Django migration drift..." -ForegroundColor Yellow
Invoke-Py (Join-Path $RepoRoot "backend\manage.py") @("makemigrations", "--check", "--dry-run")
Write-Host "No unapplied model changes." -ForegroundColor Green

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host " ALL LINT AND GATE CHECKS PASSED CLEANLY!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
