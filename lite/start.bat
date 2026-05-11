@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   OpenWhispr Lite - starting...
echo ============================================
echo.

REM First-run: install electron if node_modules missing
if not exist "node_modules\electron\package.json" (
    echo [setup] node_modules not found, running npm install...
    call npm install
    if errorlevel 1 (
        echo.
        echo [error] npm install failed. Make sure Node.js is installed and on PATH.
        pause
        exit /b 1
    )
    echo.
)

echo [run] launching Electron...
echo Tip: press numpad . to start/stop dictation. Close this window or kill Electron to quit.
echo.

call npm start
if errorlevel 1 (
    echo.
    echo [error] npm start failed. See output above.
    pause
    exit /b 1
)

endlocal
