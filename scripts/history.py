"""
Generate daily history JSON files for selected US tickers using Finnhub /stock/candle.

Writes to public/history/{SYMBOL}.json as an array of {date, close} sorted ascending.
Relies on FINNHUB_API_KEY (or FINNHUB_TOKEN) environment variable.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict

import requests

TICKERS = ["AAPL", "MSFT", "AMZN", "GOOGL", "NVDA", "TSLA"]

SESSION = requests.Session()
SESSION.headers["User-Agent"] = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

OUT_DIR = Path("public/history")


def to_iso_utc(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


def fetch_daily(symbol: str, token: str, years: int = 5) -> List[Dict[str, float]]:
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


def main():
    token = os.environ.get("FINNHUB_API_KEY") or os.environ.get("FINNHUB_TOKEN")
    if not token:
        raise SystemExit("FINNHUB_API_KEY/FINNHUB_TOKEN is required for history generation")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for sym in TICKERS:
        try:
            data = fetch_daily(sym, token)
            out_path = OUT_DIR / f"{sym}.json"
            with open(out_path, "w") as f:
                json.dump(data, f)
            print("[ok] wrote", out_path)
        except Exception as e:
            print(f"[warn] {sym} history failed: {e}")


if __name__ == "__main__":
    main()

