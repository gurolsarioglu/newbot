@echo off
set BOT=%1
if "%BOT%"=="" set BOT=m1premium
echo ========================================================
echo   ALPHA TERMINAL - 2. EKRAN BAGIMSIZ BOT PENCERESI
echo   Hedef Bot: %BOT%
echo   Adres cubuksuz tam masaustu app modunda baslatiliyor...
echo ========================================================

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app="http://localhost:3000/bot-window.html?bot=%BOT%" --window-size=460,820
    goto end
)

if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:3000/bot-window.html?bot=%BOT%" --window-size=460,820
    goto end
)

start "" "http://localhost:3000/bot-window.html?bot=%BOT%"

:end
exit /b 0
