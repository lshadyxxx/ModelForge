[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (!(Test-Path .env)) {
        function New-LocalSecret {
            $bytes = [byte[]]::new(32)
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
            return [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').TrimEnd('=')
        }
        $config = Get-Content .env.example -Raw
        $config = $config.Replace('MF_PG_PASSWORD=replace-with-random-local-secret', 'MF_PG_PASSWORD=' + (New-LocalSecret))
        $config = $config.Replace('MF_MINIO_SECRET_KEY=replace-with-random-local-secret', 'MF_MINIO_SECRET_KEY=' + (New-LocalSecret))
        [IO.File]::WriteAllText((Join-Path $root '.env'), $config)
        Write-Host 'Created ignored .env with random local credentials.'
    }
    New-Item -ItemType Directory -Force docker-db/postgres,docker-db/minio,.runtime | Out-Null
    docker compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Invalid Compose configuration' }
    docker compose up -d --build --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) { throw 'ModelForge startup failed. Check docker compose logs migrate api worker.' }
    Write-Host 'ModelForge started. Default workbench: http://127.0.0.1:8092 (port is configurable in .env).'
} finally { Pop-Location }
