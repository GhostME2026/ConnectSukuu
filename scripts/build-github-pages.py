#!/usr/bin/env python3
"""Build a GitHub Pages copy while leaving source files unchanged for Vercel."""
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "_site"
SKIP_DIRS = {".git", "node_modules", "_site", ".vercel"}
SKIP_FILES = {".env", ".env.production", ".env.local"}

if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir(parents=True)

for src in ROOT.rglob("*"):
    rel = src.relative_to(ROOT)
    if any(part in SKIP_DIRS for part in rel.parts):
        continue
    if src.is_dir():
        continue
    if src.name in SKIP_FILES or src.name.startswith(".env."):
        continue
    if rel.parts[:2] == (".github", "workflows"):
        continue
    dest = OUT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = src.read_bytes()
    if src.suffix.lower() in {".html", ".css", ".js", ".json", ".webmanifest"}:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            dest.write_bytes(data)
            continue
        # Prefix known frontend paths for the /ConnectSukuu/ project site.
        # API paths such as /api/... remain unchanged.
        text = re.sub(
            r'(?<![A-Za-z0-9:])/(assets|auth|public-pages|roles|super-admin)(?=/)',
            r'/ConnectSukuu/\1',
            text
        )
        text = re.sub(
            r'(?<![A-Za-z0-9:])/index\.html(?=([?#\s"\'\)<>]|$))',
            r'/ConnectSukuu/index.html',
            text
        )
        data = text.encode("utf-8")
    dest.write_bytes(data)

print(f"Built GitHub Pages site at {OUT}")
