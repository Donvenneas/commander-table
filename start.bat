@echo off
title Commander Table
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*
pause
