@echo off
setlocal
cd /d "%~dp0"
set "GVS_HOST=http://127.0.0.1:8080"
if not defined GVS_KEY set /p "GVS_KEY=Gateway API key: "
echo GVS_HOST=%GVS_HOST%
echo Using Win11 local gateway - start gateway first with start-gateway.cmd
echo.
bun run dev