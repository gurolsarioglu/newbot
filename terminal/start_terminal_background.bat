@echo off
title Alpha Terminal Background Launcher
echo ========================================================
echo   ALPHA TERMINAL - 7/24 ARKA PLAN SERVISI BASLATILIYOR
echo ========================================================
wscript.exe "%~dp0start_terminal_background.vbs"
ping -n 3 127.0.0.1 >nul
netstat -aon | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo [BASARILI] Alpha Terminal arka planda 7/24 sessiz modda aktif edildi!
    echo Tarayiciyi kapatsaniz dahi tum bot sinyalleri 60 gun boyunca
    echo data/signals_history.json dosyasina kesintisiz kaydedilecektir.
    echo Erisim: http://localhost:3000
) else (
    echo [BILGI] Baslatma komutu gonderildi. 
)
echo ========================================================
ping -n 3 127.0.0.1 >nul
