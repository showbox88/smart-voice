@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   OpenWhispr Lite
echo ============================================
echo.

REM --- Check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
    echo [error] Node.js not found on PATH.
    echo         Install Node 18+ from https://nodejs.org/ then run this again.
    pause
    exit /b 1
)

REM --- First run: deps + downloads ---
if not exist "node_modules\electron\package.json" goto :fresh_install
if not exist "node_modules\ffmpeg-static\ffmpeg.exe" goto :fresh_install
goto :check_assets

:fresh_install
echo [setup] First run — will install electron + ffmpeg-static
echo         then download whisper-server (~7MB) and base model (~142MB).
echo         Total ~330MB, takes 3-5 minutes depending on network.
echo.
call npm install
if errorlevel 1 (
    echo.
    echo [error] npm install failed. See messages above.
    pause
    exit /b 1
)
goto :launch

REM --- Subsequent runs: ensure downloaded assets still exist ---
:check_assets
if not exist "bin\whisper-server-win32-x64.exe" goto :run_setup
if not exist "models\ggml-base.bin" goto :run_setup
goto :launch

:run_setup
echo [setup] whisper binary or model missing, downloading...
call npm run setup
if errorlevel 1 (
    echo.
    echo [error] setup failed. See messages above.
    pause
    exit /b 1
)

:launch
echo.
echo [run] launching... press numpad . to start/stop dictation.
echo       Close this window or kill Electron in Task Manager to quit.
echo.
call npm start
if errorlevel 1 (
    echo.
    echo [error] npm start failed. See messages above.
    pause
    exit /b 1
)

endlocal
