"""Legacy helper: convert raw Yahoo chart payloads after manual copy/paste.

We keep this script in legacy because normal history refresh now goes through
scripts/history.py and the Cloudflare worker. Use it only if you captured a
chart payload (e.g. via browser devtools) and need to produce the simplified
[{"date", "close"}] JSON locally.
"""
"""Convert raw Yahoo Finance chart payloads to our history format.

Usage examples:
  python scripts/yahoo_payload_to_series.py --input raw_gspc.json
  python scripts/yahoo_payload_to_series.py --dir tmp_payloads
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "history"
RAW_PAYLOAD_DIR = ROOT / "scripts" / "yahoo_payloads"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert Yahoo chart payloads to simple OHLC series")
    parser.add_argument("--input", type=Path, help="Single Yahoo payload JSON file")
    parser.add_argument("--dir", type=Path, help=f"Process every *.json file in this directory (default: {RAW_PAYLOAD_DIR})")
    parser.add_argument("--symbol", help="Override symbol (otherwise taken from payload)")
    parser.add_argument("--remove-raw", action="store_true", help="Delete source file after conversion")
    parser.add_argument("--indent", type=int, default=2, help="Indent when writing JSON (default: 2)")
    return parser.parse_args()


def utc_date(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


def load_payload(path: Path) -> dict:
    try:
        raw = path.read_bytes()
        if not raw.strip():
            raise RuntimeError('file empty')
        text = raw.decode('utf-8-sig').strip()
        if text.startswith('var '):
            idx = text.find('=')
            if idx != -1:
                text = text[idx + 1:].strip()
                if text.endswith(';'):
                    text = text[:-1].strip()
        if not text or text[0] not in '{[':
            raise RuntimeError('payload does not look like JSON: ' + text[:20])
        return json.loads(text)
    except Exception as exc:
        raise RuntimeError(f"failed to read {path}: {exc}") from exc


def extract_series(payload: dict, fallback_symbol: str | None = None) -> tuple[str, list[dict[str, float | str]]]:
    chart = payload.get("chart") or {}
    results = chart.get("result") or []
    if not results:
        raise RuntimeError("payload missing chart.result")
    block = results[0]

    meta = block.get("meta") or {}
    symbol = fallback_symbol or meta.get("symbol")
    if not symbol:
        raise RuntimeError("symbol not found in payload; use --symbol to override")

    timestamps = block.get("timestamp") or []
    quote = ((block.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []

    if not timestamps or not closes:
        raise RuntimeError("payload missing timestamp/close arrays")

    out: list[dict[str, float | str]] = []
    for ts, close in zip(timestamps, closes):
        if ts is None or close is None:
            continue
        out.append({"date": utc_date(int(ts)), "close": float(close)})

    if not out:
        raise RuntimeError("no usable data points")

    out.sort(key=lambda item: item["date"])
    return symbol, out


def write_series(symbol: str, series: Iterable[dict[str, float | str]], indent: int) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{symbol}.json"
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(list(series), handle, indent=indent)
    return out_path


def iter_sources(args: argparse.Namespace) -> Iterable[Path]:
    if args.input:
        yield args.input
    if args.dir:
        for path in sorted(Path(args.dir).glob("*.json")):
            yield path


def main() -> int:
    args = parse_args()
    sources = list(iter_sources(args))
    if not sources and RAW_PAYLOAD_DIR.exists():
        sources = sorted(RAW_PAYLOAD_DIR.glob("*.json"))
    if not sources:
        print("No input provided. Use --input/--dir or drop files into scripts/yahoo_payloads.", file=sys.stderr)
        return 1

    status = 0
    for src in sources:
        try:
            payload = load_payload(src)
            symbol, series = extract_series(payload, fallback_symbol=args.symbol)
            out_path = write_series(symbol, series, args.indent)
            print(f"[ok] {src.name} -> {out_path} ({len(series)} points)")
            if args.remove_raw:
                src.unlink(missing_ok=True)
        except Exception as exc:
            print(f"[error] {src}: {exc}", file=sys.stderr)
            status = 1
    return status


if __name__ == "__main__":
    raise SystemExit(main())

