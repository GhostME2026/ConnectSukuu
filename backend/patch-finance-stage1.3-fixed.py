#!/usr/bin/env python3
from pathlib import Path
import re

path = Path("src/controllers/finance.controller.js")
text = path.read_text()

# Patch createFeePlan: add schoolId to every FeePlanItem created in the nested
# Prisma create. This regex tolerates the minified/one-line formatting in the
# installed controller.
patterns = [
    (
        r"(items:\s*\{\s*create:\s*items\.map\(\(item,index\)=>\(\{)(?!schoolId:sid,)",
        r"\1schoolId:sid,"
    ),
]
changed = False
for pattern, replacement in patterns:
    new_text, count = re.subn(pattern, replacement, text, count=1)
    if count:
        text = new_text
        changed = True
        break

if not changed:
    raise SystemExit(
        "Could not locate the FeePlan item creation block. "
        "No changes were made."
    )

# Patch updateFeePlan if it recreates items and has not already been patched.
pattern2 = r"(items:\s*\{\s*deleteMany:\{\},\s*create:\s*items\.map\(\(item,index\)=>\(\{)(?!schoolId:sid,)"
text, count2 = re.subn(pattern2, r"\1schoolId:sid,", text, count=1)

path.write_text(text)
print("Finance Stage 1.3 fixed patch applied.")
if count2:
    print("FeePlan update item creation was also patched.")
