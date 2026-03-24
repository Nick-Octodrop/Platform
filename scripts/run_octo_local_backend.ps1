param(
  [int]$Port = 8000,
  [switch]$UseDb,
  [switch]$UseMemory
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
$webEnv = Join-Path $repoRoot "web\.env"

if (-not (Test-Path $python)) {
  throw "Python venv not found at $python"
}

Set-Location $repoRoot

if ($UseDb -and $UseMemory) {
  throw "Choose either -UseDb or -UseMemory, not both."
}

if ($UseDb) {
  $env:USE_DB = "1"
} elseif ($UseMemory) {
  $env:USE_DB = "0"
} elseif (-not $env:USE_DB) {
  # Default to the DB-backed path so Octo AI sandbox sessions open real replica workspaces.
  $env:USE_DB = "1"
}

if (-not $env:SUPABASE_URL) {
  if (Test-Path $webEnv) {
    $supabaseUrlLine = Get-Content $webEnv | Where-Object { $_ -match '^VITE_SUPABASE_URL=' } | Select-Object -First 1
    if ($supabaseUrlLine) {
      $env:SUPABASE_URL = ($supabaseUrlLine -split '=', 2)[1].Trim()
    }
  }
}

if (-not $env:SUPABASE_URL) {
  throw "SUPABASE_URL is not set and could not be loaded from web\.env"
}

Write-Host "Starting local backend on port $Port with USE_DB=$($env:USE_DB) SUPABASE_URL=$($env:SUPABASE_URL)"
& $python -m uvicorn app.main:app --reload --reload-dir (Join-Path $repoRoot "app") --port $Port
exit $LASTEXITCODE
