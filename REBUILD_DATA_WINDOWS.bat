@echo off
title FALAK - Rebuild simulation data
cd /d "%~dp0"
if not exist ".build-venv\Scripts\python.exe" (
  py -3.11 -m venv .build-venv
  if errorlevel 1 goto fail
  .build-venv\Scripts\python.exe -m pip install -r python\requirements-build.txt
  if errorlevel 1 goto fail
)
.build-venv\Scripts\python.exe python\tools\build_sgp4.py
if errorlevel 1 goto fail
.build-venv\Scripts\python.exe python\export_web.py
if errorlevel 1 goto fail
echo DONE. Upload the updated site folder to your website.
pause
exit /b 0
:fail
echo Build stopped. Read the error above. No website deployment was attempted.
pause
exit /b 1
