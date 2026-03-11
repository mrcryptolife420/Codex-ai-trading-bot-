$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is niet gevonden. Installeer Node.js 22 of nieuwer en start dit script opnieuw."
}

$nodeVersion = node -p "process.versions.node"
$majorVersion = [int]($nodeVersion.Split('.')[0])
if ($majorVersion -lt 22) {
  throw "Node.js 22 of nieuwer is vereist. Gevonden: $nodeVersion"
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host ".env aangemaakt op basis van .env.example"
}

$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
  & git config --global core.longpaths true
  Write-Host "Git long-path support staat nu aan."
  Write-Host "Aanbevolen clone-pad op Windows: C:\code\Codex-ai-trading-bot"
} else {
  Write-Warning "Git is niet gevonden. Sla deze stap niet over als je later opnieuw kloont: git config --global core.longpaths true"
}

New-Item -ItemType Directory -Force -Path "data\runtime" | Out-Null
New-Item -ItemType Directory -Force -Path "data\runtime\feature-store" | Out-Null
New-Item -ItemType Directory -Force -Path "data\runtime\backups" | Out-Null

Write-Host "Tests draaien..."
& npm.cmd test
if ($LASTEXITCODE -ne 0) {
  throw "npm.cmd test is mislukt."
}

Write-Host "Doctor check draaien..."
& node src/cli.js doctor
if ($LASTEXITCODE -ne 0) {
  throw "node src/cli.js doctor is mislukt."
}

Write-Host ""
Write-Host "Installatie klaar. Volgende stap:"
Write-Host "1. Vul BINANCE_API_KEY en BINANCE_API_SECRET in .env in als je live wilt traden."
Write-Host "2. Laat BOT_MODE voorlopig op paper staan voor veilige tests."
Write-Host "3. Start het dashboard met Start-Dashboard.cmd of node src/cli.js dashboard."
Write-Host "4. Voor een watchdog/service-run gebruik je Start-BotService.cmd."
