#!/usr/bin/env python3
"""Atomically move one tracking entry from an open file to the matching closed file.

Usage: close-entry.py PR 3604 "integrated" "commit abc123; tests: vitest unit/foo"

Reads the `## PR #N` (or `## Issue #N`) section from the open file, appends a
disposition block, writes it to the closed file, and removes it from the open
file. Refuses when the ID is missing from open, already in closed, or when the
section heading cannot be located unambiguously.
"""

import sys, re, tempfile, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KINDS = {"PR": ("upstream-prs", "pull"), "Issue": ("upstream-issues", "issues")}


def split_entries(text: str):
    """Return (preamble, list of entry strings) splitting on '## ' headings."""
    # Preamble ends at a "---" line; tolerate it glued to the first heading
    # ("---## PR #N") as older seeds wrote it.
    m = re.search(r"^---(?:\s*$|(?=## (?:PR|Issue) #))", text, re.M)
    if not m:
        return text, []
    head, body = text[: m.end()], text[m.end() :]
    parts = re.split(r"^(?=## (?:PR|Issue) #\d+)", body, flags=re.M)
    return head, [p for p in parts if p.startswith("## ")]


def main() -> int:
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    kind, num, disposition, detail = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
    if kind not in KINDS:
        print(f"unknown kind {kind!r}; use PR or Issue", file=sys.stderr)
        return 2
    stem, urlbase = KINDS[kind]
    open_f = ROOT / "tracking" / f"{stem}-open.md"
    closed_f = ROOT / "tracking" / f"{stem}-closed.md"
    marker = f"## {kind} #{num}"

    open_text = open_f.read_text()
    closed_text = closed_f.read_text()

    if re.search(rf"^{re.escape(marker)}\b", closed_text, re.M):
        print(f"FAIL: {marker} already in closed file", file=sys.stderr)
        return 1
    head, entries = split_entries(open_text)
    hits = [e for e in entries if re.match(rf"^{re.escape(marker)} —", e)]
    if len(hits) != 1:
        print(f"FAIL: expected exactly 1 {marker} entry in open file, found {len(hits)}", file=sys.stderr)
        return 1
    entry = hits[0]
    if "local-status: in-progress" in entry and disposition not in ("integrated", "closed", "resolved"):
        pass  # allowed: closing an in-progress entry is the normal end state

    entry = entry.rstrip() + (
        f"\n- final-disposition: {disposition}\n"
        f"- closed: {__import__('datetime').date.today().isoformat()}\n"
        f"- detail: {detail}\n\n"
    )
    new_open = head + "".join(e for e in entries if e is not entry)
    new_closed = closed_text.rstrip() + "\n\n" + entry

    for path, content in ((open_f, new_open), (closed_f, new_closed)):
        fd, tmp = tempfile.mkstemp(dir=str(path.parent))
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, "w") as f:
            f.write(content)
        os.replace(tmp, path)

    print(f"moved {marker} -> closed (disposition: {disposition})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
