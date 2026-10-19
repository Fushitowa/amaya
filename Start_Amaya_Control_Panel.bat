@echo off
title Amaya's Drinks and Bites — Control Panel Launcher
cd /d "%~dp0"

set "TARGET_SCRIPT=scripts\amaya_control_panel.py"
if not exist "%TARGET_SCRIPT%" set "TARGET_SCRIPT=amaya_control_panel.py"

where pythonw >nul 2>nul
if %errorlevel% equ 0 (
    start "" pythonw "%TARGET_SCRIPT%"
    exit /b 0
)

where pyw >nul 2>nul
if %errorlevel% equ 0 (
    start "" pyw "%TARGET_SCRIPT%"
    exit /b 0
)

where python >nul 2>nul
if %errorlevel% equ 0 (
    start "" python "%TARGET_SCRIPT%"
    exit /b 0
)

echo [ERROR] Python 3 was not found on your PATH. Please install Python 3 to run the Amaya Control Panel.
pause
exit /b 1
