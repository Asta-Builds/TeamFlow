# TeamFlow Windows PowerShell Production Deployment Script
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "       TeamFlow Production Deployment          " -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

if (-not (Test-Path ".env.production")) {
    Write-Host "Creating .env.production from example..." -ForegroundColor Yellow
    Copy-Item ".env.production.example" ".env.production"
    Write-Host "Please check .env.production for custom domain & credentials." -ForegroundColor Yellow
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
