# scripts/quotes.py
import json
import time
import random
from pathlib import Path
from datetime import datetime, timezone
import requests
import pandas as pd
import yfinance as yf

TICKERS = ["ASML.AS","SAP.DE","MC.PA","AIR.PA","BMW.DE","BNP.PA"]

DATA_DIR = Path("data")
OUT = DATA_DIR / "quotes.json"

# Session HTTP avec User-Agent explicite (certains environnements CI en ont besoin)
SESSION = requests.Session()
SESSION.headers["User-Agent"] = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

def to_iso_utc(ts) -> str:
    if ts is None:
        return None
    try:
        if getattr(ts, "tzinfo", None) is None:
            ts = ts.tz_localize("UTC")
        else:
            ts = ts.tz_convert("UTC")
        return ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return None

def yahoo_last_from_chart(symbol: str):
    """Interroge directement l'API Yahoo Chart v8 (HTTP) en 5m puis 1d.

    Retourne (prix, horodatage_iso_utc, interval) ou (None, None, None).
    """
    hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
    base_tpl = "https://{host}/v8/finance/chart/{sym}?range={rng}&interval={itv}"
    for rng, itv in [("5d","5m"), ("1mo","1d")]:
        for host in hosts:
            url = base_tpl.format(host=host, sym=symbol, rng=rng, itv=itv)
            for attempt in range(1, 4):
                try:
                    print(f"[chart] {symbol} {rng}/{itv} try#{attempt} GET {url}")
                    resp = SESSION.get(url, timeout=20)
                    print(f"[chart] {symbol} {rng}/{itv} status={resp.status_code}")
                    if resp.status_code == 429:
                        delay = (2 ** (attempt - 1)) + random.uniform(0, 0.5)
                        print(f"[chart] {symbol} {rng}/{itv} rate-limited; sleep {delay:.2f}s")
                        time.sleep(delay)
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                    if (data.get("chart") or {}).get("error"):
                        err = (data.get("chart") or {}).get("error")
                        print(f"[chart] {symbol} {rng}/{itv} api-error: {err}")
                        break
                    results = (data.get("chart") or {}).get("result") or []
                    if not results:
                        print(f"[chart] {symbol} {rng}/{itv} no results")
                        break
                    res = results[0]
                    ts_arr = res.get("timestamp") or []
                    q = ((res.get("indicators") or {}).get("quote") or [{}])[0]
                    closes = q.get("close") or []
                    print(f"[chart] {symbol} {rng}/{itv} points ts={len(ts_arr)} close={len(closes)}")
                    if not ts_arr or not closes:
                        break
                    for i in range(len(closes)-1, -1, -1):
                        c = closes[i]
                        if c is None:
                            continue
                        t = ts_arr[i]
                        dt = datetime.fromtimestamp(int(t), tz=timezone.utc)
                        iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                        print(f"[chart] {symbol} {rng}/{itv} last={c} @ {iso}")
                        return float(c), iso, itv
                    break
                except Exception as e:
                    print(f"[warn] direct chart {symbol} {rng}/{itv} failed: {e}")
    return None, None, None

def yahoo_last_from_download(symbol: str):
    """Essaie 1m, puis 5m, puis 1d via yf.download (avec session)."""
    for (period, interval) in [("2d","1m"), ("5d","5m"), ("1mo","1d")]:
        try:
            print(f"[download] {symbol} {period}/{interval} start")
            df = yf.download(
                symbol, period=period, interval=interval,
                auto_adjust=True, progress=False, session=SESSION, threads=False
            )
            if not df.empty and "Close" in df:
                px = float(df["Close"].iloc[-1])
                ts = to_iso_utc(df.index[-1])
                print(f"[download] {symbol} {period}/{interval} rows={len(df)} last={px} @ {ts}")
                return px, ts, interval
            else:
                print(f"[download] {symbol} {period}/{interval} empty or no Close")
        except Exception as e:
            print(f"[warn] download {symbol} {period}/{interval} failed: {e}")
    return None, None, None

