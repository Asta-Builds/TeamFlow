# TeamFlow Unified Local Verification Runner
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " TeamFlow Full Stack Quality Gate & Test Runner" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

$globalPass = $true

function Step($name, [scriptblock]$action) {
    Write-Host "`n>> [$name]..." -ForegroundColor Yellow
    try {
        & $action
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
            Write-Host " [FAILED] Step '$name' exited with code $LASTEXITCODE" -ForegroundColor Red
            $script:globalPass = $false
        } else {
            Write-Host " [PASSED] $name" -ForegroundColor Green
        }
    } catch {
        Write-Host " [ERROR] $_" -ForegroundColor Red
        $script:globalPass = $false
    }
}

function Get-PythonCmd {
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

$pythonCmd = Get-PythonCmd

function Invoke-PythonScript {
    param([string]$ScriptPath, [string[]]$Arguments)
    if ($pythonCmd -eq "uv") {
        & uv run python $ScriptPath @Arguments
    } else {
        & $pythonCmd $ScriptPath @Arguments
    }
}

# 1. Django Backend Check
Step "Django Backend System Check" {
    $containerUp = $false
    try {
        $containerUp = [bool](docker ps -q -f name=teamflow-backend 2>$null)
    } catch {
        $containerUp = $false
    }

    if ($containerUp) {
        docker exec teamflow-backend python manage.py check
    } else {
        if (-not $env:SECRET_KEY) {
            $env:SECRET_KEY = "test-secret-key-for-local-check-32chars"
        }
        Invoke-PythonScript (Join-Path $RepoRoot "backend\manage.py") @("check")
    }
}

# 2. NestJS Vitest Suites
Step "NestJS Vitest Unit Tests (213 Tests)" {
    Push-Location (Join-Path $RepoRoot "backend-nest")
    try {
        npm test
    } finally {
        Pop-Location
    }
}

# 3. NestJS Linter
Step "NestJS Code Quality Lint" {
    Push-Location (Join-Path $RepoRoot "backend-nest")
    try {
        npm run lint
    } finally {
        Pop-Location
    }
}

# 4. Frontend Vitest Suites
Step "Frontend Vitest Unit Tests (71 Tests)" {
    Push-Location (Join-Path $RepoRoot "frontend")
    try {
        npm test
    } finally {
        Pop-Location
    }
}

# 5. Frontend Linter
Step "Frontend ESLint Verification" {
    Push-Location (Join-Path $RepoRoot "frontend")
    try {
        npm run lint
    } finally {
        Pop-Location
    }
}

# 6. Live Container 19-Stage E2E Suite (if Docker is up)
$dockerUp = $false
try {
    $dockerUp = [bool](docker ps -q -f name=teamflow-backend-nest 2>$null)
} catch {
    $dockerUp = $false
}
if ($dockerUp) {
    Step "Live Container 19-Stage E2E Integration Suite" {
        Invoke-PythonScript (Join-Path $RepoRoot "scripts\test_e2e_nest.py") @()
    }
} else {
    Write-Host "`n[SKIP] Docker containers not running. Skipping 19-stage E2E live test." -ForegroundColor DarkGray
}

Write-Host "`n==================================================" -ForegroundColor Cyan
if ($globalPass) {
    Write-Host " ALL QUALITY GATES PASSED! READY TO SHIP/COMMIT." -ForegroundColor Green
} else {
    Write-Host " ONE OR MORE QUALITY GATES FAILED." -ForegroundColor Red
    exit 1
}
Write-Host "==================================================" -ForegroundColor Cyan
