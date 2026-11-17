@echo off
rem Manual LLM score update (docs/llm-scoring.md section 4). Double-click to run.
rem Options are passed through, e.g.:  <this file> --dry-run --limit 5
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

rem --- git: use PATH, else the default Git for Windows locations ---
where git >nul 2>nul
if not errorlevel 1 goto git_ok
if exist "%ProgramFiles%\Git\cmd\git.exe" goto git_pf
if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" goto git_local
echo [stop] git not found. Install Git for Windows.
goto end
:git_pf
set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
goto git_ok
:git_local
set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%PATH%"
:git_ok

rem --- python: py launcher first, then python ---
set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if defined PY goto py_ok
where python >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY goto py_ok
echo [stop] Python 3 not found. Install it from python.org.
goto end
:py_ok

%PY% scripts\local\run_scoring.py %*
set "RC=%errorlevel%"
echo.
echo exit code: %RC%

:end
pause
endlocal
