param(
  [string]$PythonExe = "python"
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$installScript = Join-Path $scriptRoot "install_all.py"

if (-not (Test-Path $installScript)) {
  throw "Missing install script: $installScript"
}

Write-Host "[te] Installing or updating all True Essentials manifests..."
& $PythonExe $installScript
if ($LASTEXITCODE -ne 0) {
  throw "True Essentials manifest install/update failed with exit code $LASTEXITCODE"
}

Write-Host "[te] True Essentials manifest install/update complete."
