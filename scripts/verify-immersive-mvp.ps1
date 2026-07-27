[CmdletBinding()]
param(
  [string]$EnvFile = ".env.docker",
  [string]$ProjectName = "jiashu-verify",
  [ValidateRange(1025, 65535)]
  [int]$Port = 8081,
  [switch]$KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFilePath = Join-Path $repoRoot $EnvFile

if (-not (Test-Path -LiteralPath $envFilePath -PathType Leaf)) {
  throw "Docker environment file does not exist: $envFilePath"
}
if ($ProjectName -eq "jiashu") {
  throw "The isolated verifier refuses the production Compose project name jiashu."
}
if ($ProjectName -notmatch '^[a-z0-9][a-z0-9_-]*$') {
  throw "ProjectName may contain only lowercase letters, digits, hyphens, and underscores."
}

$composeBase = @("compose", "--env-file", $envFilePath, "-p", $ProjectName)
$previousPort = [Environment]::GetEnvironmentVariable("NGINX_HOST_PORT", "Process")
$previousAuthUrl = [Environment]::GetEnvironmentVariable("AUTH_URL", "Process")
$previousAuthSessionCookieName = [Environment]::GetEnvironmentVariable("AUTH_SESSION_COOKIE_NAME", "Process")
$env:NGINX_HOST_PORT = "$Port"
# Keep Auth.js callbacks on the same localhost host used by the browser. The
# isolated session-cookie name below prevents collisions with the root demo.
$env:AUTH_URL = "http://localhost:$Port"
$cookieProjectName = $ProjectName -replace "[^a-z0-9]", "-"
$env:AUTH_SESSION_COOKIE_NAME = "authjs.$cookieProjectName.session-token"

function Invoke-Compose([string[]]$Arguments) {
  & docker @composeBase @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Get-ServiceContainerId([string]$Service) {
  $id = (& docker @composeBase "ps" "-q" $Service | Select-Object -First 1).Trim()
  if ([string]::IsNullOrWhiteSpace($id)) {
    throw "Service container was not found: $Service"
  }
  return $id
}

function Wait-ServiceHealthy([string]$Service, [int]$TimeoutSeconds = 45) {
  $containerId = Get-ServiceContainerId $Service
  for ($i = 0; $i -lt $TimeoutSeconds; $i += 1) {
    $health = (docker inspect $containerId --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}').Trim()
    if ($health -eq "healthy") {
      return
    }
    Start-Sleep -Seconds 1
  }
  & docker logs --tail 80 $containerId
  throw "Service $Service did not become healthy within $TimeoutSeconds seconds."
}

function Invoke-ReadyCheck {
  $response = Invoke-WebRequest "http://127.0.0.1:$Port/api/health/ready" -UseBasicParsing
  if ($response.StatusCode -ne 200) {
    throw "Readiness check returned HTTP $($response.StatusCode)."
  }
}

try {
  Invoke-Compose @("up", "-d", "--build")
  Invoke-Compose @("ps")
  Wait-ServiceHealthy "app"
  Wait-ServiceHealthy "nginx"
  Invoke-ReadyCheck

  $workerId = Get-ServiceContainerId "worker"
  & docker exec $workerId sh -c 'printf verify > /data/media/runtime-restart-marker && test -w /data/media'
  if ($LASTEXITCODE -ne 0) { throw "Worker cannot write the private media volume." }

  Invoke-Compose @("restart", "app", "worker")
  Wait-ServiceHealthy "app"
  Invoke-ReadyCheck

  $workerId = Get-ServiceContainerId "worker"
  & docker exec $workerId sh -c 'test -f /data/media/runtime-restart-marker && grep -qx verify /data/media/runtime-restart-marker && rm /data/media/runtime-restart-marker'
  if ($LASTEXITCODE -ne 0) { throw "Media volume content did not persist after the app/worker restart." }

  Write-Host "Isolated Docker MVP verification passed: http://127.0.0.1:$Port"
}
finally {
  if ($null -eq $previousPort) { Remove-Item Env:NGINX_HOST_PORT -ErrorAction SilentlyContinue } else { $env:NGINX_HOST_PORT = $previousPort }
  if ($null -eq $previousAuthUrl) { Remove-Item Env:AUTH_URL -ErrorAction SilentlyContinue } else { $env:AUTH_URL = $previousAuthUrl }
  if ($null -eq $previousAuthSessionCookieName) { Remove-Item Env:AUTH_SESSION_COOKIE_NAME -ErrorAction SilentlyContinue } else { $env:AUTH_SESSION_COOKIE_NAME = $previousAuthSessionCookieName }
  if (-not $KeepArtifacts) {
    & docker @composeBase "down" "-v" "--remove-orphans"
    if ($LASTEXITCODE -ne 0) { throw "Temporary Compose cleanup failed for project $ProjectName" }
  }
}
