# TeamFlow Unified Local Verification Runner
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " TeamFlow Full Stack Quality Gate & Test Runner" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

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

# 1. Django Backend Check
Step "Django Backend System Check" {
    & f:\TeamFlow\.venv\Scripts\python.exe backend/manage.py check
}

# 2. NestJS Vitest Suites
Step "NestJS Vitest Unit Tests (74 Tests)" {
    Push-Location backend-nest
    try {
        npm test
    } finally {
        Pop-Location
    }
}

# 3. NestJS Linter
Step "NestJS Code Quality Lint" {
    Push-Location backend-nest
    try {
        npm run lint
    } finally {
        Pop-Location
    }
}

# 4. Frontend Vitest Suites
Step "Frontend Vitest Unit Tests (26 Tests)" {
    Push-Location frontend
    try {
        npm test
    } finally {
        Pop-Location
    }
}

# 5. Frontend Linter
Step "Frontend ESLint Verification" {
    Push-Location frontend
    try {
        npm run lint
    } finally {
        Pop-Location
    }
}

# 6. Live Container 19-Stage E2E Suite (if Docker is up)
$dockerUp = (docker ps -q -f name=teamflow-backend-nest)
if ($dockerUp) {
    Step "Live Container 19-Stage E2E Integration Suite" {
        & f:\TeamFlow\.venv\Scripts\python.exe scripts/test_e2e_nest.py
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
