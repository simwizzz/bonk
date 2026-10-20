@echo off
python "%~dp0serve_local.py" --port 8765 --open
if errorlevel 1 pause
