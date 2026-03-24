param(
  [string]$App = "octodrop-platform-api",
  [string]$Tag = "runtime-base-py311-playwright"
)

$ErrorActionPreference = "Stop"

$image = "registry.fly.io/$App`:$Tag"

function Assert-LastExitCode {
  param(
    [string]$Step
  )

  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

Write-Host "Authenticating Docker to Fly registry..."
flyctl auth docker
Assert-LastExitCode "flyctl auth docker"

Write-Host "Checking Docker daemon..."
docker version | Out-Null
Assert-LastExitCode "docker version"

Write-Host "Building runtime base image: $image"
docker build -f Dockerfile.base -t $image .
Assert-LastExitCode "docker build"

Write-Host "Pushing runtime base image: $image"
docker push $image
Assert-LastExitCode "docker push"

Write-Host "Runtime base image ready: $image"