def yahoo_last_from_ticker(symbol: str):
    """Fallback via fast_info puis history() quotidien."""
    try:
        tk = yf.Ticker(symbol, session=SESSION)
        fi = getattr(tk, "fast_info", None)
        if fi:
            px = fi.get("last_price") or fi.get("lastPrice")
            if px:
                # pas d'horodatage précis ici; on met generated_at plus bas
                return float(px), None, "fast_info"
    except Exception as e:
        print(f"[warn] fast_info {symbol} failed: {e}")

    # Dernier recours : daily history
    try:
        df = tk.history(period="5d", interval="1d", auto_adjust=True)
        if not df.empty and "Close" in df:
            px = float(df["Close"].iloc[-1])
            ts = to_iso_utc(df.index[-1])
            return px, ts, "1d"
    except Exception as e:
        print(f"[warn] history 1d {symbol} failed: {e}")

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
    prev = load_previous()
    out = {}

    for s in TICKERS:
        px, ts, src = yahoo_last_from_download(s)
        if px is None:
            px, ts, src = yahoo_last_from_ticker(s)

        if px is None:
            # Dernier filet de sécurité : reprendre la dernière valeur non nulle
            old = prev.get(s) or {}
            px = old.get("last")
            ts = old.get("as_of")
            src = f"prev::{old.get('interval','unknown')}" if px is not None else None
            print(f"[warn] {s}: using previous value {px} @ {ts}")

        out[s] = {"last": px, "as_of": ts, "interval": src}

    out["meta"] = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "yfinance (Yahoo; 1m→5m→1d→fast_info; prev backup)",
        "note": "If intraday is unavailable, falls back gracefully; keeps previous value if needed."
    }

    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    print("[ok] wrote", OUT)

def yahoo_last_from_ticker_hardened(symbol: str):
    """Version robuste: tente fast_info puis history() quotidien.

    Crée le Ticker en dehors des accès réseau et garantit que history()
    est essayé même si fast_info échoue.
    """
    try:
        print(f"[ticker] {symbol} init")
        tk = yf.Ticker(symbol, session=SESSION)
    except Exception as e:
        print(f"[warn] Ticker init {symbol} failed: {e}")
        return None, None, None

    # 1) fast_info
    try:
        fi = getattr(tk, "fast_info", None)
        if fi:
            px = fi.get("last_price") or fi.get("lastPrice")
            if px:
                print(f"[ticker] {symbol} fast_info last={px}")
                return float(px), None, "fast_info"
    except Exception as e:
        print(f"[warn] fast_info {symbol} failed: {e}")

    # 2) daily history
    try:
        df = tk.history(period="5d", interval="1d", auto_adjust=True)
        if not df.empty and "Close" in df:
            px = float(df["Close"].iloc[-1])
            ts = to_iso_utc(df.index[-1])
            print(f"[ticker] {symbol} history 1d rows={len(df)} last={px} @ {ts}")
            return px, ts, "1d"
    except Exception as e:
        print(f"[warn] history 1d {symbol} failed: {e}")

    return None, None, None

def main_hardened():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    had_prev = OUT.exists()
    prev = load_previous()
    print(f"[main] start; had_prev={had_prev}; prev_keys={list(prev.keys())}")
    out = dict(prev)  # ne jamais dégrader
    changed = False

    for s in TICKERS:
        print(f"[main] symbol={s} — try chart")
        # 1) appel direct à l'API chart (souvent plus fiable en CI)
        px, ts, src = yahoo_last_from_chart(s)
        # 2) yfinance.download
        if px is None:
            print(f"[main] symbol={s} — try download")
            px, ts, src = yahoo_last_from_download(s)
        # 3) yfinance.Ticker fallbacks
        if px is None:
            print(f"[main] symbol={s} — try ticker")
            px, ts, src = yahoo_last_from_ticker_hardened(s)

        if px is None:
            old = prev.get(s) or {}
            if old.get("last") is not None:
                print(f"[warn] {s}: no fresh data; keeping previous {old.get('last')} @ {old.get('as_of')}")
                continue
            else:
                print(f"[warn] {s}: no data and no previous; leaving unchanged")
                continue

        new_entry = {"last": float(px), "as_of": ts, "interval": src}
        if prev.get(s) != new_entry:
            changed = True
        out[s] = new_entry
        # throttle between symbols to avoid bursts (rate-limit mitigation)
        time.sleep(0.6 + random.uniform(0, 0.4))

    if not changed:
        if had_prev:
            print("[ok] no changes; preserving previous file")
            return
        else:
            raise SystemExit("no data fetched and no previous file; aborting")

    out["meta"] = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "yfinance (Yahoo; download 1m/5m/1d; fast_info; history 1d)",
        "note": "Never writes nulls; preserves previous values if fresh data unavailable."
    }

    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
    print("[ok] wrote", OUT)

if __name__ == "__main__":
    # Utilise la version durcie qui ne produit jamais de nulls
    main_hardened()
