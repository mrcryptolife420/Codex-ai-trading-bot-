@echo off
setlocal
cd /d "%~dp0"

set "DASHBOARD_URL=http://127.0.0.1:3011"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$healthUri='%DASHBOARD_URL%/api/health';" ^
  "try { Invoke-RestMethod -Uri $healthUri -Method Get -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Dashboard wordt gestart...
  start "AI Trading Bot Dashboard" cmd /k "cd /d ""%~dp0"" && node src/cli.js dashboard"
) else (
  echo Dashboard draait al. Nieuwe serverstart wordt overgeslagen.
)

echo Wachten tot dashboard klaar is...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$healthUri='%DASHBOARD_URL%/api/health';" ^
  "$deadline=(Get-Date).AddSeconds(45);" ^
  "$ready=$false;" ^
  "while((Get-Date) -lt $deadline) { try { Invoke-RestMethod -Uri $healthUri -Method Get -TimeoutSec 5 | Out-Null; $ready=$true; break } catch { Start-Sleep -Seconds 1 } }" ^
  "if (-not $ready) { throw 'Dashboard startte niet op tijd.' }"
if errorlevel 1 (
  echo Dashboard kon niet worden bereikt. Controleer het dashboardvenster voor fouten.
  exit /b 1
)

for /f "usebackq delims=" %%M in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$envPath=Join-Path '%~dp0' '.env'; if (Test-Path $envPath) { $line = Get-Content $envPath | Where-Object { $_ -match '^BOT_MODE=' } | Select-Object -First 1; if ($line) { ($line -split '=',2)[1].Trim().ToLower() } else { 'paper' } } else { 'paper' }"`) do set "TARGET_MODE=%%M"
if not defined TARGET_MODE set "TARGET_MODE=paper"
echo Dashboard mode wordt gesynchroniseerd naar %TARGET_MODE%...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$modeUri='%DASHBOARD_URL%/api/mode';" ^
  "$headers=@{ 'X-Dashboard-Request'='1'; 'Content-Type'='application/json' };" ^
  "$body=@{ mode='%TARGET_MODE%' } | ConvertTo-Json -Compress;" ^
  "Invoke-RestMethod -Uri $modeUri -Method Post -Headers $headers -Body $body -TimeoutSec 20 | Out-Null"
if errorlevel 1 (
  echo Dashboard draaide, maar mode-sync naar %TARGET_MODE% mislukte.
  exit /b 1
)

echo Bot wordt gestart met de actuele code...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$startUri='%DASHBOARD_URL%/api/start';" ^
  "$headers=@{ 'X-Dashboard-Request'='1'; 'Content-Type'='application/json' };" ^
  "Invoke-RestMethod -Uri $startUri -Method Post -Headers $headers -Body '{}' -TimeoutSec 15 | Out-Null"
if errorlevel 1 (
  echo Dashboard draait, maar de bot kon niet automatisch worden gestart.
  echo Open %DASHBOARD_URL% en klik handmatig op Start bot.
  exit /b 1
)

start "" "%DASHBOARD_URL%"
echo Dashboard en bot draaien nu met de huidige code uit deze map.
endlocal
