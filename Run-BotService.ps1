$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Get-EnvValue {
  param(
    [string]$Name,
    [string]$Default
  )

  if (-not (Test-Path ".env")) {
    return $Default
  }

  $line = Get-Content ".env" | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -Last 1
  if (-not $line) {
    return $Default
  }

  $value = ($line -split "=", 2)[1].Trim()
  if ($value.StartsWith('"') -and $value.EndsWith('"')) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is niet gevonden. Installeer Node.js 22 of nieuwer en start dit script opnieuw."
}

$restartDelaySeconds = [int](Get-EnvValue -Name "SERVICE_RESTART_DELAY_SECONDS" -Default "8")
$restartBackoffMultiplier = [double](Get-EnvValue -Name "SERVICE_RESTART_BACKOFF_MULTIPLIER" -Default "1.8")
$restartMaxDelaySeconds = [int](Get-EnvValue -Name "SERVICE_RESTART_MAX_DELAY_SECONDS" -Default "180")
$maxRestartsPerHour = [int](Get-EnvValue -Name "SERVICE_MAX_RESTARTS_PER_HOUR" -Default "20")
$serviceStatusFilename = Get-EnvValue -Name "SERVICE_STATUS_FILENAME" -Default "service-status.json"
$restartWindowMinutes = 60
$restartTimes = New-Object System.Collections.Generic.List[datetime]
$currentDelaySeconds = $restartDelaySeconds
$serviceStatusPath = Join-Path $PSScriptRoot "data/runtime/$serviceStatusFilename"

New-Item -ItemType Directory -Force -Path (Split-Path $serviceStatusPath -Parent) | Out-Null

function Write-ServiceStatus {
  param(
    [string]$State,
    [int]$ExitCode = 0,
    [double]$DelaySeconds = 0
  )

  $payload = [ordered]@{
    updatedAt = (Get-Date).ToString("o")
    state = $State
    exitCode = $ExitCode
    restartDelaySeconds = [math]::Round($DelaySeconds, 1)
    baseDelaySeconds = $restartDelaySeconds
    restartBackoffMultiplier = $restartBackoffMultiplier
    restartMaxDelaySeconds = $restartMaxDelaySeconds
    maxRestartsPerHour = $maxRestartsPerHour
  }

  $payload | ConvertTo-Json -Depth 4 | Set-Content -Path $serviceStatusPath -Encoding UTF8
}

Write-Host "Bot-service gestart. Restart delay: $restartDelaySeconds s | backoff x$restartBackoffMultiplier | max delay: $restartMaxDelaySeconds s | max restarts per uur: $maxRestartsPerHour"
Write-Host "Stop dit venster of druk Ctrl+C om de watchdog te stoppen."
Write-Host "Statusfile: $serviceStatusPath"

while ($true) {
  $now = Get-Date
  for ($index = $restartTimes.Count - 1; $index -ge 0; $index -= 1) {
    if (($now - $restartTimes[$index]).TotalMinutes -gt $restartWindowMinutes) {
      $restartTimes.RemoveAt($index)
    }
  }

  Write-ServiceStatus -State "starting" -DelaySeconds $currentDelaySeconds
  Write-Host "[$((Get-Date).ToString('s'))] Start node src/cli.js run"
  & node src/cli.js run
  $exitCode = $LASTEXITCODE

  if ($exitCode -eq 0) {
    Write-ServiceStatus -State "stopped" -ExitCode $exitCode -DelaySeconds 0
    Write-Host "Bot-loop is schoon gestopt. Watchdog sluit nu af."
    break
  }

  $restartTimes.Add((Get-Date))
  if ($restartTimes.Count -gt $maxRestartsPerHour) {
    Write-ServiceStatus -State "blocked" -ExitCode $exitCode -DelaySeconds $currentDelaySeconds
    throw "Bot-service is te vaak herstart binnen 60 minuten ($($restartTimes.Count)x). Controleer logs, self-heal en datafeeds."
  }

  Write-ServiceStatus -State "restarting" -ExitCode $exitCode -DelaySeconds $currentDelaySeconds
  Write-Warning "Bot-loop stopte met exit code $exitCode. Nieuwe poging over $currentDelaySeconds seconden."
  Start-Sleep -Seconds $currentDelaySeconds
  $currentDelaySeconds = [math]::Min($restartMaxDelaySeconds, [math]::Ceiling([double]$currentDelaySeconds * [math]::Max($restartBackoffMultiplier, 1)))
}
