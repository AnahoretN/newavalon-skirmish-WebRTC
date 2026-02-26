@echo off
REM Kill any existing node processes on port 8822
echo Stopping any existing server on port 8822...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8822 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

REM Wait a moment for port to be released
timeout /t 2 /nobreak >nul

REM Start the dev server
echo.
echo Starting development server...
echo.
npm run dev
