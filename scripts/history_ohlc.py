"""
Generate/ensure daily OHLC history JSON for tickers via the Cloudflare Yahoo
proxy when available, falling back to Finnhub candle data and other providers.

Guarantees at least the last 1 year of daily candles is present. If a file
already exists, it loads and checks coverage; if incomplete, it fetches
the missing range (implemented by refetching the last 1y and merging),
then writes to public/history_ohlc/{SYMBOL}.json as an array of
{date: YYYY-MM-DD, open: number, high: number, low: number, close: number}
sorted ascending.

Requires FINNHUB_API_KEY (or FINNHUB_TOKEN) env var unless
YAHOO_WORKER_URL is configured.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Dict
import math
import pandas as pd
import akshare as ak
import csv
import random
import numpy as np
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_TICKERS = ROOT / "data" / "tickers.json"
MIN_YEARS = 1  # ensure at least this coverage

SESSION = requests.Session()
SESSION.headers["User-Agent"] = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


OUT_DIR = ROOT / "public" / "history_ohlc"


def to_iso_utc(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


def safe_float(value):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return f


def build_candle(date: str, open_val, high_val, low_val, close_val):
    if not isinstance(date, str):
        return None
    close_f = safe_float(close_val)
    if close_f is None:
        return None
    open_f = safe_float(open_val)
    high_f = safe_float(high_val)
    low_f = safe_float(low_val)
    if open_f is None:
        open_f = close_f
    if high_f is None:
        high_f = max(open_f, close_f)
    if low_f is None:
        low_f = min(open_f, close_f)
    high_f = max(high_f, open_f, close_f)
    low_f = min(low_f, open_f, close_f)
    if low_f > high_f:
        low_f, high_f = high_f, low_f
    return {"date": date, "open": open_f, "high": high_f, "low": low_f, "close": close_f}


def fetch_daily_finnhub(symbol: str, token: str, years: int = MIN_YEARS) -> List[Dict[str, float]]:
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
    opens = j.get("o") or []
    highs = j.get("h") or []
    lows = j.get("l") or []
    closes = j.get("c") or []
    ts = j.get("t") or []
    if not closes or not ts or len(closes) != len(ts):
        raise RuntimeError(
            f"history payload invalid for {symbol}: lens c={len(closes)} t={len(ts)}"
        )
    def pick(arr, idx):
        return arr[idx] if idx < len(arr) else None

    out = []
    for idx, t in enumerate(ts):
        candle = build_candle(
            to_iso_utc(t),
            pick(opens, idx),
            pick(highs, idx),
            pick(lows, idx),
            pick(closes, idx),
        )
        if candle:
            out.append(candle)
    out.sort(key=lambda x: x["date"])
    return out


def map_symbol_for_market(symbol: str, market: str) -> str:
    if market.upper() in {"FX", "FOREX"} and not symbol.endswith("=X"):
        return f"{symbol}=X"
    return symbol


def fetch_daily_worker(symbol: str, years: int = MIN_YEARS) -> List[Dict[str, float]]:
    """Fetch daily candles via Cloudflare Yahoo proxy if configured."""

    base_url = (os.environ.get("YAHOO_WORKER_URL") or "").strip()
    if not base_url:
        return []

    range_env = (os.environ.get("YAHOO_WORKER_RANGE") or "").strip()
    if range_env:
        range_value = range_env
    elif years <= 1:
        range_value = "1y"
    elif years <= 2:
        range_value = "2y"
    elif years <= 5:
        range_value = "5y"
    else:
        range_value = "10y"

    params = {"range": range_value, "interval": "1d"}
    encoded = quote(symbol, safe='=')
    url = f"{base_url.rstrip('/')}/history/{encoded}"

    headers: Dict[str, str] = {}
    token = (os.environ.get("YAHOO_WORKER_TOKEN") or "").strip()
    if token:
        headers["X-Worker-Token"] = token
    query_desc = "&".join(f"{k}={v}" for k, v in params.items())
    print(f"[history-worker] {symbol} GET {url}?{query_desc}")

    r = SESSION.get(url, params=params, headers=headers, timeout=20)
    print(f"[history-worker] {symbol} status={r.status_code}")
    if r.status_code == 404:
        return []
    r.raise_for_status()

    try:
        data = r.json()
    except Exception as exc:
        raise RuntimeError(f"worker payload not JSON for {symbol}: {exc}") from exc

    if not isinstance(data, list):
        raise RuntimeError(f"worker payload invalid for {symbol}: type={type(data)!r}")

    out: List[Dict[str, float]] = []
    for point in data:
        if not isinstance(point, dict):
            continue
        date = point.get("date")
        date_str = None
        if isinstance(date, str) and len(date) >= 4:
            date_str = date[:10]
        elif isinstance(date, (int, float)):
            try:
                date_str = to_iso_utc(int(date))
            except Exception:
                date_str = None
        candle = build_candle(
            date_str or str(date),
            point.get("open", point.get("o")),
            point.get("high", point.get("h")),
            point.get("low", point.get("l")),
            point.get("close", point.get("c")),
        )
        if candle:
            out.append(candle)

    out.sort(key=lambda x: x["date"])
    if not out:
        raise RuntimeError(f"worker payload empty for {symbol}")
    return out




def fetch_daily_alpha(symbol: str, api_key: str, years: int = MIN_YEARS) -> List[Dict[str, float]]:
    """Alpha Vantage TIME_SERIES_DAILY_ADJUSTED fallback.

    Free tier: 5 req/min, 500/day. We request 'full' then trim to last N years.
    """
    base = "https://www.alphavantage.co/query"
    params = {
        "function": "TIME_SERIES_DAILY_ADJUSTED",
        "symbol": symbol,
        "outputsize": "full",
        "apikey": api_key,
    }
    print(f"[history-av] {symbol} GET {base} function={params['function']}")
    r = SESSION.get(base, params=params, timeout=30)
    print(f"[history-av] {symbol} status={r.status_code}")
    r.raise_for_status()
    j = r.json()
    ts = j.get("Time Series (Daily)")
    if not isinstance(ts, dict):
        raise RuntimeError(f"alpha payload invalid for {symbol}: {list(j.keys())[:3]}")
    rows = []
    for d, v in ts.items():
        if not isinstance(v, dict):
            continue
        candle = build_candle(
            d,
            v.get("1. open"),
            v.get("2. high"),
            v.get("3. low"),
            v.get("5. adjusted close") or v.get("4. close"),
        )
        if candle:
            rows.append(candle)
    rows.sort(key=lambda x: x["date"])  # ascending
    # keep last N years only
    if rows:
        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=365 * years)).isoformat()
        rows = [x for x in rows if x["date"] >= cutoff]
    return rows


def fetch_daily_stooq(symbol: str, years: int = MIN_YEARS) -> List[Dict[str, float]]:
    """Stooq CSV fallback (no key). US tickers via *.us.

    Returns all available, trimmed to last N years.
    """
    sym = symbol.lower()
    # Stooq supports .us suffix for US tickers; not Shanghai/Shenzhen
    if "." in sym:
        suff = sym.rsplit(".", 1)[-1]
        if suff != "us":
            return []
        s = sym
    else:
        s = f"{sym}.us"
    url = f"https://stooq.com/q/d/l/?s={s}&i=d"
    print(f"[history-stooq] {symbol} GET {url}")
    r = SESSION.get(url, timeout=20)
    print(f"[history-stooq] {symbol} status={r.status_code}")
    r.raise_for_status()
    txt = r.text.strip()
    reader = csv.DictReader(txt.splitlines())
    rows = []
    for row in reader:
        d = row.get("Date") or row.get("date")
        candle = build_candle(
            d,
            row.get("Open") or row.get("open"),
            row.get("High") or row.get("high"),
            row.get("Low") or row.get("low"),
            row.get("Close") or row.get("close"),
        )
        if candle:
            rows.append(candle)
    rows.sort(key=lambda x: x["date"])
    if rows:
        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=365 * years)).isoformat()
        rows = [x for x in rows if x["date"] >= cutoff]
    return rows


    


def fetch_daily_alltick(symbol: str, api_key: str, years: int = MIN_YEARS) -> List[Dict[str, float]]:
    """Alltick daily history (CN) -- tries common kline endpoints, strips .SS.

    Note: Without official docs here, we attempt a reasonable default
    and parse common field shapes. If your endpoint differs, set
    ALLTICK_HISTORY_URL to override.
    """
    sym = symbol.split(".")[0]
    base_env = os.environ.get("ALLTICK_HISTORY_URL")
    candidates = [
        base_env,
        "https://api.alltick.co/market/kline",
        "https://api.alltick.co/kline",
    ]
    params = [
        {"symbol": sym, "interval": "1day", "limit": 5000, "apikey": api_key},
        {"symbol": sym, "interval": "1d", "limit": 5000, "apikey": api_key},
    ]
    for base in candidates:
        if not base:
            continue
        for p in params:
            try:
                print(f"[history-alltick] {symbol} GET {base} params={p}")
                r = SESSION.get(base, params=p, timeout=25)
                print(f"[history-alltick] {symbol} status={r.status_code}")
                r.raise_for_status()
                j = r.json()
                # Accept common shapes: {data:[...]}, directly list, or object
                arr = None
                if isinstance(j, list):
                    arr = j
                elif isinstance(j, dict):
                    # try several keys
                    for k in ("data", "kline", "values", "result"):
                        v = j.get(k)
                        if isinstance(v, list):
                            arr = v
                            break
                if not isinstance(arr, list):
                    continue
                out: List[Dict[str, float]] = []
                for it in arr:
                    if not isinstance(it, (list, dict)):
                        continue
                    # Try dict first
                    dts = None
                    open_v = None
                    high_v = None
                    low_v = None
                    close_v = None
                    if isinstance(it, dict):
                        # common: t/time/datetime, c/close/last
                        dts = it.get("datetime") or it.get("time") or it.get("t") or it.get("date")
                        open_v = it.get("open") or it.get("o")
                        high_v = it.get("high") or it.get("h")
                        low_v = it.get("low") or it.get("l")
                        close_v = it.get("close") or it.get("c") or it.get("last") or it.get("price")
                    else:
                        # If list, assume [ts, open, high, low, close, ...]
                        try:
                            ts_val = it[0]
                            open_v = it[1] if len(it) > 1 else None
                            high_v = it[2] if len(it) > 2 else None
                            low_v = it[3] if len(it) > 3 else None
                            close_v = it[4] if len(it) > 4 else None
                            if isinstance(ts_val, (int, float)):
                                dts = to_iso_utc(int(ts_val))
                            else:
                                dts = str(ts_val)
                        except Exception:
                            pass
                    if close_v is None or dts is None:
                        continue
                    # normalize date
                    if isinstance(dts, str) and len(dts) >= 10 and dts[4] == "-":
                        d = dts[:10]
                    else:
                        try:
                            d = to_iso_utc(int(dts))[:10]
                        except Exception:
                            continue
                    candle = build_candle(d, open_v, high_v, low_v, close_v)
                    if candle:
                        out.append(candle)
                out.sort(key=lambda x: x["date"])
                if out:
                    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=365 * years)).isoformat()
                    out = [x for x in out if x["date"] >= cutoff]
                return out
            except Exception as e:
                print(f"[warn] {symbol} alltick failed: {e}")
    return []


def fetch_daily_yahoo(symbol: str, years: int = MIN_YEARS) -> List[Dict[str, float]]:
    # Use Yahoo Chart API v8 for daily candles
    rng = "1y" if years <= 1 else "2y"
    hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com", "query3.finance.yahoo.com", "query2.finance.yahoo.com"]
    encoded = quote(symbol, safe='=')
    for host in hosts:
        for attempt in range(1, 33):
            query_host = host.replace('HOST', str(((attempt - 1) % len(hosts)) + 1)) if 'HOST' in host else host
            url = f"https://{query_host}/v8/finance/chart/{encoded}?range={rng}&interval=1d"
            try:
                print(f"[history-yahoo] {symbol} try#{attempt} GET {url}")
                r = SESSION.get(url, timeout=20)
                print(f"[history-yahoo] {symbol} status={r.status_code}")
                if r.status_code == 429:
                    sleep = min(15.0 * attempt, 60.0) + random.uniform(1.0, 3.0)
                    time.sleep(sleep)
                    continue
                if r.status_code in {500, 502, 503, 504}:
                    time.sleep(random.uniform(3.0, 6.0))
                    continue
                r.raise_for_status()
                j = r.json()
                res = (j.get("chart") or {}).get("result") or []
                if not res:
                    break
                res = res[0]
                ts = res.get("timestamp") or []
                q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
                opens = q.get("open") or []
                highs = q.get("high") or []
                lows = q.get("low") or []
                closes = q.get("close") or []
                out: List[Dict[str, float]] = []

                def pick(arr, idx):
                    return arr[idx] if idx < len(arr) else None

                for idx, t in enumerate(ts):
                    candle = build_candle(
                        to_iso_utc(int(t)),
                        pick(opens, idx),
                        pick(highs, idx),
                        pick(lows, idx),
                        pick(closes, idx),
                    )
                    if candle:
                        out.append(candle)
                out.sort(key=lambda x: x["date"])
                return out
            except Exception as e:
                print(f"[warn] {symbol} yahoo failed: {e}")
                return []


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
    # require >= 1 year of history and latest point not older than one business day
    try:
        today = datetime.now(timezone.utc).date()
        last_d = datetime.fromisoformat(last).date()
        business_gap = int(np.busday_count(last_d.isoformat(), today.isoformat()))
    except Exception:
        business_gap = 999
    return len(data) >= 200 and first <= min_from_date and business_gap <= 1


def merge_history(old: List[Dict[str, float]], new: List[Dict[str, float]]) -> List[Dict[str, float]]:
    merged: Dict[str, Dict[str, float]] = {}

    def normalize(it):
        if not isinstance(it, dict):
            return None
        date = it.get("date")
        return build_candle(date, it.get("open"), it.get("high"), it.get("low"), it.get("close"))

    for arr in (old, new):
        for it in arr or []:
            candle = normalize(it)
            if candle:
                merged[candle["date"]] = candle

    return [merged[d] for d in sorted(merged.keys())]


def parse_args():
    import argparse
    parser = argparse.ArgumentParser(description="Fetch daily history JSON files")
    parser.add_argument('--symbols', type=str, help='Comma-separated list of symbols to refresh')
    parser.add_argument('--limit', type=int, help='Limit number of symbols processed')
    parser.add_argument('--batch-index', type=int, help='Zero-based batch index when splitting the ticker list')
    parser.add_argument('--batch-size', type=int, default=80, help='Batch size when using --batch-index (default 80)')
    return parser.parse_args()


def main():
    args = parse_args()
    symbol_filter: set[str] | None = None
    if args.symbols:
        symbol_filter = {sym.strip() for sym in args.symbols.split(',') if sym.strip()}
    max_count = args.limit if args.limit and args.limit > 0 else None

    token = os.environ.get("FINNHUB_API_KEY") or os.environ.get("FINNHUB_TOKEN")
    av_key = os.environ.get("ALPHAVANTAGE_API_KEY") or os.environ.get("ALPHAVANTAGE_TOKEN")
    if not token:
        print("[warn] FINNHUB_API_KEY/FINNHUB_TOKEN not set or not authorized for candles; will try Alpha Vantage or Stooq")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    use_worker = bool((os.environ.get("YAHOO_WORKER_URL") or "").strip())
    worker_first = (os.environ.get("HISTORY_WORKER_PRIORITY") or "").strip().lower() in {"1", "true", "yes"}
    symbol_delay = float(os.environ.get("HISTORY_SYMBOL_DELAY") or "1.5")
    try:
        arr = json.loads(DATA_TICKERS.read_text(encoding="utf-8"))
        tickers: list[tuple[str, str]] = []
        if isinstance(arr, list):
            for it in arr:
                if not isinstance(it, dict):
                    continue
                sym = str(it.get("symbol") or "").strip()
                if not sym:
                    continue
                market = str(it.get("market") or "").strip().upper()
                tickers.append((sym, market))
    except Exception:
        tickers = []

    if symbol_filter is not None:
        tickers = [(sym, mkt) for sym, mkt in tickers if sym in symbol_filter]

    if args.batch_index is not None:
        batch_size = args.batch_size if args.batch_size and args.batch_size > 0 else 80
        original_total = len(tickers)
        start = args.batch_index * batch_size
        end = start + batch_size
        if start >= original_total:
            print(f"[history] batch index {args.batch_index} out of range for {original_total} symbols")
            tickers = []
        else:
            tickers = tickers[start:end]
            print(f"[history] processing batch {args.batch_index} (symbols {start + 1} to {min(end, original_total)} of {original_total})")

    use_worker = bool(os.environ.get("YAHOO_WORKER_URL"))

    total = len(tickers)
    if total == 0:
        print('[history] no symbols to process')
        return
    limit_total = min(total, max_count) if max_count else total
    processed = 0
    for sym, market in tickers:
        if max_count is not None and processed >= max_count:
            break
        idx_display = processed + 1 if limit_total else processed + 1
        print(f"[history] ({idx_display}/{limit_total or total}) {sym}")
        try:
            existing = load_existing(sym)
            cutoff = (datetime.now(timezone.utc).date() - timedelta(days=365)).isoformat()
            if coverage_ok(existing, cutoff):
                print(f"[history] {sym} already has >=1y coverage; skip fetch (len={len(existing)})")
                continue
            fresh: List[Dict[str, float]] = []
            source = ""
            if use_worker:
                try:
                    fresh = fetch_daily_worker(map_symbol_for_market(sym, market), years=MIN_YEARS)
                    if fresh:
                        source = "yahoo_worker"
                except Exception as e:
                    print(f"[warn] {sym} worker failed: {e}")
            if not fresh:
                try:
                    fresh = fetch_daily_yahoo(map_symbol_for_market(sym, market), years=MIN_YEARS)
                    if fresh and not source:
                        source = "yahoo"
                except Exception as e:
                    print(f"[warn] {sym} yahoo failed: {e}")
            if not fresh and token and market not in {"CRYPTO", "FX", "COM", "IDX"} and not sym.endswith('.SS'):
                try:
                    fresh = fetch_daily_finnhub(sym, token, years=MIN_YEARS)
                    if fresh:
                        source = "finnhub"
                except Exception as e:
                    print(f"[warn] {sym} finnhub failed: {e}")
            if not fresh and (market == "CN" or sym.endswith('.SS')):
                try:
                    code = sym.split('.')[0]
                    end = datetime.now(timezone.utc).date()
                    start_date = (end - timedelta(days=365 * MIN_YEARS + 7)).strftime('%Y%m%d')
                    df = ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start_date, end_date=end.strftime('%Y%m%d'), adjust="")
                    if isinstance(df, pd.DataFrame) and not df.empty:
                        cols_map = {str(col).strip().lower(): col for col in df.columns}

                        def pick_col(*aliases):
                            for alias in aliases:
                                if alias is None:
                                    continue
                                key = str(alias).strip().lower()
                                if key in cols_map:
                                    return df[cols_map[key]]
                            return None

                        date_col = pick_col('date', '交易日期') or df.iloc[:, 0]
                        open_col = pick_col('open', '开盘', '开盘价')
                        high_col = pick_col('high', '最高', '最高价')
                        low_col = pick_col('low', '最低', '最低价')
                        close_col = pick_col('close', '收盘', '收盘价') or (df.iloc[:, 3] if df.shape[1] > 3 else None)

                        if date_col is not None and close_col is not None:
                            rows: List[Dict[str, float]] = []
                            for idx, d in enumerate(date_col):
                                close_val = close_col.iloc[idx] if hasattr(close_col, 'iloc') else close_col[idx]
                                open_val = open_col.iloc[idx] if open_col is not None else None
                                high_val = high_col.iloc[idx] if high_col is not None else None
                                low_val = low_col.iloc[idx] if low_col is not None else None
                                candle = build_candle(str(d)[:10], open_val, high_val, low_val, close_val)
                                if candle:
                                    rows.append(candle)
                            rows.sort(key=lambda x: x['date'])
                            if rows:
                                fresh = rows
                                source = "akshare"
                except Exception as e:
                    print(f"[warn] {sym} akshare failed: {e}")
            if not fresh and av_key and market not in {"CRYPTO", "FX", "COM", "IDX"}:
                try:
                    fresh = fetch_daily_alpha(sym, av_key, years=MIN_YEARS)
                    if fresh:
                        source = "alpha"
                except Exception as e:
                    print(f"[warn] {sym} alpha failed: {e}")
            if not fresh and market not in {"CRYPTO", "FX", "COM", "IDX"}:
                try:
                    fresh = fetch_daily_stooq(sym, years=MIN_YEARS)
                    if fresh:
                        source = "stooq"
                except Exception as e:
                    print(f"[warn] {sym} stooq failed: {e}")
            if not fresh and not existing:
                print(f"[warn] {sym} no data from any provider; skip writing (keep absent)")
                continue
            merged = merge_history(existing, fresh)
            out_path = OUT_DIR / f"{sym}.json"
            with open(out_path, "w") as f:
                json.dump(merged, f)
            print("[ok] wrote", out_path, f"len={len(merged)}", f"source={source or 'existing'}")
        except Exception as e:
            print(f"[warn] {sym} history failed: {e}")
        finally:
            processed += 1
if __name__ == "__main__":
    main()



