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
$maxRestartsPerHour = [int](Get-EnvValue -Name "SERVICE_MAX_RESTARTS_PER_HOUR" -Default "20")
$restartWindowMinutes = 60
$restartTimes = New-Object System.Collections.Generic.List[datetime]

Write-Host "Bot-service gestart. Restart delay: $restartDelaySeconds s | max restarts per uur: $maxRestartsPerHour"
Write-Host "Stop dit venster of druk Ctrl+C om de watchdog te stoppen."

while ($true) {
  $now = Get-Date
  for ($index = $restartTimes.Count - 1; $index -ge 0; $index -= 1) {
    if (($now - $restartTimes[$index]).TotalMinutes -gt $restartWindowMinutes) {
      $restartTimes.RemoveAt($index)
    }
  }

  Write-Host "[$((Get-Date).ToString('s'))] Start node src/cli.js run"
  & node src/cli.js run
  $exitCode = $LASTEXITCODE

  if ($exitCode -eq 0) {
    Write-Host "Bot-loop is schoon gestopt. Watchdog sluit nu af."
    break
  }

  $restartTimes.Add((Get-Date))
  if ($restartTimes.Count -gt $maxRestartsPerHour) {
    throw "Bot-service is te vaak herstart binnen 60 minuten ($($restartTimes.Count)x). Controleer logs, self-heal en datafeeds."
  }

  Write-Warning "Bot-loop stopte met exit code $exitCode. Nieuwe poging over $restartDelaySeconds seconden."
  Start-Sleep -Seconds $restartDelaySeconds
}
