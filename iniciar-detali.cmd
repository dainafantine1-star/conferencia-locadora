@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".next\BUILD_ID" (
  echo Primeiro compile o sistema com npm.cmd run build.
  pause
  exit /b 1
)
echo Detali local: http://127.0.0.1:3000/login
echo Mantenha esta janela aberta enquanto estiver usando o sistema.
call npm.cmd start -- --hostname 127.0.0.1 --port 3000
pause
