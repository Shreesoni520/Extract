"""Entry point for Shree's Extractions Flask server."""
from pathlib import Path
import sys

# Ensure server/ is on the path so `app` package imports work.
SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
