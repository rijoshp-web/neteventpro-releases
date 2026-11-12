@echo off
rem Double-click to build the NetEventPro installer (see build.ps1 for requirements).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
if errorlevel 1 (
  echo.
  echo Build failed. Read the message above.
) else (
  echo.
  echo Installer is in the dist folder.
)
pause
