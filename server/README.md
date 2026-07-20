# Shree's Extractions — Flask server

Python/Flask rewrite of the PHP site. Reuses existing `assets/`, `uploads/`, and MySQL database `shrees_extractions`. All routes are mounted under `/Extract` so existing JS/CSS keep working.

## Requirements

- Python 3.10+
- MySQL with database `shrees_extractions` (same schema as `database/shrees_extractions.sql`)
- XAMPP MySQL running (default: user `root`, empty password)

## Install

From `C:\xampp\htdocs` (avoids apostrophe path issues in some shells):

```bat
cd /d C:\xampp\htdocs
python -m pip install -r "Shree's Extractions\requirements.txt"
```

## Run

```bat
cd /d C:\xampp\htdocs
python "Shree's Extractions\server\run.py"
```

Server listens on `http://127.0.0.1:5000`.

- Home: http://127.0.0.1:5000/Extract/
- Login: http://127.0.0.1:5000/Extract/app/login.php
- Upload: http://127.0.0.1:5000/Extract/app/

## Notes

- This is the only app runtime now (PHP was removed).
- Session cookies and `se_visitor` cookie power login + unlock access.
- Config: `server/app/config.py`
- Change `SECRET_KEY` before any public hosting.
