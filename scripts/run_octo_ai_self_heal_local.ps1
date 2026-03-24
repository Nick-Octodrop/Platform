param(
  [string]$BaseUrl = "http://localhost:8000",
  [string]$WorkspaceId = "1c346031-9227-4d58-b4c2-625d111bdb41",
  [string]$RunsDir = "C:\temp\octo_ai_self_heal_local",
  [string]$Label = "local_octo_ai",
  [ValidateSet("Unified", "Planner", "Business", "Today")]
  [string]$Mode = "Unified",
  [int]$Cycles = 0,
  [int]$Hours = 8,
  [double]$SleepSeconds = 5,
  [string]$CodexBin = "",
  [string]$BriefFile = "",
  [switch]$StopOnClean
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
$loopScript = Join-Path $repoRoot "scripts\octo_ai_self_heal_loop.py"
$buildBusinessSuite = Join-Path $repoRoot "scripts\build_octo_ai_business_suite.py"
$plannerSuite = "specs\octo_ai_eval_planner_preview_suite.json"
$businessSuite = "specs\octo_ai_eval_business_suite.json"
$plannerBrief = Join-Path $repoRoot "OCTO_AI_MILESTONE_BRIEF.md"
$businessBrief = Join-Path $repoRoot "OCTO_AI_SELF_HEAL_BRIEF.md"
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

if (-not $CodexBin) {
  throw "Codex binary not found. Pass -CodexBin explicitly."
}

function Get-DefaultCycles {
  param(
    [string]$LoopMode,
    [int]$TargetHours
  )
  if ($TargetHours -le 0) {
    return 0
  }
  $minutes = $TargetHours * 60
  switch ($LoopMode) {
    "Planner" { return [Math]::Max(1, [int]([Math]::Floor($minutes / 12))) }
    "Business" { return [Math]::Max(1, [int]([Math]::Floor($minutes / 30))) }
    default { return [Math]::Max(1, [int]([Math]::Floor($minutes / 40))) }
  }
}

function Invoke-HealLoop {
  param(
    [string]$LoopLabel,
    [string]$ScenarioFile,
    [string]$InstructionFile,
    [string]$LoopRunsDir,
    [int]$LoopCycles
  )

  $args = @(
    $loopScript,
    "--runs-dir", $LoopRunsDir,
    "--cycles", $LoopCycles,
    "--sleep-seconds", $SleepSeconds,
    "--label", $LoopLabel,
    "--codex-bin", $CodexBin,
    "--instruction-file", $InstructionFile,
    "--score-script", $scoreScript,
    "--score-scenario-file", $ScenarioFile,
    "--curriculum-base-scenario-file", $ScenarioFile,
    "--curriculum-state-file", (Join-Path $LoopRunsDir "curriculum_state.json")
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
  if ($LASTEXITCODE -ne 0) {
    throw "Loop '$LoopLabel' failed with exit code $LASTEXITCODE"
  }
}

function Invoke-TodayLoop {
  param(
    [string]$LoopLabel,
    [string]$BusinessBriefToUse
  )

  $plannerRunsDir = Join-Path $RunsDir "planner"
  $businessRunsDir = Join-Path $RunsDir "business"
  $deadline = (Get-Date).AddHours([Math]::Max(1, $Hours))
  $plannerEstimateMinutes = 55
  $businessEstimateMinutes = 100
  $phaseHistory = New-Object System.Collections.Generic.List[string]

  Write-Host ""
  Write-Host "Starting Today mode with hard deadline: $deadline"

  while ((Get-Date) -lt $deadline) {
    $remainingMinutes = [int][Math]::Floor(($deadline - (Get-Date)).TotalMinutes)
    $nextPhase = "Business"

    if ($phaseHistory.Count -eq 0) {
      $nextPhase = "Planner"
    } elseif ($remainingMinutes -le $plannerEstimateMinutes) {
      break
    } elseif ($remainingMinutes -lt $businessEstimateMinutes) {
      $nextPhase = "Planner"
    } elseif ($phaseHistory.Count -ge 2) {
      $lastTwo = @($phaseHistory[$phaseHistory.Count - 2], $phaseHistory[$phaseHistory.Count - 1])
      if ($lastTwo[0] -eq "Business" -and $lastTwo[1] -eq "Business") {
        $nextPhase = "Planner"
      }
    }

    Write-Host ""
    Write-Host "Today mode: next phase = $nextPhase | remaining ~${remainingMinutes}m"

    if ($nextPhase -eq "Planner") {
      Invoke-HealLoop `
        -LoopLabel "$LoopLabel`_planner" `
        -ScenarioFile $plannerSuite `
        -InstructionFile $plannerBrief `
        -LoopRunsDir $plannerRunsDir `
        -LoopCycles 1
    } else {
      Invoke-HealLoop `
        -LoopLabel "$LoopLabel`_business" `
        -ScenarioFile $businessSuite `
        -InstructionFile $BusinessBriefToUse `
        -LoopRunsDir $businessRunsDir `
        -LoopCycles 1
    }

    $phaseHistory.Add($nextPhase)
  }

  Write-Host ""
  Write-Host "Today mode complete."
  Write-Host "Phases run: $($phaseHistory.Count)"
  if ($phaseHistory.Count -gt 0) {
    Write-Host "Phase order: $([string]::Join(', ', $phaseHistory))"
  }
}

New-Item -ItemType Directory -Force -Path $RunsDir | Out-Null

Write-Host "Regenerating business suite..."
& $python $buildBusinessSuite
if ($LASTEXITCODE -ne 0) {
  throw "Failed to build business suite."
}

switch ($Mode) {
  "Planner" {
    $plannerCycles = if ($Cycles -gt 0) { $Cycles } else { Get-DefaultCycles -LoopMode "Planner" -TargetHours $Hours }
    Invoke-HealLoop `
      -LoopLabel "$Label`_planner" `
      -ScenarioFile $plannerSuite `
      -InstructionFile $plannerBrief `
      -LoopRunsDir (Join-Path $RunsDir "planner") `
      -LoopCycles $plannerCycles
  }
  "Business" {
    $businessBriefToUse = if ($BriefFile) { $BriefFile } else { $businessBrief }
    $businessCycles = if ($Cycles -gt 0) { $Cycles } else { Get-DefaultCycles -LoopMode "Business" -TargetHours $Hours }
    Invoke-HealLoop `
      -LoopLabel "$Label`_business" `
      -ScenarioFile $businessSuite `
      -InstructionFile $businessBriefToUse `
      -LoopRunsDir (Join-Path $RunsDir "business") `
      -LoopCycles $businessCycles
  }
  "Unified" {
    $plannerCycles = if ($Cycles -gt 0) { [Math]::Max(1, [int]([Math]::Ceiling($Cycles * 0.35))) } else { Get-DefaultCycles -LoopMode "Planner" -TargetHours ([Math]::Max(1, [int]([Math]::Floor($Hours * 0.3)))) }
    $businessCycles = if ($Cycles -gt 0) { [Math]::Max(1, [int]([Math]::Ceiling($Cycles * 0.65))) } else { Get-DefaultCycles -LoopMode "Business" -TargetHours ([Math]::Max(1, [int]([Math]::Ceiling($Hours * 0.7)))) }
    $businessBriefToUse = if ($BriefFile) { $BriefFile } else { $businessBrief }

    Write-Host ""
    Write-Host "Starting unified planner pass..."
    Invoke-HealLoop `
      -LoopLabel "$Label`_planner" `
      -ScenarioFile $plannerSuite `
      -InstructionFile $plannerBrief `
      -LoopRunsDir (Join-Path $RunsDir "planner") `
      -LoopCycles $plannerCycles

    Write-Host ""
    Write-Host "Starting unified business pass..."
    Invoke-HealLoop `
      -LoopLabel "$Label`_business" `
      -ScenarioFile $businessSuite `
      -InstructionFile $businessBriefToUse `
      -LoopRunsDir (Join-Path $RunsDir "business") `
      -LoopCycles $businessCycles
  }
  "Today" {
    $businessBriefToUse = if ($BriefFile) { $BriefFile } else { $businessBrief }
    Invoke-TodayLoop `
      -LoopLabel $Label `
      -BusinessBriefToUse $businessBriefToUse
  }
}

Write-Host ""
Write-Host "Self-heal run complete."
Write-Host "Mode: $Mode"
Write-Host "Runs: $RunsDir"
