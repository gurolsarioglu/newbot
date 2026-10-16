@echo off
title Alpha Terminal
echo Starting Alpha Terminal on http://localhost:3000 ...
cd /d "%~dp0terminal"
node terminal-server.js
pause
