"""
Generate quotes.json using an official provider (Finnhub).
Supports global equities plus crypto, FX, commodities, and major indices (loaded from data/tickers.json) and
only fetches quotes when the corresponding market is open (crypto stays open 24/7).
"""

from __future__ import annotations

import json
import os
import time
import random
from pathlib import Path
from datetime import datetime, timezone, time as dtime, timedelta
from zoneinfo import ZoneInfo
import akshare as ak
import pandas as pd
import requests

DATA_TICKERS = Path("data/tickers.json")

DATA_DIR = Path("data")
PUBLIC_DIR = Path("public")
OUT = DATA_DIR / "quotes.json"
PUBLIC_OUT = PUBLIC_DIR / "quotes.json"

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


def alltick_last(symbol: str, api_key: str):
    """Fetch last price from Alltick for CN tickers (symbol without .SS).

    Tries configurable ALLTICK_QUOTE_URL then common endpoints; parses common
    fields (price/close, datetime/timestamp)."""
    sym = symbol.split(".")[0]
    base_env = os.environ.get("ALLTICK_QUOTE_URL")
    candidates = [
        base_env,
        "https://api.alltick.co/quote",
        "https://api.alltick.co/market/quote",
        "https://api.alltick.co/price",
    ]
    for base in candidates:
        if not base:
            continue
        try:
            print(f"[allt] {symbol} GET {base} symbol={sym}")
            r = SESSION.get(base, params={"symbol": sym, "apikey": api_key}, timeout=15)
            print(f"[allt] {symbol} status={r.status_code}")
            j = None
            try:
                j = r.json()
            except Exception:
                j = None
            if r.status_code >= 400:
                print(f"[allt] {symbol} error-body={j}")
                r.raise_for_status()
            # Handle dict payloads
            price = None
            ts = None
            if isinstance(j, dict):
                # direct fields or nested under 'data'
                src = j.get("data") if isinstance(j.get("data"), dict) else j
                price = (src.get("price") if isinstance(src, dict) else None) or (
                    src.get("close") if isinstance(src, dict) else None
                )
                ts = (src.get("datetime") if isinstance(src, dict) else None) or (
                    src.get("timestamp") if isinstance(src, dict) else None
                )
            elif isinstance(j, list) and j:
                # list, take last entry
                item = j[-1]
                if isinstance(item, dict):
                    price = item.get("price") or item.get("close")
                    ts = item.get("datetime") or item.get("timestamp")
            if price is not None:
                px = float(price)
                if not ts:
                    ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
                print(f"[allt] {symbol} last={px} @ {ts}")
                return px, ts, "allt"
        except Exception as e:
            print(f"[warn] alltick {symbol} failed: {e}")
            continue
    return None, None, None


