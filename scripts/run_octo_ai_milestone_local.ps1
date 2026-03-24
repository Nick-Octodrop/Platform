param(
  [string]$BaseUrl = "http://localhost:8000",
  [string]$WorkspaceId = "1c346031-9227-4d58-b4c2-625d111bdb41",
  [string]$ScenarioFile = "specs\octo_ai_eval_planner_preview_suite.json",
  [string]$RunsDir = "C:\temp\octo_ai_milestone_local",
  [string]$Label = "local_planner_preview",
  [int]$Cycles = 0,
  [double]$SleepSeconds = 5,
  [string]$CodexBin = "",
  [switch]$StopOnClean
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
$loopScript = Join-Path $repoRoot "scripts\octo_ai_self_heal_loop.py"
$briefFile = Join-Path $repoRoot "OCTO_AI_MILESTONE_BRIEF.md"
$scoreScript = Join-Path $repoRoot "scripts\octo_ai_eval_scoreboard.py"

if (-not (Test-Path $python)) {
  throw "Python venv not found at $python"
}

if (-not $CodexBin) {
  $codexCandidates = @(
    "$env:USERPROFILE\.vscode\extensions\openai.chatgpt-26.5313.41514-win32-x64\bin\windows-x86_64\codex.exe",
    "$env:USERPROFILE\.vscode\extensions\openai.chatgpt-26.5311.21342-win32-x64\bin\windows-x86_64\codex.exe",
    "$env:USERPROFILE\.vscode\extensions\openai.chatgpt-26.5311.21138-win32-x64\bin\windows-x86_64\codex.exe"
  )
  foreach ($candidate in $codexCandidates) {
    if (Test-Path $candidate) {
      $CodexBin = $candidate
      break
    }
  }
}

$args = @(
  $loopScript,
  "--runs-dir", $RunsDir,
  "--cycles", $Cycles,
  "--sleep-seconds", $SleepSeconds,
  "--label", $Label,
  "--codex-bin", $CodexBin,
  "--instruction-file", $briefFile,
  "--score-script", $scoreScript,
  "--score-scenario-file", $ScenarioFile,
  "--curriculum-base-scenario-file", $ScenarioFile,
  "--curriculum-state-file", (Join-Path $RunsDir "curriculum_state.json"),
  "--",
  "--scenario-file", $ScenarioFile,
  "--base-url", $BaseUrl,
  "--workspace-id", $WorkspaceId
)

if ($StopOnClean) {
  $args = @(
    $loopScript,
    "--runs-dir", $RunsDir,
    "--cycles", $Cycles,
    "--sleep-seconds", $SleepSeconds,
    "--label", $Label,
    "--codex-bin", $CodexBin,
    "--instruction-file", $briefFile,
    "--score-script", $scoreScript,
    "--score-scenario-file", $ScenarioFile,
    "--curriculum-base-scenario-file", $ScenarioFile,
    "--curriculum-state-file", (Join-Path $RunsDir "curriculum_state.json"),
    "--stop-on-clean",
    "--",
    "--scenario-file", $ScenarioFile,
    "--base-url", $BaseUrl,
    "--workspace-id", $WorkspaceId
  )
}

& $python @args
exit $LASTEXITCODE
