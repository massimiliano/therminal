@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set GYP_MSVS_SPECTRE_MITIGATIONS=false
set GYP_MSVS_VERSION=2022
cd /d C:\Users\bianc\Desktop\progetti\therminal-2

echo === Rebuilding node-pty for Electron ===
call npx electron-rebuild -f -w node-pty
if errorlevel 1 (
    echo === node-pty rebuild FAILED ===
    exit /b 1
)

echo === Building Electron app ===
call npx electron-builder --win
if errorlevel 1 (
    echo === Build FAILED ===
    exit /b 1
)
echo === Build completed! Check dist\ folder ===
