# TeamFlow Railway database backup script.
# Dumps the production PostgreSQL database through the Railway CLI,
# compresses the output with gzip, verifies integrity, and manages retention.
#
# Volume snapshot note:
# Railway persistent volumes (such as 'generated_projects' attached to teamflow-celery)
# have no built-in snapshot mechanism in this configuration. Agent workspaces inside
# generated_projects/ are transient Git checkouts designed to be cloned and recreated
# from GitHub repositories rather than restored from backups.
# To inspect volumes, use:
#   railway volume list

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$BackupDir = "./backups",

    [Parameter(Position = 1)]
    [int]$Keep = 7,

    [Parameter(Position = 2)]
    [string]$ServiceName = "teamflow-db",

    [Alias("h")]
    [switch]$Help
)

$ErrorActionPreference = "Stop"

function Show-Help {
    Write-Host @"
Usage: .\scripts\railway_backup.ps1 [[-BackupDir] <path>] [[-Keep] <int>] [[-ServiceName] <name>]

Creates a timestamped, gzipped pg_dump from the production Railway database.

Parameters:
  -BackupDir <path>     Directory to store backups (default: ./backups)
  -Keep <int>           Number of latest backups to retain (default: 7)
  -ServiceName <name>   Railway database service name (default: teamflow-db)
  -Help, -h             Show this help message and exit
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
    Write-Error "Not authenticated with Railway.`nRun 'railway login' to authenticate before backing up."
    exit 1
}

$statusOutput = & railway status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Directory is not linked to a Railway project.`nRun 'railway link' to link this directory to the target project."
    exit 1
}

$pgDumpCmd = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDumpCmd) {
    Write-Error "pg_dump was not found in PATH.`nInstall PostgreSQL client tools (e.g. via 'winget install PostgreSQL.PostgreSQL' or brew/apt) to perform database dumps."
    exit 1
}

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$resolvedBackupDir = (Resolve-Path $BackupDir).Path
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$filename = "teamflow_db_${timestamp}.sql.gz"
$backupFilePath = Join-Path $resolvedBackupDir $filename
$tempSqlPath = Join-Path $resolvedBackupDir "temp_${timestamp}.sql"

Write-Host "Dumping database from Railway service '$ServiceName'..."

# Execute pg_dump via railway run without printing credentials
$dumpOutput = & railway run --service $ServiceName -- pg_dump --clean --if-exists --no-owner --no-privileges -f $tempSqlPath 2>&1
if ($LASTEXITCODE -ne 0) {
    if (Test-Path $tempSqlPath) { Remove-Item $tempSqlPath -Force }
    Write-Error "pg_dump execution failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

if (-not (Test-Path $tempSqlPath) -or (Get-Item $tempSqlPath).Length -le 0) {
    if (Test-Path $tempSqlPath) { Remove-Item $tempSqlPath -Force }
    Write-Error "pg_dump produced an empty file."
    exit 1
}

Write-Host "Compressing dump with gzip..."
$gzipCmd = Get-Command gzip -ErrorAction SilentlyContinue
if ($gzipCmd) {
    & gzip -f $tempSqlPath
    $gzippedFile = "$tempSqlPath.gz"
    if (Test-Path $gzippedFile) {
        Move-Item -Path $gzippedFile -Destination $backupFilePath -Force
    } else {
        if (Test-Path $tempSqlPath) { Remove-Item $tempSqlPath -Force }
        Write-Error "gzip compression failed."
        exit 1
    }
} else {
    try {
        $inputStream = [System.IO.File]::OpenRead($tempSqlPath)
        $outputStream = [System.IO.File]::Create($backupFilePath)
        $gzipStream = New-Object System.IO.Compression.GZipStream($outputStream, [System.IO.Compression.CompressionLevel]::Optimal)
        $inputStream.CopyTo($gzipStream)
        $gzipStream.Dispose()
        $outputStream.Dispose()
        $inputStream.Dispose()
        Remove-Item -Path $tempSqlPath -Force
    } catch {
        if (Test-Path $tempSqlPath) { Remove-Item $tempSqlPath -Force }
        if (Test-Path $backupFilePath) { Remove-Item $backupFilePath -Force }
        Write-Error "Compression failed: $_"
        exit 1
    }
}

$createdBackup = Get-Item $backupFilePath
if ($createdBackup.Length -le 0) {
    Remove-Item $backupFilePath -Force
    Write-Error "Compressed backup file is empty (0 bytes)."
    exit 1
}

$sizeStr = if ($createdBackup.Length -ge 1MB) {
    "{0:N2} MB" -f ($createdBackup.Length / 1MB)
} elseif ($createdBackup.Length -ge 1KB) {
    "{0:N2} KB" -f ($createdBackup.Length / 1KB)
} else {
    "$($createdBackup.Length) bytes"
}

Write-Host "Backup successful: $($createdBackup.FullName) ($sizeStr, $($createdBackup.Length) bytes)"

# Retention policy: keep the latest $Keep dumps matching teamflow_db_*.sql.gz
$existingBackups = Get-ChildItem -Path $resolvedBackupDir -Filter "teamflow_db_*.sql.gz" | Sort-Object Name -Descending
if ($existingBackups.Count -gt $Keep) {
    Write-Host "Applying retention policy: keeping latest $Keep dumps (found $($existingBackups.Count))..."
    $toRemove = $existingBackups | Select-Object -Skip $Keep
    foreach ($item in $toRemove) {
        Write-Host "Removing old backup: $($item.Name)"
        Remove-Item -Path $item.FullName -Force
    }
} else {
    Write-Host "Existing backups ($($existingBackups.Count)) within retention limit ($Keep)."
}
