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


def fetch_daily_twelvedata(symbol: str, api_key: str, years: int = MIN_YEARS) -> List[Dict[str, float]]:
    """Twelve Data time_series for daily candles.

    Strips .SS suffix and fetches 1day interval; trims to last N years.
    """
    base = "https://api.twelvedata.com/time_series"
    sym = symbol.split(".")[0]
    params = {
        "symbol": sym,
        "interval": "1day",
        "outputsize": 5000,
        "apikey": api_key,
    }
    print(f"[history-td] {symbol} GET {base} interval=1day symbol={sym}")
    r = SESSION.get(base, params=params, timeout=25)
    print(f"[history-td] {symbol} status={r.status_code}")
    r.raise_for_status()
    j = r.json()
    if isinstance(j, dict) and j.get("status") == "error":
        raise RuntimeError(j.get("message") or "twelvedata error")
    values = (j or {}).get("values") or []
    out = []
    for it in values:
        try:
            d = it.get("datetime") or it.get("date")
            c = float(it.get("close"))
            out.append({"date": d[:10], "close": c})
        except Exception:
            continue
    # Twelve Data returns most-recent-first; sort ASC and trim
    out.sort(key=lambda x: x["date"]) 
    if out:
        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=365 * years)).isoformat()
        out = [x for x in out if x["date"] >= cutoff]
    return out


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
    td_key = os.environ.get("TWELVEDATA_API_KEY") or os.environ.get("TWELVEDATA_TOKEN")
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
            # 1) Finnhub primary
            if token and not sym.endswith('.SS'):
                try:
                    fresh = fetch_daily_finnhub(sym, token, years=MIN_YEARS)
                    if fresh: source = "finnhub"
                except Exception as e:
                    print(f"[warn] {sym} finnhub failed: {e}")
            # 1b) Twelve Data for CN first
            if not fresh and td_key and sym.endswith('.SS'):
                try:
                    fresh = fetch_daily_twelvedata(sym, td_key, years=MIN_YEARS)
                    if fresh: source = "twelvedata"
                except Exception as e:
                    print(f"[warn] {sym} twelvedata failed: {e}")
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
