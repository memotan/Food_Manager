@echo off
REM === Food Manager - Capacitor setup for Windows ===
REM Requires: Node.js 22+, JDK 17+, Android Studio

echo === Food Manager Capacitor Setup ===
echo.

REM Gradle fails when the project path contains non-ASCII characters or spaces.
REM Check that first so the reason is obvious, instead of a confusing build error later.
echo [1/5] Checking the project path...
call node scripts\check-path.mjs || goto :error
echo.

echo [2/5] Installing dependencies...
call npm install || goto :error
echo.

echo [3/5] Copying web assets from repository root...
call npm run copy || goto :error
echo.

echo [4/5] Adding Android platform...
call npx cap add android || goto :error
echo.

echo [5/5] Syncing...
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
