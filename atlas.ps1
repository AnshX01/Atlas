# ============================================================
# Atlas — PowerShell Command Script (Windows, ASCII-safe)
# Usage: .\atlas.ps1 <command>
# ============================================================

param([Parameter(Position=0)][string]$Command = "help")

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

function Show-Help {
    Write-Host ""
    Write-Host "  Atlas -- PowerShell Command Reference" -ForegroundColor Cyan
    Write-Host "  ---------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  .\atlas.ps1 up              Start all services (docker-compose)" -ForegroundColor White
    Write-Host "  .\atlas.ps1 down            Stop and remove containers" -ForegroundColor White
    Write-Host "  .\atlas.ps1 logs            Follow logs for all services" -ForegroundColor White
    Write-Host "  .\atlas.ps1 migrate         Run Alembic migrations" -ForegroundColor White
    Write-Host "  .\atlas.ps1 init-secrets    Generate random secrets into .env" -ForegroundColor White
    Write-Host "  .\atlas.ps1 lint            Run Ruff + ESLint" -ForegroundColor White
    Write-Host "  .\atlas.ps1 test            Run backend + frontend tests" -ForegroundColor White
    Write-Host "  .\atlas.ps1 shell-backend   Open shell in backend container" -ForegroundColor White
    Write-Host "  .\atlas.ps1 shell-frontend  Open shell in frontend container" -ForegroundColor White
    Write-Host "  ---------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
}

function Invoke-InitSecrets {
    Write-Host "Generating .env from .env.example with random secrets..." -ForegroundColor Cyan

    $EnvExample = Join-Path $Root ".env.example"
    $EnvFile    = Join-Path $Root ".env"

    if (-not (Test-Path $EnvExample)) {
        Write-Error ".env.example not found at $EnvExample"
        return
    }

    if (-not (Test-Path $EnvFile)) {
        Copy-Item $EnvExample $EnvFile
        Write-Host "  Created .env from .env.example" -ForegroundColor Green
    } else {
        Write-Host "  .env already exists -- updating only placeholder secrets" -ForegroundColor Yellow
    }

    # Generate cryptographically random secrets using .NET RNG
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()

    # APP_SECRET_KEY: 32 random bytes -> base64url
    $bytes32 = New-Object byte[] 32
    $rng.GetBytes($bytes32)
    $AppSecretKey = [Convert]::ToBase64String($bytes32).Replace('+','-').Replace('/','_').TrimEnd('=')

    # APP_MASTER_ENCRYPTION_KEY: 32 bytes for AES-256
    $aesBytes = New-Object byte[] 32
    $rng.GetBytes($aesBytes)
    $AesKey = [Convert]::ToBase64String($aesBytes).Replace('+','-').Replace('/','_')

    # JWT_SECRET_KEY: 48 bytes
    $jwtBytes = New-Object byte[] 48
    $rng.GetBytes($jwtBytes)
    $JwtKey = [Convert]::ToBase64String($jwtBytes).Replace('+','-').Replace('/','_').TrimEnd('=')

    # POSTGRES_PASSWORD
    $pgBytes = New-Object byte[] 16
    $rng.GetBytes($pgBytes)
    $PgPassword = [Convert]::ToBase64String($pgBytes).Replace('+','-').Replace('/','_').TrimEnd('=')

    # NEO4J_PASSWORD
    $neoBytes = New-Object byte[] 16
    $rng.GetBytes($neoBytes)
    $NeoPassword = [Convert]::ToBase64String($neoBytes).Replace('+','-').Replace('/','_').TrimEnd('=')

    $rng.Dispose()

    # Read current .env content
    $content = Get-Content $EnvFile -Raw

    # Replace placeholder values
    $content = $content -replace 'CHANGE_ME_32_CHAR_RANDOM_STRING_HERE', $AppSecretKey
    $content = $content -replace 'CHANGE_ME_AES256_BASE64_KEY_HERE',     $AesKey
    $content = $content -replace 'CHANGE_ME_JWT_SECRET_KEY_HERE',         $JwtKey
    $content = $content -replace 'CHANGE_ME_POSTGRES_PASSWORD',            $PgPassword
    $content = $content -replace 'CHANGE_ME_NEO4J_PASSWORD',               $NeoPassword

    Set-Content $EnvFile $content -NoNewline -Encoding UTF8

    Write-Host "  [OK] APP_SECRET_KEY            generated" -ForegroundColor Green
    Write-Host "  [OK] APP_MASTER_ENCRYPTION_KEY generated" -ForegroundColor Green
    Write-Host "  [OK] JWT_SECRET_KEY             generated" -ForegroundColor Green
    Write-Host "  [OK] POSTGRES_PASSWORD          generated" -ForegroundColor Green
    Write-Host "  [OK] NEO4J_PASSWORD             generated" -ForegroundColor Green
    Write-Host ""
    Write-Host "  -> Next: open .env and fill in your real API keys:" -ForegroundColor Yellow
    Write-Host "      OPENAI_API_KEY       = sk-..." -ForegroundColor Yellow
    Write-Host "      GOOGLE_CLIENT_ID     = ...apps.googleusercontent.com" -ForegroundColor Yellow
    Write-Host "      GOOGLE_CLIENT_SECRET = ..." -ForegroundColor Yellow
    Write-Host "      GITHUB_CLIENT_ID     = ..." -ForegroundColor Yellow
    Write-Host "      GITHUB_CLIENT_SECRET = ..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Then run:  .\atlas.ps1 up" -ForegroundColor Cyan
}

