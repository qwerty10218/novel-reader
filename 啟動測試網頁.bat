@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Reading Server

echo ======================================================
echo   Biyan Reader - Local Testing Server
echo ======================================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python.
    pause
    exit /b
)

echo [1/2] Opening browser at http://localhost:8000 ...
start powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:8000'"

echo [2/2] Starting Python HTTP Server on port 8000 ...
echo [NOTE] Keep this window open while testing. Press Ctrl+C to stop.
echo.

python -m http.server 8000

echo.
echo Server stopped.
pause