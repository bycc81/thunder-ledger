[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing .env. Run: Copy-Item .env.example .env"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI was not found in PATH.'
}

Push-Location $repoRoot
try {
  docker compose --env-file $envFile config --quiet
  docker compose --env-file $envFile up --build -d
  docker compose --env-file $envFile ps
} finally {
  Pop-Location
}