switch ($Command) {
    "help"           { Show-Help }
    "init-secrets"   { Invoke-InitSecrets }
    "up"             {
        Write-Host "Starting Atlas services..." -ForegroundColor Cyan
        docker-compose up -d --build
        Write-Host ""
        Write-Host "Services starting. Check health with:" -ForegroundColor Green
        Write-Host "  docker-compose ps" -ForegroundColor White
        Write-Host ""
        Write-Host "Available at:" -ForegroundColor Green
        Write-Host "  API:      http://localhost:8000" -ForegroundColor White
        Write-Host "  API Docs: http://localhost:8000/docs" -ForegroundColor White
        Write-Host "  UI:       http://localhost:3000" -ForegroundColor White
        Write-Host "  Neo4j:    http://localhost:7474" -ForegroundColor White
        Write-Host "  Flower:   http://localhost:5555" -ForegroundColor White
    }
    "down"           {
        docker-compose down -v
        Write-Host "All services stopped." -ForegroundColor Yellow
    }
    "logs"           { docker-compose logs -f --tail=100 }
    "migrate"        { docker-compose exec backend alembic upgrade head }
    "migrate-create" {
        $msg = Read-Host "Migration message"
        docker-compose exec backend alembic revision --autogenerate -m $msg
    }
    "shell-backend"  { docker-compose exec backend bash }
    "shell-frontend" { docker-compose exec frontend sh }
    "lint"           {
        Write-Host "-- Ruff (Python) --" -ForegroundColor Cyan
        Push-Location (Join-Path $Root "backend")
        ruff check .
        ruff format --check .
        Pop-Location
        Write-Host "-- ESLint (TypeScript) --" -ForegroundColor Cyan
        Push-Location (Join-Path $Root "frontend")
        npm run lint
        Pop-Location
    }
    "test"           {
        Write-Host "-- Backend Unit Tests --" -ForegroundColor Cyan
        Push-Location (Join-Path $Root "backend")
        pytest tests/unit -v --tb=short
        Pop-Location
        Write-Host "-- Frontend Tests --" -ForegroundColor Cyan
        Push-Location (Join-Path $Root "frontend")
        npm test -- --watchAll=false
        Pop-Location
    }
    default          {
        Write-Host "Unknown command: $Command" -ForegroundColor Red
        Show-Help
        exit 1
    }
}
