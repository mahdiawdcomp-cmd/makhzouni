@echo off
setlocal

REM Add PostgreSQL CLI to PATH (for the check below)
set PATH=C:\Program Files\PostgreSQL\18\bin;%PATH%
set PGPASSWORD=postgres

echo.
echo ============================================
echo   Inventory System - Local Launcher
echo ============================================
echo.

REM 1) Check PostgreSQL
echo [1/3] Checking PostgreSQL...
psql -U postgres -d inventory_backend -c "SELECT 1" >nul 2>&1
if errorlevel 1 (
    echo   ERROR: PostgreSQL is not running or database "inventory_backend" is missing.
    pause
    exit /b 1
)
echo   OK - PostgreSQL is running.

REM 2) Start backend (port 5000)
echo.
echo [2/3] Starting backend on http://localhost:5000 ...
start "Inventory Backend (5000)" cmd /k "cd /d %~dp0inventory-backend && npm run dev"

REM 3) Start frontend (port 5173)
echo.
echo [3/3] Starting frontend on http://localhost:5173 ...
start "Inventory Frontend (5173)" cmd /k "cd /d %~dp0inventory-web && npm run dev"

echo.
echo ============================================
echo   READY
echo ============================================
echo.
echo   Open:    http://localhost:5173
echo   Login:   admin  /  Password123!
echo.
echo   (Backend API: http://localhost:5000)
echo.
pause
