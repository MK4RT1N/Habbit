@echo off
echo Pruefe Python Installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [FEHLER] Python wurde nicht gefunden!
    echo Bitte installiere Python.
    pause
    exit /b
)

if not exist venv (
    echo Erstelle virtuelle Umgebung (venv)...
    python -m venv venv
)

echo Installiere/Update Pakete...
call venv\Scripts\activate.bat
pip install flask flask-sqlalchemy flask-login

echo Starte HabitFlow Server...
echo API und Datenbank sind aktiv.
python app.py
pause
