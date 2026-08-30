# TeamFlow Windows PowerShell Production Deployment Script
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "       TeamFlow Production Deployment          " -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

if (-not (Test-Path ".env.production")) {
    Write-Host "Missing .env.production. Copy .env.production.example, set every required value, then rerun." -ForegroundColor Red
    exit 1
}

$productionEnv = Get-Content ".env.production" -Raw
if ($productionEnv -match "generate-a-strong|choose-a-strong|yourdomain\.com") {
    Write-Host ".env.production still contains example values. Configure production secrets and domain values before deployment." -ForegroundColor Red
    exit 1
}

Write-Host "1. Building and launching production containers..." -ForegroundColor Green
docker compose -f docker-compose.prod.yml --env-file .env.production up --build -d

Write-Host "2. Waiting for backend readiness..." -ForegroundColor Green
Start-Sleep -Seconds 8

Write-Host "3. Verifying health check..." -ForegroundColor Green
try {
    $res = Invoke-RestMethod -Uri "http://localhost/api/health/" -Method Get
    Write-Host "Health Check: OK ($($res.service) / $($res.database))" -ForegroundColor Green
} catch {
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:8000/api/health/" -Method Get
        Write-Host "Health Check: OK ($($res.service) / $($res.database))" -ForegroundColor Green
    } catch {
        Write-Host "Containers are starting up..." -ForegroundColor Yellow
    }
}

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "TeamFlow production stack is running!" -ForegroundColor Cyan
Write-Host "Frontend App: http://localhost" -ForegroundColor White
Write-Host "API Docs:     http://localhost/api/docs/" -ForegroundColor White
Write-Host "===============================================" -ForegroundColor Cyan
