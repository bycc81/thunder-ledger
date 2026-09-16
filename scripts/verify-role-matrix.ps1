$ErrorActionPreference = 'Stop'

$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $workspace 'apps\backend'
$container = "thunderledger-role-test-$PID"
$database = 'thunderledger_role_test'
$user = 'thunderledger_test'
$password = 'local-role-regression-only'
$containerId = $null
$previous = @{}
$variables = @('DATABASE_URL', 'SESSION_SECRET', 'SESSION_COOKIE_SECURE', 'CORS_ORIGINS', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH')

foreach ($name in $variables) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
  $containerId = docker run --rm -d --name $container `
    -e "POSTGRES_DB=$database" `
    -e "POSTGRES_USER=$user" `
    -e "POSTGRES_PASSWORD=$password" `
    -p '127.0.0.1::5432' `
    postgres:16-alpine
  if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw 'Unable to start role regression database container' }

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    docker exec $container pg_isready -U $user -d $database *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Role regression database did not become ready in time' }

  $published = docker port $container 5432/tcp
  if ($LASTEXITCODE -ne 0 -or -not $published) { throw 'Unable to resolve role regression database port' }
  $port = ($published.Trim() -split ':')[-1]
  if ($port -notmatch '^\d+$') { throw "Invalid role regression database port: $published" }

  $env:DATABASE_URL = "postgres://${user}:${password}@127.0.0.1:${port}/${database}"
  $env:SESSION_SECRET = 'role-regression-session-secret'
  $env:SESSION_COOKIE_SECURE = 'false'
  $env:CORS_ORIGINS = 'http://role-test.local'
  $env:ADMIN_USERNAME = 'role-regression-system-admin'
  $env:ADMIN_PASSWORD_HASH = ''

  Push-Location $backend
  try {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed' }
    node dist/db/migrate.js
    if ($LASTEXITCODE -ne 0) { throw 'Role regression database migration failed' }
    node dist/role-regression.js
    if ($LASTEXITCODE -ne 0) { throw 'Role matrix regression failed' }
  } finally {
    Pop-Location
  }
} finally {
  if ($containerId) {
    docker stop $container *> $null
  }
  foreach ($name in $variables) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
  }
}
