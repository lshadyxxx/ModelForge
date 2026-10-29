[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    docker compose down --timeout 20
    if ($LASTEXITCODE -ne 0) { throw 'Stop failed' }
    docker compose up -d --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) { throw 'Restart failed' }
} finally { Pop-Location }
