"""Legacy helper: direct Yahoo Finance fetcher kept for manual local recovery.

This script bypasses our Cloudflare worker and hits query1/2/3.finance.yahoo.com
from a developer machine. It is archived because the production pipeline now
relies on scripts/history.py (worker + Finnhub fallback). Use it only for
one-off troubleshooting when you need to grab a payload manually.
"""
"""Quick Yahoo Finance fetcher for selected symbols.

Usage:
  python scripts/fetch_yahoo.py --symbols "^GSPC,^AEX" [--range 1y] [--interval 1d]

Writes normalized daily closes into public/history/{SYMBOL}.json.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "history"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
Y_HOSTS: tuple[str, ...] = (
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com",
    "query3.finance.yahoo.com",
)
SESSION = requests.Session()
SESSION.headers["User-Agent"] = USER_AGENT


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch daily closes from Yahoo Finance")
    parser.add_argument(
        "--symbols",
        required=True,
        help="Comma-separated list of ticker symbols (e.g. ^GSPC,^AEX)"
    )
    parser.add_argument("--range", default="1y", help="Yahoo range parameter (default: 1y)")
    parser.add_argument("--interval", default="1d", help="Yahoo interval parameter (default: 1d)")
    parser.add_argument(
        "--sleep",
        type=float,
        default=1.5,
        help="Seconds to wait between symbols (default: 1.5)",
    )
    return parser.parse_args()


def iso_date(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


def fetch_symbol(symbol: str, rng: str, interval: str) -> list[dict[str, float | str]]:
    encoded = quote(symbol, safe="")
    params = {"range": rng, "interval": interval}
    last_err: Exception | None = None
    for host in Y_HOSTS:
        url = f"https://{host}/v8/finance/chart/{encoded}"
        for attempt in range(1, 5):
            try:
                print(f"[yahoo] {symbol} host={host} try#{attempt}")
                res = SESSION.get(url, params=params, timeout=20)
                if res.status_code == 429:
                    wait = 1.5 * attempt + 0.75
                    print(f"[yahoo] {symbol} 429 -> wait {wait:.1f}s")
                    time.sleep(wait)
                    continue
                res.raise_for_status()
                data = res.json()
                result = (data.get("chart") or {}).get("result") or []
                if not result:
                    raise RuntimeError("empty result")
                block = result[0]
                timestamps = block.get("timestamp") or []
                quote_block = ((block.get("indicators") or {}).get("quote") or [{}])[0]
                closes = quote_block.get("close") or []
                out: list[dict[str, float | str]] = []
                for ts, close in zip(timestamps, closes):
                    if ts is None or close is None:
                        continue
                    out.append({"date": iso_date(int(ts)), "close": float(close)})
                if not out:
                    raise RuntimeError("no closes returned")
                out.sort(key=lambda x: x["date"])  # chronological
                return out
            except Exception as err:  # pylint: disable=broad-except
                last_err = err
                backoff = min(6.0 * attempt, 12.0)
                print(f"[warn] {symbol} host={host} attempt={attempt} failed: {err}; wait {backoff:.1f}s")
                time.sleep(backoff)
                continue
    raise RuntimeError(f"Yahoo fetch failed for {symbol}: {last_err}")


def save_series(symbol: str, series: Iterable[dict[str, float | str]]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{symbol}.json"
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(list(series), handle, indent=2)
    print(f"[ok] wrote {out_path}")


def main() -> int:
    args = parse_args()
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    if not symbols:
        print("No symbols provided after parsing.", file=sys.stderr)
        return 1

    for idx, symbol in enumerate(symbols, start=1):
        try:
            print(f"[fetch] ({idx}/{len(symbols)}) {symbol}")
            series = fetch_symbol(symbol, args.range, args.interval)
            save_series(symbol, series)
        except Exception as err:  # pylint: disable=broad-except
            print(f"[error] {symbol}: {err}", file=sys.stderr)
        if idx < len(symbols) and args.sleep > 0:
            time.sleep(args.sleep)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

