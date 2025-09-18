"""
Generate quotes.json using an official provider (Finnhub) only.

Removes all Yahoo/yfinance code due to frequent rate-limiting on shared
GitHub Actions runners. The script preserves previous values and never writes
null fields.
"""

from __future__ import annotations

import json
import os
import time
import random
from pathlib import Path
from datetime import datetime, timezone
import requests

TICKERS = ["AAPL", "MSFT", "AMZN", "GOOGL", "NVDA", "TSLA"]

DATA_DIR = Path("data")
OUT = DATA_DIR / "quotes.json"

# HTTP session with explicit User-Agent
SESSION = requests.Session()
SESSION.headers["User-Agent"] = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def finnhub_last(symbol: str, api_key: str):
    """Fetch last price using Finnhub's official /quote endpoint.

    Requires FINNHUB_API_KEY (or FINNHUB_TOKEN).
    Returns (price: float, as_of_iso_utc: str, source: str) or (None, None, None).
    """
    base = "https://finnhub.io/api/v1/quote"
    params = {"symbol": symbol, "token": api_key}
    try:
        print(f"[finnhub] {symbol} GET {base} symbol={params['symbol']}")
        r = SESSION.get(base, params=params, timeout=15)
        print(f"[finnhub] {symbol} status={r.status_code}")
        # Try to parse JSON regardless of status for clearer diagnostics
        j = None
        try:
            j = r.json()
        except Exception:
            j = None
        if r.status_code >= 400:
            print(f"[finnhub] {symbol} error-body={j}")
            r.raise_for_status()
        if not isinstance(j, dict):
            print(f"[finnhub] {symbol} non-json response")
            return None, None, None
        c = j.get("c")  # current price
        t = j.get("t")  # epoch seconds
        if c in (None, 0) or not t:
            print(f"[finnhub] {symbol} empty/invalid payload: {j}")
            return None, None, None
        dt = datetime.fromtimestamp(int(t), tz=timezone.utc)
        iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        print(f"[finnhub] {symbol} last={c} @ {iso}")
        return float(c), iso, "finnhub"
    except Exception as e:
        print(f"[warn] finnhub {symbol} failed: {e}")
        return None, None, None



def load_previous():
    if OUT.exists():
        try:
            with open(OUT, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    api_key = os.environ.get("FINNHUB_API_KEY") or os.environ.get("FINNHUB_TOKEN")
    if not api_key:
        print("[error] FINNHUB_API_KEY/FINNHUB_TOKEN not set; cannot fetch official data.")
    had_prev = OUT.exists()
    prev = load_previous()
    print(f"[main] start; had_prev={had_prev}; prev_keys={list(prev.keys())}")
    out: dict = {}
    changed = False

    for s in TICKERS:
        if not api_key:
            print(f"[warn] {s}: no API key; cannot update")
            continue
        print(f"[main] {s} - try finnhub")
        px, ts, src = finnhub_last(s, api_key)

        if px is None:
            old = prev.get(s) or {}
            if old.get("last") is not None:
                print(f"[warn] {s}: no fresh data; keeping previous {old.get('last')} @ {old.get('as_of')}")
                new_entry = {"last": float(old.get("last")), "as_of": old.get("as_of"), "interval": old.get("interval")}
                out[s] = new_entry
                continue
            else:
                print(f"[warn] {s}: no data and no previous; leaving unchanged")
                continue

        new_entry = {"last": float(px), "as_of": ts, "interval": src}
        if prev.get(s) != new_entry:
            changed = True
        out[s] = new_entry

        # Small sleep to avoid bursts (provider friendliness)
        time.sleep(0.2 + random.uniform(0, 0.2))

    if not changed:
        if had_prev:
            print("[ok] no changes; preserving previous file")
            return
        else:
            raise SystemExit("no data fetched and no previous file; aborting")

    out["meta"] = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "finnhub /quote",
        "note": "Official provider only; never writes nulls; preserves previous values if unavailable."
    }

    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    print("[ok] wrote", OUT)


if __name__ == "__main__":
    main()
