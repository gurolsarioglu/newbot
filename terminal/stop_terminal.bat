@echo off
title Alpha Terminal Stopper
echo ========================================================
echo   ALPHA TERMINAL - ARKA PLAN SERVISINI DURDUR
echo ========================================================

powershell -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { echo \"[Durduruluyor] PID: $_ (Port 3000)\"; Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo.
echo Alpha Terminal arka plan sureci basariyla durduruldu.
ping -n 3 127.0.0.1 >nul
