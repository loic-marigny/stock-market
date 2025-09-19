"""
Build public/companies/index.json from data/tickers.json and ensure per-company folders.

For each ticker in data/tickers.json:
- Ensure public/companies/{SYMBOL}/ exists
- Create a minimal profile.json if missing (symbol, name, sector)
- Do not overwrite existing profiles (to avoid noisy commits)

Writes public/companies/index.json listing basic info and relative paths
to profile, logo (if present), and history.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Any, List

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PUBLIC = ROOT / "public"
COMP_DIR = PUBLIC / "companies"
HIST_DIR = PUBLIC / "history"


def load_tickers() -> List[Dict[str, Any]]:
    p = DATA / "tickers.json"
    with open(p, "r", encoding="utf-8") as f:
        arr = json.load(f)
    if not isinstance(arr, list):
        raise SystemExit("data/tickers.json must be a list")
    out: List[Dict[str, Any]] = []
    for it in arr:
        if not isinstance(it, dict):
            continue
        sym = str(it.get("symbol", "")).strip().upper()
        name = str(it.get("name", "")).strip()
        sector = str(it.get("sector", "")).strip()
        if not sym:
            continue
        out.append({"symbol": sym, "name": name, "sector": sector})
    return out


def ensure_profile(sym: str, name: str, sector: str) -> None:
    d = COMP_DIR / sym
    d.mkdir(parents=True, exist_ok=True)
    prof = d / "profile.json"
    if prof.exists():
        return
    with open(prof, "w", encoding="utf-8") as f:
        json.dump({"symbol": sym, "name": name, "sector": sector}, f, indent=2)


def build_index(rows: List[Dict[str, Any]]) -> None:
    COMP_DIR.mkdir(parents=True, exist_ok=True)
    idx: List[Dict[str, Any]] = []
    for it in rows:
        sym = it["symbol"]
        name = it.get("name")
        sector = it.get("sector")
        ensure_profile(sym, name, sector)
        logo_rel = f"companies/{sym}/logo.svg"
        logo_path = COMP_DIR / sym / "logo.svg"
        idx.append({
            "symbol": sym,
            "name": name,
            "sector": sector,
            "profile": f"companies/{sym}/profile.json",
            "logo": (logo_rel if logo_path.exists() else None),
            "history": f"history/{sym}.json",
        })
    with open(COMP_DIR / "index.json", "w", encoding="utf-8") as f:
        json.dump(idx, f, indent=2)
    print("[ok] wrote", COMP_DIR / "index.json", "entries=", len(idx))


def main():
    rows = load_tickers()
    build_index(rows)


if __name__ == "__main__":
    main()

