[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI was not found in PATH.'
}

Push-Location $repoRoot
try {
  if (Test-Path -LiteralPath $envFile) {
    docker compose --env-file $envFile down
  } else {
    docker compose down
  }
} finally {
  Pop-Location
}
