[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    docker compose down --timeout 20
    if ($LASTEXITCODE -ne 0) { throw 'ModelForge stop failed' }
    Write-Host 'Stopped ModelForge. docker-db data is retained.'
} finally { Pop-Location }
