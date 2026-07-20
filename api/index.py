"""Vercel serverless entry — exposes Flask `app`."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

from app import create_app  # noqa: E402

app = create_app()
