@echo off
REM =============================================================
REM Start Orchestrator Service - Windows
REM =============================================================
REM This script starts the SRE-Bot orchestrator service
REM Usage: start_orchestrator.bat

echo ================================================================
echo   SRE-Bot Orchestrator Service
echo   Starting incident response automation...
echo ================================================================
echo.

REM Check if .env file exists
if not exist .env (
    echo [ERROR] .env file not found
    echo.
    echo Please create a .env file with your Supabase credentials:
    echo   copy .env.example .env
    echo   REM Edit .env with your SUPABASE_URL and SUPABASE_ANON_KEY
    echo.
    pause
    exit /b 1
)

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed
    echo Please install Python 3.7 or higher from python.org
    pause
    exit /b 1
)

REM Check if dependencies are installed
echo [INFO] Checking dependencies...
python -c "import supabase" >nul 2>&1
if errorlevel 1 (
    echo [WARN] Dependencies not installed. Installing...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
)

echo [OK] All checks passed
echo.
echo [INFO] Starting orchestrator service...
echo        Press Ctrl+C to stop
echo.

REM Start the orchestrator
python orchestrator_service.py

REM Made with Bob

@REM Made with Bob
