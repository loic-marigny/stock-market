"""Detect symbols whose history needs refreshing.

Used by CI to decide whether we should call the Cloudflare worker via
scripts/history.py. Mirrors the coverage rules implemented in
scripts/history.py (>= 1 year of data and last point <= 1 business day).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from history import DATA_TICKERS, MIN_YEARS, coverage_ok, load_existing  # type: ignore


def iter_symbols() -> Iterable[str]:
    data = json.loads(DATA_TICKERS.read_text(encoding="utf-8-sig"))
    for entry in data:
        if not isinstance(entry, dict):
            continue
        sym = str(entry.get("symbol") or "").strip()
        if sym:
            yield sym


def main() -> int:
    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=365 * MIN_YEARS)).isoformat()
    missing: list[str] = []
    for symbol in sorted(set(iter_symbols())):
        existing = load_existing(symbol)
        if not coverage_ok(existing, cutoff):
            missing.append(symbol)
    if missing:
        print(",".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
