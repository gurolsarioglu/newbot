@echo off
title Alpha Terminal Status
echo ========================================================
echo   ALPHA TERMINAL - CALISMA DURUMU KONTROLU
echo ========================================================
netstat -aon | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo [DURUM] Alpha Terminal arka planda AKTIF calisiyor - Port 3000
    echo Tarayicidan http://localhost:3000 adresine girebilirsiniz.
    echo 60 Gunluk kalici sinyal depolama devrede.
) else (
    echo [DURUM] Alpha Terminal su anda calismiyor.
    echo Baslatmak icin: start_terminal_background.bat veya start_terminal.bat
)
echo ========================================================
pause
