"""
Generate/ensure daily history JSON for tickers via the Cloudflare Yahoo
proxy when available, falling back to Finnhub candle data and other providers.

Guarantees at least the last 1 year of daily closes is present. If a file
already exists, it loads and checks coverage; if incomplete, it fetches
the missing range (implemented by refetching the last 1y and merging),
then writes to public/history/{SYMBOL}.json as an array of
{date: YYYY-MM-DD, close: number} sorted ascending.

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
import pandas as pd
import akshare as ak
import csv

import requests

DATA_TICKERS = Path("data/tickers.json")
MIN_YEARS = 1  # ensure at least this coverage

SESSION = requests.Session()
SESSION.headers["User-Agent"] = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

OUT_DIR = Path("public/history")


def to_iso_utc(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


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
    closes = j.get("c") or []
    ts = j.get("t") or []
    if not closes or not ts or len(closes) != len(ts):
        raise RuntimeError(f"history payload invalid for {symbol}: lens c={len(closes)} t={len(ts)}")
    out = [{"date": to_iso_utc(t), "close": float(c)} for t, c in zip(ts, closes)]
    # ensure ascending order by date
    out.sort(key=lambda x: x["date"])  # already ascending, but be safe
    return out


def fetch_daily_worker(symbol: str, years: int = MIN_YEARS) -> List[Dict[str, float]]:
    """Fetch daily closes via Cloudflare Yahoo proxy if configured."""

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
    url = f"{base_url.rstrip('/')}/history/{symbol}"

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
        close = point.get("close")
        if isinstance(date, str) and isinstance(close, (int, float)):
            out.append({"date": date, "close": float(close)})

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
        try:
            close = float(v.get("5. adjusted close") or v.get("4. close"))
        except Exception:
            continue
        rows.append({"date": d, "close": close})
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
        try:
            d = row.get("Date") or row.get("date")
            c = float(row.get("Close") or row.get("close"))
            rows.append({"date": d, "close": c})
        except Exception:
            continue
    rows.sort(key=lambda x: x["date"])
    if rows:
        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=365 * years)).isoformat()
        rows = [x for x in rows if x["date"] >= cutoff]
    return rows


    


def fetch_daily_alltick(symbol: str, api_key: str, years: int = MIN_YEARS) -> List[Dict[str, float]]:
    """Alltick daily history (CN) — tries common kline endpoints, strips .SS.

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
                    close = None
                    if isinstance(it, dict):
                        # common: t/time/datetime, c/close/last
                        dts = it.get("datetime") or it.get("time") or it.get("t") or it.get("date")
                        close = it.get("close") or it.get("c") or it.get("last") or it.get("price")
                    else:
                        # If list, assume [ts, open, high, low, close, ...]
                        try:
                            ts_val = it[0]
                            close = float(it[4])
                            if isinstance(ts_val, (int, float)):
                                dts = to_iso_utc(int(ts_val))
                            else:
                                dts = str(ts_val)
                        except Exception:
                            pass
                    if close is None or dts is None:
                        continue
                    try:
                        c = float(close)
                    except Exception:
                        continue
                    # normalize date
                    if isinstance(dts, str) and len(dts) >= 10 and dts[4] == "-":
                        d = dts[:10]
                    else:
                        try:
                            d = to_iso_utc(int(dts))[:10]
                        except Exception:
                            continue
                    out.append({"date": d, "close": c})
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
    hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
    for host in hosts:
        url = f"https://{host}/v8/finance/chart/{symbol}?range={rng}&interval=1d"
        for attempt in range(1, 4):
            try:
                print(f"[history-yahoo] {symbol} try#{attempt} GET {url}")
                r = SESSION.get(url, timeout=20)
                print(f"[history-yahoo] {symbol} status={r.status_code}")
                if r.status_code == 429:
                    # exponential backoff with jitter
                    delay = (1.2 * attempt) + (attempt - 1)
                    time.sleep(delay)
                    continue
                r.raise_for_status()
                j = r.json()
                res = (j.get("chart") or {}).get("result") or []
                if not res:
                    break
                res = res[0]
                ts = res.get("timestamp") or []
                q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
                closes = q.get("close") or []
                out = []
                for t, c in zip(ts, closes):
                    if c is None:
                        continue
                    out.append({"date": to_iso_utc(int(t)), "close": float(c)})
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
    av_key = os.environ.get("ALPHAVANTAGE_API_KEY") or os.environ.get("ALPHAVANTAGE_TOKEN")
    # Alltick/TwelveData removed; prefer Akshare for CN
    if not token:
        print("[warn] FINNHUB_API_KEY/FINNHUB_TOKEN not set or not authorized for candles; will try Alpha Vantage or Stooq")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load symbols from data/tickers.json
    try:
        arr = json.loads(DATA_TICKERS.read_text(encoding="utf-8"))
        symbols = [str(it.get("symbol")).strip() for it in arr if isinstance(it, dict) and it.get("symbol")]
    except Exception:
        symbols = []

    for sym in symbols:
        try:
            existing = load_existing(sym)
            cutoff = (datetime.now(timezone.utc).date() - timedelta(days=365)).isoformat()
            if coverage_ok(existing, cutoff):
                print(f"[history] {sym} already has >=1y coverage; skip fetch (len={len(existing)})")
                continue
            fresh: List[Dict[str, float]] = []
            source = ""
            # 0) Cloudflare worker proxy
            if not fresh:
                try:
                    fresh = fetch_daily_worker(sym, years=MIN_YEARS)
                    if fresh:
                        source = "yahoo_worker"
                except Exception as e:
                    print(f"[warn] {sym} worker failed: {e}")
            # 1) Finnhub primary
            if not fresh and token and not sym.endswith('.SS'):
                try:
                    fresh = fetch_daily_finnhub(sym, token, years=MIN_YEARS)
                    if fresh:
                        source = "finnhub"
                except Exception as e:
                    print(f"[warn] {sym} finnhub failed: {e}")
            # 1b) CN: Akshare first
            if not fresh and sym.endswith('.SS'):
                try:
                    code = sym.split('.')[0]
                    end = datetime.now(timezone.utc).date()
                    start = (end - timedelta(days=365*MIN_YEARS+7)).strftime('%Y%m%d')
                    df = ak.stock_zh_a_hist(symbol=code, period="daily", start_date=start, end_date=end.strftime('%Y%m%d'), adjust="")
                    if isinstance(df, pd.DataFrame) and not df.empty:
                        date_key = '日期' if '日期' in df.columns else ('date' if 'date' in df.columns else None)
                        close_key = '收盘' if '收盘' in df.columns else ('close' if 'close' in df.columns else None)
                        if date_key and close_key:
                            fresh = [{"date": str(d)[:10], "close": float(c)} for d, c in zip(df[date_key], df[close_key]) if pd.notna(c)]
                            fresh.sort(key=lambda x: x['date'])
                            source = "akshare"
                except Exception as e:
                    print(f"[warn] {sym} akshare failed: {e}")
            # 2) Alpha Vantage fallback
            if not fresh and av_key:
                try:
                    fresh = fetch_daily_alpha(sym, av_key, years=MIN_YEARS)
                    # respect AV rate limit (5/min)
                    time.sleep(12)
                    if fresh: source = "alpha"
                except Exception as e:
                    print(f"[warn] {sym} alpha failed: {e}")
            # 3) Stooq fallback (no key)
            if not fresh:
                try:
                    fresh = fetch_daily_stooq(sym, years=MIN_YEARS)
                    if fresh: source = "stooq"
                except Exception as e:
                    print(f"[warn] {sym} stooq failed: {e}")
            # 4) Yahoo fallback (no key)
            if not fresh:
                try:
                    fresh = fetch_daily_yahoo(sym, years=MIN_YEARS)
                    if fresh: source = "yahoo"
                except Exception as e:
                    print(f"[warn] {sym} yahoo failed: {e}")
            if not fresh and not existing:
                print(f"[warn] {sym} no data from any provider; skip writing (keep absent)")
                continue
            merged = merge_history(existing, fresh)
            out_path = OUT_DIR / f"{sym}.json"
            with open(out_path, "w") as f:
                json.dump(merged, f)
            print("[ok] wrote", out_path, f"len={len(merged)}", f"source={source or 'existing'}")
            # throttle a bit after Yahoo to avoid 429
            if source == "yahoo":
                time.sleep(1.5)
        except Exception as e:
            print(f"[warn] {sym} history failed: {e}")


if __name__ == "__main__":
    main()