def load_previous():
    if OUT.exists():
        try:
            with open(OUT, "r") as f:
                return json.load(f)
        except Exception:
            pass
    # fallback: read from public if exists
    if PUBLIC_OUT.exists():
        try:
            with open(PUBLIC_OUT, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def load_tickers_by_market():
    us: list[str] = []
    cn: list[str] = []
    eu: list[str] = []
    jp: list[str] = []
    sa: list[str] = []
    crypto: list[str] = []
    fx: list[str] = []
    com: list[str] = []
    idx: list[str] = []
    try:
        arr = json.loads(DATA_TICKERS.read_text(encoding="utf-8"))
        if isinstance(arr, list):
            for it in arr:
                if not isinstance(it, dict):
                    continue
                sym = str(it.get("symbol") or "").strip()
                mkt = str(it.get("market") or "").strip().upper()
                if not sym:
                    continue
                if mkt == "CN":
                    cn.append(sym)
                elif mkt == "EU":
                    eu.append(sym)
                elif mkt == "JP":
                    jp.append(sym)
                elif mkt == "SA":
                    sa.append(sym)
                elif mkt == "CRYPTO":
                    crypto.append(sym)
                elif mkt in {"FX", "FOREX"}:
                    fx.append(sym)
                elif mkt in {"COM", "COMMODITY"}:
                    com.append(sym)
                elif mkt in {"IDX", "INDEX"}:
                    idx.append(sym)
                elif mkt == "US" or not mkt:
                    us.append(sym)
    except Exception as e:
        print(f"[warn] load tickers failed: {e}; defaulting to US only")
    return us, cn, eu, jp, sa, crypto, fx, com, idx


def us_market_is_open(token: str | None) -> bool:
    """Return True if US stock market is open now.

    Prefer Finnhub market-status; fallback to local NY time window if API fails.
    Session considered: Mon-Fri, 09:30–16:00 America/New_York (regular hours).
    """
    # 1) Try Finnhub endpoint if token present
    if token:
        try:
            url = "https://finnhub.io/api/v1/stock/market-status"
            r = SESSION.get(url, params={"exchange": "US", "token": token}, timeout=10)
            if r.status_code == 200:
                j = r.json()
                # accept a variety of shapes
                for k in ("isOpen", "is_open", "open"):
                    v = j.get(k)
                    if isinstance(v, bool):
                        return v
                # sometimes nested under 'market'
                market = j.get("market") if isinstance(j, dict) else None
                if isinstance(market, dict):
                    v = market.get("isOpen") or market.get("open")
                    if isinstance(v, bool):
                        return v
        except Exception as e:
            print(f"[warn] market-status check failed, fallback to local window: {e}")

    # 2) Fallback: check New York local time window
    ny = datetime.now(ZoneInfo("America/New_York"))
    if ny.weekday() >= 5:  # 5=Sat,6=Sun
        return False
    start = dtime(9, 30)
    end = dtime(16, 0)
    return start <= ny.time() <= end


def cn_market_is_open() -> bool:
    # Shanghai regular sessions: 09:30–11:30 and 13:00–15:00, Mon–Fri
    sh = datetime.now(ZoneInfo("Asia/Shanghai"))
    if sh.weekday() >= 5:
        return False
    t = sh.time()
    morning = dtime(9,30) <= t <= dtime(11,30)
    afternoon = dtime(13,0) <= t <= dtime(15,0)
    return morning or afternoon


def eu_market_is_open() -> bool:
    # Euronext Paris: 09:00–17:30 local time, Mon–Fri
    eu = datetime.now(ZoneInfo("Europe/Paris"))
    if eu.weekday() >= 5:
        return False
    return dtime(9,0) <= eu.time() <= dtime(17,30)


def jp_market_is_open() -> bool:
    # Tokyo: 09:00–11:30 and 12:30–15:00 local time, Mon–Fri
    jp = datetime.now(ZoneInfo("Asia/Tokyo"))
    if jp.weekday() >= 5:
        return False
    t = jp.time()
    return (dtime(9,0) <= t <= dtime(11,30)) or (dtime(12,30) <= t <= dtime(15,0))


def sa_market_is_open() -> bool:
    # Tadawul (KSA): Sun–Thu, 10:00–15:00 local time
    sa = datetime.now(ZoneInfo("Asia/Riyadh"))
    if sa.weekday() not in {6,0,1,2,3}:  # Sun(6)–Thu(3)
        return False
    return dtime(10,0) <= sa.time() <= dtime(15,0)


def crypto_market_is_open() -> bool:
    """Crypto trades 24/7; treat as always open."""
    return True


def fx_market_is_open() -> bool:
    """Approximate FX session: keep open on weekdays."""
    now = datetime.now(timezone.utc)
    if now.weekday() >= 5:
        return False
    return True


def commodities_market_is_open() -> bool:
    """Commodities trade nearly 24/6; treat as always available for quotes."""
    return True


def indices_market_is_open() -> bool:
    """Indices are evaluated on weekdays similar to FX."""
    now = datetime.now(timezone.utc)
    if now.weekday() >= 5:
        return False
    return True


def yahoo_last(symbol: str):
    hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
    for host in hosts:
        url = f"https://{host}/v8/finance/chart/{symbol}?range=1mo&interval=1d"
        for attempt in range(1,3):
            try:
                print(f"[yahoo] {symbol} try#{attempt} GET {url}")
                r = SESSION.get(url, timeout=15)
                print(f"[yahoo] {symbol} status={r.status_code}")
                if r.status_code == 429:
                    time.sleep(1.2 * attempt)
                    continue
                r.raise_for_status()
                j = r.json()
                res = (j.get("chart") or {}).get("result") or []
                if not res:
                    break
                res0 = res[0]
                ts = res0.get("timestamp") or []
                q = ((res0.get("indicators") or {}).get("quote") or [{}])[0]
                closes = q.get("close") or []
                for i in range(len(closes)-1, -1, -1):
                    c = closes[i]
                    if c is None:
                        continue
                    t = ts[i]
                    dt = datetime.fromtimestamp(int(t), tz=timezone.utc)
                    iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                    return float(c), iso, "yahoo_1d"
            except Exception as e:
                print(f"[warn] yahoo {symbol} failed: {e}")
    return None, None, None


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    api_key = os.environ.get("FINNHUB_API_KEY") or os.environ.get("FINNHUB_TOKEN")
    at_key = None  # Alltick removed — using akshare for CN
    if not api_key:
        print("[warn] FINNHUB_API_KEY/FINNHUB_TOKEN not set; US quotes unavailable.")
    if not at_key:
        print("[warn] ALLTICK_API_KEY/TOKEN not set; CN quotes unavailable.")
    had_prev = OUT.exists()
    prev = load_previous()
    us_list, cn_list, eu_list, jp_list, sa_list, crypto_list, fx_list, com_list, idx_list = load_tickers_by_market()
    print(f"[main] start; had_prev={had_prev}; prev_keys={list(prev.keys())}")
    open_us = us_market_is_open(api_key)
    open_cn = cn_market_is_open()
    open_eu = eu_market_is_open()
    open_jp = jp_market_is_open()
    open_sa = sa_market_is_open()
    open_crypto = bool(crypto_list) and crypto_market_is_open()
    open_fx = bool(fx_list) and fx_market_is_open()
    open_com = bool(com_list) and commodities_market_is_open()
    open_idx = bool(idx_list) and indices_market_is_open()
    symbols: list[str] = []
    if open_us:
        symbols.extend(us_list)
    if open_cn:
        symbols.extend(cn_list)
    if open_eu:
        symbols.extend(eu_list)
    if open_jp:
        symbols.extend(jp_list)
    if open_sa:
        symbols.extend(sa_list)
    if open_crypto:
        symbols.extend(crypto_list)
    if open_fx:
        symbols.extend(fx_list)
    if open_com:
        symbols.extend(com_list)
    if open_idx:
        symbols.extend(idx_list)
    if not symbols:
        print("[info] No market open now; skip fetching and preserve previous files")
        if had_prev or PUBLIC_OUT.exists():
            return
        else:
            raise SystemExit("no market open and no previous file; aborting")
    out: dict = {}
    changed = False

    us_set = set(us_list)
    cn_set = set(cn_list)
    eu_set = set(eu_list)
    jp_set = set(jp_list)
    sa_set = set(sa_list)
    crypto_set = set(crypto_list)
    fx_set = set(fx_list)
    com_set = set(com_list)
    idx_set = set(idx_list)
    for s in symbols:
        if s in cn_set:
            # CN via Akshare spot snapshot; fallback to last daily
            code = s.split('.')[0]
            px, ts, src = None, None, None
            try:
                print(f"[akshare] load CN spot snapshot")
                spot = ak.stock_zh_a_spot_em()
                if isinstance(spot, pd.DataFrame) and not spot.empty:
                    # Columns: 代码, 最新价 (commonly)
                    if '代码' in spot.columns and '最新价' in spot.columns:
                        row = spot.loc[spot['代码'] == code]
                        if not row.empty:
                            px = float(row.iloc[0]['最新价'])
                            ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
                            src = 'akshare_spot'
            except Exception as e:
                print(f"[warn] akshare spot failed: {e}")
            if px is None:
                try:
                    df = ak.stock_zh_a_hist(symbol=code, period='daily', start_date=(datetime.now(timezone.utc).date()-timedelta(days=10)).strftime('%Y%m%d'), end_date=datetime.now(timezone.utc).date().strftime('%Y%m%d'), adjust='')
                    if isinstance(df, pd.DataFrame) and not df.empty:
                        date_key = '日期' if '日期' in df.columns else ('date' if 'date' in df.columns else None)
                        close_key = '收盘' if '收盘' in df.columns else ('close' if 'close' in df.columns else None)
                        if date_key and close_key:
                            px = float(df[close_key].iloc[-1])
                            ts_val = str(df[date_key].iloc[-1])
                            ts = (ts_val[:10] + 'T00:00:00Z')
                            src = 'akshare_daily'
                except Exception as e:
                    print(f"[warn] akshare daily failed: {e}")
            if px is None:
                old = prev.get(s) or {}
                if old.get('last') is not None:
                    print(f"[warn] {s}: no fresh CN data; keeping previous {old.get('last')} @ {old.get('as_of')}")
                    new_entry = {"last": float(old.get("last")), "as_of": old.get("as_of"), "interval": old.get("interval")}
                    out[s] = new_entry
                    continue
                else:
                    print(f"[warn] {s}: no CN data and no previous; leaving unchanged")
                    continue
            new_entry = {"last": float(px), "as_of": ts, "interval": src}
            if prev.get(s) != new_entry:
                changed = True
            out[s] = new_entry
            time.sleep(0.2 + random.uniform(0,0.2))
            continue
        elif s in eu_set or s in jp_set or s in sa_set:
            print(f"[main] {s} - try Yahoo 1d")
            px, ts, src = yahoo_last(s)
        elif s in crypto_set:
            print(f"[main] {s} - try Yahoo crypto")
            px, ts, src = yahoo_last(s)
        elif s in fx_set:
            print(f"[main] {s} - try Yahoo fx")
            px, ts, src = yahoo_last(s)
        elif s in com_set:
            print(f"[main] {s} - try Yahoo commodity")
            px, ts, src = yahoo_last(s)
        elif s in idx_set:
            print(f"[main] {s} - try Yahoo index")
            px, ts, src = yahoo_last(s)
        else:
            if s not in us_set:
                print(f"[main] {s} - fallback Yahoo global")
                px, ts, src = yahoo_last(s)
            else:
                if not api_key:
                    print(f"[warn] {s}: no Finnhub key; cannot update US ticker")
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
        "source": "Finnhub(/quote) for US; Akshare for CN; Yahoo for EU/JP/SA/Crypto/FX/Commodities/Indices",
        "note": "Never writes nulls; preserves previous values if unavailable."
    }

    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    with open(PUBLIC_OUT, "w") as f:
        json.dump(out, f, indent=2)
    print("[ok] wrote", OUT, "and", PUBLIC_OUT)


if __name__ == "__main__":
    main()
