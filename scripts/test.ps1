# TeamFlow One-Command Test Script (Windows PowerShell)
# Runs unit and integration test suites across frontend, backend-nest, backend Django, and CLI.

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " TeamFlow One-Command Test Runner" -ForegroundColor Cyan
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

# 1. Frontend Unit Tests (Vitest)
Write-Host "`n>> [1/4] Running Frontend Vitest Suite..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "frontend")
try {
    npm test
    if ($LASTEXITCODE -ne 0) { throw "Frontend tests failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "Frontend tests passed." -ForegroundColor Green

# 2. Backend-Nest Unit Tests (Vitest)
Write-Host "`n>> [2/4] Running Backend-Nest Vitest Suite..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "backend-nest")
try {
    npm test
    if ($LASTEXITCODE -ne 0) { throw "Backend-nest tests failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "Backend-nest tests passed." -ForegroundColor Green

# 3. Backend Django Unit Tests
Write-Host "`n>> [3/4] Running Backend Django Hermetic Test Suite..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "backend")
try {
    if (-not $env:SECRET_KEY) {
        $env:SECRET_KEY = "test-secret-key-32-chars-minimum-length"
    }
    Invoke-Py "manage.py" "test" "accounts.tests" "--noinput"
} finally {
    Pop-Location
}
Write-Host "Backend Django tests passed." -ForegroundColor Green

# 4. CLI Unit Tests
Write-Host "`n>> [4/4] Running CLI Unit Tests..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "cli")
try {
    Invoke-Py "-m" "unittest" "discover" "-s" "tests" "-t" "."
} finally {
    Pop-Location
}
Write-Host "CLI tests passed." -ForegroundColor Green

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host " ALL TEST SUITES PASSED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
