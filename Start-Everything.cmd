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
