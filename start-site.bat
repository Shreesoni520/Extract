@echo off
title Shree's Extractions
cd /d "C:\xampp\htdocs"

echo.
echo  Shree's Extractions
echo  ------------------
echo  1. Make sure MySQL is running in XAMPP
echo  2. Keep this window open
echo  3. Site URL:
echo.
echo     http://127.0.0.1:5000/Extract/
echo.
echo  Tip: Sign up TWO accounts to test Find people + upload.
echo       Searching your own username will not show you.
echo.

start "" "http://127.0.0.1:5000/Extract/"
python "Shree's Extractions\server\run.py"
pause
