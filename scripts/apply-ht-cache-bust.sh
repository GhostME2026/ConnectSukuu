#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT" <<'PYCODE'
from pathlib import Path
import re, sys
root=Path(sys.argv[1])
base=root/'roles'/'headteacher'
if not base.is_dir():
    raise SystemExit('Could not find roles/headteacher. Extract the patch into your frontend project root first.')
replacements={
    'config.js': 'config.js?v=20261030-htfix1',
    'role-workspace.js': 'role-workspace.js?v=20261030-htfix1',
    'role-shell-extension.js': 'role-shell-extension.js?v=20261030-htfix1',
}
for page in base.glob('*.html'):
    text=page.read_text(encoding='utf-8')
    original=text
    for filename, versioned in replacements.items():
        pattern=r'(<script\s+src=["\'])/assets/js/'+re.escape(filename)+r'(?:\?[^"\']*)?(["\'])'
        text=re.sub(pattern, lambda m: m.group(1)+'/assets/js/'+versioned+m.group(2), text)
    if text != original:
        page.write_text(text,encoding='utf-8')
print('HT script cache references updated; all existing page markup and timeout script tags preserved.')
PYCODE
