$ErrorActionPreference = 'Stop'

$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tempRoot = Join-Path $workspace '.tmp\recovery-rehearsal'
$runId = "$PID-$([guid]::NewGuid().ToString('N'))"
$dumpPath = Join-Path $tempRoot "database-$runId.dump"
$dumpErrorPath = Join-Path $tempRoot "database-$runId.stderr.log"
$restoreContainer = "thunderledger-restore-test-$PID"
$restoreDatabase = 'thunderledger_restore_test'
$restoreUser = 'thunderledger_restore'
$restorePassword = 'local-restore-rehearsal-only'
$restoreContainerId = $null
$docker = (Get-Command docker.exe -ErrorAction Stop).Source

function Invoke-DockerText {
  param([string[]]$Arguments)

  $output = & $docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker command failed: docker $($Arguments -join ' ')"
  }
  return (($output | ForEach-Object { "$_" }) -join "`n").Trim()
}

function Get-ContainerEnvironment {
  param([string]$Container)

  $inspect = Invoke-DockerText -Arguments @('inspect', $Container) | ConvertFrom-Json
  $values = @{}
  foreach ($entry in $inspect[0].Config.Env) {
    $pair = $entry -split '=', 2
    $values[$pair[0]] = $pair[1]
  }
  return $values
}

function Invoke-DatabaseQuery {
  param(
    [string]$Container,
    [string]$User,
    [string]$Database,
    [string]$Sql
  )

  return Invoke-DockerText -Arguments @(
    'exec',
    $Container,
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    $User,
    '-d',
    $Database,
    '-At',
    '-c',
    $Sql
  )
}

function Remove-TempFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  $resolvedRoot = [IO.Path]::GetFullPath($tempRoot).TrimEnd('\') + '\'
  $resolvedPath = [IO.Path]::GetFullPath($Path)
  if (-not $resolvedPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove file outside recovery rehearsal directory: $resolvedPath"
  }
  Remove-Item -LiteralPath $resolvedPath -Force
}

$migrationSql = @"
SELECT COUNT(*)::text || ':' ||
       md5(COALESCE(string_agg(version || ':' || COALESCE(checksum, ''), '|' ORDER BY version), ''))
FROM schema_migrations;
"@

$countSql = @"
SELECT table_name || '=' || row_count
FROM (
  SELECT 'users' AS table_name, COUNT(*)::bigint AS row_count FROM users
  UNION ALL SELECT 'workspaces', COUNT(*)::bigint FROM workspaces
  UNION ALL SELECT 'collaboration_batches', COUNT(*)::bigint FROM collaboration_batches
  UNION ALL SELECT 'products', COUNT(*)::bigint FROM products
  UNION ALL SELECT 'inventory_purchases', COUNT(*)::bigint FROM inventory_purchases
  UNION ALL SELECT 'sales', COUNT(*)::bigint FROM sales
  UNION ALL SELECT 'expenses', COUNT(*)::bigint FROM expenses
  UNION ALL SELECT 'settlement_bills', COUNT(*)::bigint FROM settlement_bills
) AS counts
ORDER BY table_name;
"@

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

  $sourceContainer = Invoke-DockerText -Arguments @('compose', 'ps', '-q', 'db')
  if (-not $sourceContainer -or $sourceContainer.Contains("`n")) {
    throw 'Expected exactly one running Compose db container'
  }

  $sourceEnvironment = Get-ContainerEnvironment -Container $sourceContainer
  $sourceDatabase = $sourceEnvironment['POSTGRES_DB']
  $sourceUser = $sourceEnvironment['POSTGRES_USER']
  if (-not $sourceDatabase -or -not $sourceUser) {
    throw 'Compose db container does not expose POSTGRES_DB and POSTGRES_USER'
  }

  $sourceMigrations = Invoke-DatabaseQuery -Container $sourceContainer -User $sourceUser -Database $sourceDatabase -Sql $migrationSql
  $sourceCounts = Invoke-DatabaseQuery -Container $sourceContainer -User $sourceUser -Database $sourceDatabase -Sql $countSql

  $dumpWatch = [Diagnostics.Stopwatch]::StartNew()
  $dumpProcess = Start-Process -FilePath $docker `
    -ArgumentList @('exec', $sourceContainer, 'pg_dump', '-U', $sourceUser, '-d', $sourceDatabase, '--format=custom') `
    -NoNewWindow `
    -RedirectStandardOutput $dumpPath `
    -RedirectStandardError $dumpErrorPath `
    -Wait `
    -PassThru
  $dumpWatch.Stop()
  if ($dumpProcess.ExitCode -ne 0) {
    throw "pg_dump failed with exit code $($dumpProcess.ExitCode)"
  }
  if (-not (Test-Path -LiteralPath $dumpPath) -or (Get-Item -LiteralPath $dumpPath).Length -eq 0) {
    throw 'pg_dump produced an empty backup'
  }

  $restoreContainerId = Invoke-DockerText -Arguments @(
    'run',
    '--rm',
    '-d',
    '--name',
    $restoreContainer,
    '-e',
    "POSTGRES_DB=$restoreDatabase",
    '-e',
    "POSTGRES_USER=$restoreUser",
    '-e',
    "POSTGRES_PASSWORD=$restorePassword",
    'postgres:16-alpine'
  )

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    & $docker exec $restoreContainer pg_isready -U $restoreUser -d $restoreDatabase *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'Restore database did not become ready in time'
  }

  Invoke-DockerText -Arguments @('cp', $dumpPath, "${restoreContainer}:/tmp/database.dump") | Out-Null

  $restoreWatch = [Diagnostics.Stopwatch]::StartNew()
  Invoke-DockerText -Arguments @(
    'exec',
    $restoreContainer,
    'pg_restore',
    '-U',
    $restoreUser,
    '-d',
    $restoreDatabase,
    '--no-owner',
    '--no-privileges',
    '/tmp/database.dump'
  ) | Out-Null
  $restoreWatch.Stop()

  $restoredMigrations = Invoke-DatabaseQuery -Container $restoreContainer -User $restoreUser -Database $restoreDatabase -Sql $migrationSql
  $restoredCounts = Invoke-DatabaseQuery -Container $restoreContainer -User $restoreUser -Database $restoreDatabase -Sql $countSql

  if ($restoredMigrations -ne $sourceMigrations) {
    throw "Migration signature mismatch: source=$sourceMigrations restored=$restoredMigrations"
  }
  if ($restoredCounts -ne $sourceCounts) {
    throw "Core table count mismatch`nSource:`n$sourceCounts`nRestored:`n$restoredCounts"
  }

  $dumpSize = (Get-Item -LiteralPath $dumpPath).Length
  Write-Output "backup restore verified"
  Write-Output "dump_bytes=$dumpSize"
  Write-Output "dump_seconds=$([Math]::Round($dumpWatch.Elapsed.TotalSeconds, 3))"
  Write-Output "restore_seconds=$([Math]::Round($restoreWatch.Elapsed.TotalSeconds, 3))"
  Write-Output "migration_signature=$sourceMigrations"
  Write-Output $sourceCounts
} finally {
  if ($restoreContainerId) {
    & $docker stop $restoreContainer *> $null
  }
  Remove-TempFile -Path $dumpPath
  Remove-TempFile -Path $dumpErrorPath
}
