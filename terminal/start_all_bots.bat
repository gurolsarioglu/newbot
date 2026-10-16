@echo off
echo ========================================================
echo   ALPHA TERMINAL - TUM 9 BOTU 2. EKRANDA BASLAT
echo   Adres cubuksuz tam masaustu app modunda baslatiliyor...
echo ========================================================

set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

set BOTS=div 4ssniper v3 hammerproplus m1a m1premium fr 4s hammerpro

for %%B in (%BOTS%) do (
    echo [Baslatiliyor] %%B
    start "" %CHROME% --app="http://localhost:3000/bot-window.html?bot=%%B" --window-size=440,780
    timeout /t 1 /nobreak >nul
)

echo Tamamlandi. Tum pencereler adres cubuksuz baslatildi.
timeout /t 2 >nul
exit /b 0
