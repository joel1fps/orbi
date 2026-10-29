@echo off
rem Abre o Orbi Desktop (instala e compila na primeira vez).
cd /d "%~dp0"
if not exist "node_modules" call npm install
if not exist "out\main\index.js" call npm run build
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
