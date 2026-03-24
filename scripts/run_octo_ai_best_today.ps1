param(
  [string]$BaseUrl = "http://localhost:8000",
  [string]$WorkspaceId = "1c346031-9227-4d58-b4c2-625d111bdb41",
  [string]$RunsDir = "C:\temp\octo_ai_self_heal_local",
  [int]$Hours = 8,
  [double]$SleepSeconds = 5,
  [string]$CodexBin = "",
  [string]$BriefFile = "",
  [switch]$StopOnClean
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$mainRunner = Join-Path $repoRoot "scripts\run_octo_ai_self_heal_local.ps1"

& $mainRunner `
  -BaseUrl $BaseUrl `
  -WorkspaceId $WorkspaceId `
  -RunsDir $RunsDir `
  -Label "best_today_octo_ai" `
  -Mode Today `
  -Hours $Hours `
  -SleepSeconds $SleepSeconds `
  -CodexBin $CodexBin `
  -BriefFile $BriefFile `
  -StopOnClean:$StopOnClean

exit $LASTEXITCODE
