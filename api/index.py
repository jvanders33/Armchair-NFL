"""Vercel entrypoint — the Python runtime serves api/index.py; all non-static
routes are rewritten here (see vercel.json) and FastAPI sees the original path."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import app  # noqa: E402,F401
