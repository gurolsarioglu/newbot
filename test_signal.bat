@echo off
title Canli Sinyal Formati Testi
cd /d "%~dp0"
echo ======================================================
echo   Canli Binance Verisiyle Sinyal Mesaji Test Ediliyor
echo ======================================================
node test-signal.js BTCUSDT
echo.
pause
