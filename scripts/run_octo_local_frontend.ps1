param(
  [string]$ApiUrl = "http://localhost:8000"
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $repoRoot "web"

if (-not (Test-Path $webRoot)) {
  throw "Web directory not found at $webRoot"
}

Set-Location $webRoot
$env:VITE_API_URL = $ApiUrl

npm run dev
exit $LASTEXITCODE
