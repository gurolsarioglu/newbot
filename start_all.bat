@echo off
title Multi Bot Runner (NewBot)
cd /d "%~dp0"
echo =========================================================
echo   NewBot Suite (15m, 1G, 1Gpro, 4Spro) Baslatiliyor...
echo =========================================================

start "15m Hunter" cmd /k "cd /d "%~dp0" && node hunter-15m.js"
timeout /t 2 /nobreak >nul

start "1G Hunter" cmd /k "cd /d "%~dp0" && node hunter-1g.js"
timeout /t 2 /nobreak >nul

start "1Gpro MTF Hunter" cmd /k "cd /d "%~dp0" && node hunter-1gpro.js"
timeout /t 2 /nobreak >nul

start "4Spro RSI SMA Hunter" cmd /k "cd /d "%~dp0" && node hunter-4spro.js"

echo ✅ Tum botlar ayri pencerelerde baslatildi.
pause
