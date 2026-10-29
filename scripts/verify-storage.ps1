[CmdletBinding()]
param([ValidateSet('lifecycle','prepare','verify','cleanup','reset-pending')][string]$Mode = 'lifecycle',
      [ValidatePattern('^[a-zA-Z0-9_-]{1,64}$')][string]$Probe = 'persistence')
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    New-Item -ItemType Directory -Force .runtime | Out-Null
    $runtime = (Resolve-Path .runtime).Path
    # Receipt lives on the host, outside containers being recreated. No formal file content is stored here.
    docker compose run --rm --no-deps -v "${runtime}:/receipts" api python -m modelforge.verification $Mode --receipt "/receipts/$Probe.json"
    if ($LASTEXITCODE -ne 0) { throw 'Storage verification failed; retain receipt and retry cleanup after restoring services.' }
} finally { Pop-Location }
