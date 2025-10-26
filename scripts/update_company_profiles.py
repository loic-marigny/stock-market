"""
Fetch extended company profile data from the Yahoo worker and update
public/companies/{SYMBOL}/profile.json with additional analytics fields.

Requires:
  - data/tickers.json as the source of symbols (including market codes)
  - YAHOO_WORKER_URL environment variable pointing to the Cloudflare worker
  - Optional YAHOO_WORKER_TOKEN for authenticated access

Only the requested fields are updated; existing keys are preserved.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Iterable
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_TICKERS = ROOT / "data" / "tickers.json"
PUBLIC_COMPANIES = ROOT / "public" / "companies"

WORKER_URL = os.environ.get("YAHOO_WORKER_URL", "").strip()
WORKER_TOKEN = os.environ.get("YAHOO_WORKER_TOKEN", "").strip()

SESSION = requests.Session()
SESSION.headers["User-Agent"] = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

SUMMARY_FIELDS = (
    "longName",
    "longBusinessSummary",
    "website",
    "irWebsite",
    "industryDisp",
    "beta",
    "recommendationMean",
    "auditRisk",
)


def load_tickers() -> Iterable[Dict[str, Any]]:
    with open(DATA_TICKERS, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, list):
        raise SystemExit("data/tickers.json must be an array")
    for item in payload:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        yield {
            "symbol": symbol,
            "market": str(item.get("market") or "").strip().upper(),
            "name": str(item.get("name") or "").strip(),
            "sector": str(item.get("sector") or "").strip(),
        }


def map_symbol_for_market(symbol: str, market: str) -> str:
    if market in {"FX", "FOREX"} and not symbol.endswith("=X"):
        return f"{symbol}=X"
    return symbol


def fetch_summary(symbol: str, market: str) -> Dict[str, Any] | None:
    if not WORKER_URL:
        raise SystemExit("Missing YAHOO_WORKER_URL environment variable.")

    mapped = map_symbol_for_market(symbol, market)
    url = f"{WORKER_URL.rstrip('/')}/summary/{quote(mapped, safe='=')}"
    headers = {"Accept": "application/json"}
    if WORKER_TOKEN:
        headers["x-worker-token"] = WORKER_TOKEN

    print(f"[summary] GET {url}")
    response = SESSION.get(url, headers=headers, timeout=20)
    print(f"[summary] {symbol} status={response.status_code}")

    if response.status_code == 404:
        print(f"[warn] {symbol}: summary unavailable (404)")
        return None
    response.raise_for_status()

    try:
        data = response.json()
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] {symbol}: failed to decode JSON ({exc})")
        return None

    if not isinstance(data, dict):
        print(f"[warn] {symbol}: unexpected payload type {type(data)}")
        return None
    return data


def update_profile(symbol: str, base: Dict[str, Any], summary: Dict[str, Any] | None) -> None:
    folder = PUBLIC_COMPANIES / symbol
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "profile.json"

    existing: Dict[str, Any]
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(existing, dict):
                existing = {}
        except Exception:  # noqa: BLE001
            existing = {}
    else:
        existing = {}

    # Always keep core identity fields in sync with tickers.json
    existing["symbol"] = symbol
    if base.get("name"):
        existing["name"] = base["name"]
    if base.get("sector"):
        existing["sector"] = base["sector"]

    if summary:
        for key in SUMMARY_FIELDS:
            value = summary.get(key)
            if value is not None:
                existing[key] = value

    path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    print(f"[ok] updated {path}")


def main() -> None:
    for entry in load_tickers():
        symbol = entry["symbol"]
        market = entry["market"]
        try:
            summary = fetch_summary(symbol, market)
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] {symbol}: fetch failed ({exc})")
            continue
        update_profile(symbol, entry, summary)
        time.sleep(0.5)


if __name__ == "__main__":
    main()
