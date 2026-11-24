@echo off
title FALAK Mission Control
cd /d "%~dp0"
py -3.11 -c "import sys" >nul 2>&1
if not errorlevel 1 goto python311
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 goto python3
python -c "import sys; assert sys.version_info.major == 3" >nul 2>&1
if not errorlevel 1 goto pythonpath
echo Python 3 was not found. Install Python 3.11, then open this file again.
pause
exit /b 1

:python311
py -3.11 preview.py
goto finished
:python3
py -3 preview.py
goto finished
:pythonpath
python preview.py

:finished
if errorlevel 1 pause
