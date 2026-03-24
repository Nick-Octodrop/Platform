param(
  [string]$BaseUrl = "https://octodrop-platform-api.fly.dev",
  [string]$WorkspaceId = "1c346031-9227-4d58-b4c2-625d111bdb41",
  [string]$ScenarioFile = "specs\octo_ai_eval_business_suite.json",
  [string]$RunsDir = "C:\temp\octo_ai_self_heal",
  [string]$Label = "business_suite",
  [int]$Cycles = 0,
  [double]$SleepSeconds = 10,
  [string]$DeployCmd = "flyctl deploy -a octodrop-platform-api",
  [switch]$StopOnClean
)

if (-not $env:OCTO_AI_EVAL_EMAIL) {
  throw "Set OCTO_AI_EVAL_EMAIL before running this script."
}

if (-not $env:OCTO_AI_EVAL_PASSWORD) {
  throw "Set OCTO_AI_EVAL_PASSWORD before running this script."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
$loopScript = Join-Path $repoRoot "scripts\octo_ai_self_heal_loop.py"

if (-not (Test-Path $python)) {
  throw "Python venv not found at $python"
}

$args = @(
  $loopScript,
  "--runs-dir", $RunsDir,
  "--cycles", $Cycles,
  "--sleep-seconds", $SleepSeconds,
  "--label", $Label,
  "--deploy-cmd", $DeployCmd
)

if ($StopOnClean) {
  $args += "--stop-on-clean"
}

$args += @(
  "--",
  "--scenario-file", $ScenarioFile,
  "--base-url", $BaseUrl,
  "--workspace-id", $WorkspaceId
)

& $python @args
exit $LASTEXITCODE
