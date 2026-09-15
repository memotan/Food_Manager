@echo off
REM === Food Manager - Capacitor setup for Windows ===
REM Requires: Node.js 22+, JDK 17+, Android Studio

echo === Food Manager Capacitor Setup ===
echo.

echo [1/4] Installing dependencies...
call npm install || goto :error
echo.

echo [2/4] Copying web assets from repository root...
call npm run copy || goto :error
echo.

echo [3/4] Adding Android platform...
call npx cap add android || goto :error
echo.

echo [4/4] Syncing...
call npx cap sync || goto :error
echo.

echo === Setup complete ===
echo Run "npm run open" to open the project in Android Studio.
pause
exit /b 0

:error
echo.
echo *** Setup failed. See the message above. ***
pause
exit /b 1
