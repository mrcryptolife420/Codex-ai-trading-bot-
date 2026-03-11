@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File ".\Run-BotService.ps1"
