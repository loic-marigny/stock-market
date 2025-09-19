"""
Generate/ensure daily history JSON for US tickers via Finnhub /stock/candle.

Guarantees at least the last 1 year of daily closes is present. If a file
already exists, it loads and checks coverage; if incomplete, it fetches
the missing range (implemented by refetching the last 1y and merging),
then writes to public/history/{SYMBOL}.json as an array of
{date: YYYY-MM-DD, close: number} sorted ascending.

Requires FINNHUB_API_KEY (or FINNHUB_TOKEN) env var.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Dict

import requests

TICKERS = ["AAPL", "MSFT", "AMZN", "GOOGL", "NVDA", "TSLA"]
MIN_YEARS = 1  # ensure at least this coverage

SESSION = requests.Session()
SESSION.headers["User-Agent"] = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

OUT_DIR = Path("public/history")


def to_iso_utc(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


def fetch_daily(symbol: str, token: str, years: int = MIN_YEARS) -> List[Dict[str, float]]:
    now = int(time.time())
    start = now - int(365 * 24 * 3600 * years)
    url = "https://finnhub.io/api/v1/stock/candle"
    params = {
        "symbol": symbol,
        "resolution": "D",
        "from": start,
        "to": now,
        "token": token,
    }
    print(f"[history] {symbol} GET {url} res=D from={start} to={now}")
    r = SESSION.get(url, params=params, timeout=20)
    print(f"[history] {symbol} status={r.status_code}")
    r.raise_for_status()
    j = r.json()
    if not isinstance(j, dict) or j.get("s") != "ok":
        raise RuntimeError(f"history fetch failed for {symbol}: {j}")
    closes = j.get("c") or []
    ts = j.get("t") or []
    if not closes or not ts or len(closes) != len(ts):
        raise RuntimeError(f"history payload invalid for {symbol}: lens c={len(closes)} t={len(ts)}")
    out = [{"date": to_iso_utc(t), "close": float(c)} for t, c in zip(ts, closes)]
    # ensure ascending order by date
    out.sort(key=lambda x: x["date"])  # already ascending, but be safe
    return out


def load_existing(sym: str) -> List[Dict[str, float]]:
    p = OUT_DIR / f"{sym}.json"
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except Exception:
        return []


def coverage_ok(data: List[Dict[str, float]], min_from_date: str) -> bool:
    if not data:
        return False
    data.sort(key=lambda x: x["date"])  # ensure sorted
    first = data[0]["date"]
    last = data[-1]["date"]
    # need at least ~200 points and first date <= min_from_date
    try:
        today = datetime.now(timezone.utc).date()
        last_d = datetime.fromisoformat(last).date()
        gap = (today - last_d).days
    except Exception:
        gap = 999
    return len(data) >= 200 and first <= min_from_date and gap <= 3


def merge_history(old: List[Dict[str, float]], new: List[Dict[str, float]]) -> List[Dict[str, float]]:
    m: Dict[str, float] = {}
    for arr in (old, new):
        for it in arr or []:
            d = it.get("date")
            c = it.get("close")
            if isinstance(d, str) and isinstance(c, (int, float)):
                m[d] = float(c)
    out = [{"date": d, "close": m[d]} for d in sorted(m.keys())]
    return out


def main():
    token = os.environ.get("FINNHUB_API_KEY") or os.environ.get("FINNHUB_TOKEN")
    if not token:
        raise SystemExit("FINNHUB_API_KEY/FINNHUB_TOKEN is required for history generation")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for sym in TICKERS:
        try:
            existing = load_existing(sym)
            cutoff = (datetime.now(timezone.utc).date() - timedelta(days=365)).isoformat()
            if coverage_ok(existing, cutoff):
                print(f"[history] {sym} already has >=1y coverage; skip fetch (len={len(existing)})")
                continue
            fresh = fetch_daily(sym, token, years=MIN_YEARS)
            merged = merge_history(existing, fresh)
            out_path = OUT_DIR / f"{sym}.json"
            with open(out_path, "w") as f:
                json.dump(merged, f)
            print("[ok] wrote", out_path, f"len={len(merged)}")
        except Exception as e:
            print(f"[warn] {sym} history failed: {e}")


if __name__ == "__main__":
    main()
