@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0Install-Windows11.ps1"
