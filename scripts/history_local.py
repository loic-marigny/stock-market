"""Local-only helper to refresh daily history JSON using yfinance.

This script requires direct access to Yahoo Finance and must be run from
a developer machine. Do NOT add it to CI/GitHub workflows.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Iterable

import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
DATA_TICKERS = ROOT / "data" / "tickers.json"
OUT_DIR = ROOT / "public" / "history"


def load_symbols(selected: str | None) -> list[str]:
    if selected:
        return [s.strip() for s in selected.split(',') if s.strip()]
    data = json.loads(DATA_TICKERS.read_text(encoding="utf-8-sig"))
    symbols: list[str] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        sym = str(entry.get("symbol") or "").strip()
        if sym:
            symbols.append(sym)
    return sorted(set(symbols))


def fetch_series(symbol: str, years: int) -> list[dict[str, float]]:
    period_years = max(int(years), 1)
    period = "max" if period_years > 10 else f"{period_years}y"
    df = yf.Ticker(symbol).history(period=period, interval="1d", auto_adjust=False)
    if df.empty:
        return []
    df = df.dropna(subset=["Close"])
    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=365 * years)).isoformat() if years > 0 else None
    out: list[dict[str, float]] = []
    for index, close in df["Close"].items():
        try:
            dt = index.to_pydatetime()
        except AttributeError:
            dt = datetime.fromtimestamp(float(index), tz=timezone.utc)
        out.append({"date": dt.date().isoformat(), "close": float(close)})
    out.sort(key=lambda item: item["date"])
    if cutoff:
        out = [item for item in out if item["date"] >= cutoff]
    return out


def save_series(symbol: str, series: Iterable[dict[str, float | str]]) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{symbol}.json"
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(list(series), handle, indent=2)
    return out_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh history JSON locally using yfinance")
    parser.add_argument("--symbols", help="Comma separated list of symbols (default: all in data/tickers.json)")
    parser.add_argument("--years", type=int, default=1, help="How many trailing years to keep (default: 1)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    symbols = load_symbols(args.symbols)
    if not symbols:
        print("No symbols to process.")
        return 1
    for idx, symbol in enumerate(symbols, start=1):
        try:
            series = fetch_series(symbol, args.years)
            if not series:
                print(f"[warn] {symbol}: no data fetched")
                continue
            out_path = save_series(symbol, series)
            print(f"[ok] ({idx}/{len(symbols)}) {symbol} -> {out_path} ({len(series)} points)")
        except Exception as exc:  # pylint: disable=broad-except
            print(f"[error] {symbol}: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
