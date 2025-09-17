# scripts/quotes.py
import json
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

def yahoo_last_from_download(symbol: str):
    """Essaie 1m, puis 5m, puis 1d via yf.download (avec session)."""
    for (period, interval) in [("2d","1m"), ("5d","5m"), ("1mo","1d")]:
        try:
            df = yf.download(
                symbol, period=period, interval=interval,
                auto_adjust=True, progress=False, session=SESSION, threads=False
            )
            if not df.empty and "Close" in df:
                px = float(df["Close"].iloc[-1])
                ts = to_iso_utc(df.index[-1])
                return px, ts, interval
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

if __name__ == "__main__":
    main()
