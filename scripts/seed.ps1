# TeamFlow One-Command Database Seed Script (Windows PowerShell)
# Seeds the database with default organization, CEO user, agent seats, projects, and sample tickets.

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " TeamFlow One-Command Database Seed" -ForegroundColor Cyan
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
    param([Parameter(ValueFromRemainingArguments = $true)]$ArgsList)
    if ($pyPath -eq "uv") {
        & uv run python @ArgsList
    } else {
        & $pyPath @ArgsList
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Python step failed with exit code $LASTEXITCODE"
    }
}

# 1. Environment Defaults
if (-not $env:SECRET_KEY) {
    $env:SECRET_KEY = "test-secret-key-32-chars-minimum-length"
}

# 2. Apply Database Migrations
Write-Host "`n>> [1/3] Ensuring database migrations are applied..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "backend")
try {
    Invoke-Py "manage.py" "migrate" "--noinput"
} finally {
    Pop-Location
}
Write-Host "Database migrations verified/applied." -ForegroundColor Green

# 3. Seed Demo Data (seed_demo.py)
Write-Host "`n>> [2/3] Executing Django seed_demo management command..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "backend")
try {
    Invoke-Py "manage.py" "seed_demo"
} finally {
    Pop-Location
}
Write-Host "Core workspace, users, and tasks seeded successfully." -ForegroundColor Green

# 4. Optional Langfuse Seed
Write-Host "`n>> [3/3] Checking Langfuse telemetry configuration..." -ForegroundColor Yellow
$langfuseScript = Join-Path $RepoRoot "scripts\seed_langfuse.js"
if ($env:LANGFUSE_PUBLIC_KEY -and $env:LANGFUSE_SECRET_KEY -and (Test-Path $langfuseScript)) {
    Write-Host "Seeding Langfuse tracing credentials..." -ForegroundColor DarkGray
    node $langfuseScript
    Write-Host "Langfuse seed completed." -ForegroundColor Green
} else {
    Write-Host "Langfuse environment variables not set; skipping Langfuse seed." -ForegroundColor DarkGray
}

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host " DATABASE SEEDING COMPLETED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
