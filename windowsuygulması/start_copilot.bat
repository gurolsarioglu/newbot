@echo off
chcp 65001 > nul
title AI Trading Co-Pilot (2. Ekran Masaüstü Asistanı)
echo ========================================================
echo   🤖 AI TRADING CO-PILOT BAŞLATILIYOR...
echo   📡 2. Ekran Masaüstü Asistanı & Proaktif 5m Gözlemci
echo ========================================================
echo.

cd /d "%~dp0"

:: Arka planda sunucuyu başlat ve masaüstü penceresi olarak aç
start "" "http://localhost:4200"

node copilot-server.js
pause
