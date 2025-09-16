# scripts/quotes.py
import json
from pathlib import Path
from datetime import datetime, timezone
import pandas as pd
import yfinance as yf

TICKERS = ["ASML.AS","SAP.DE","MC.PA","AIR.PA","BMW.DE","BNP.PA"]

def last_price(symbol: str):
    # Essaie 1 minute, puis 5 minutes, puis 1 jour
    for (period, interval) in [("2d","1m"), ("5d","5m"), ("1mo","1d")]:
        try:
            df = yf.download(symbol, period=period, interval=interval,
                             auto_adjust=True, progress=False)
            if not df.empty:
                ts = df.index[-1]
                if ts.tzinfo is None: ts = ts.tz_localize("UTC")
                else: ts = ts.tz_convert("UTC")
                px = float(df["Close"].iloc[-1])
                return px, ts.strftime("%Y-%m-%dT%H:%M:%SZ"), interval
        except Exception:
            pass
    return None, None, None

def main():
    out = {}
    for s in TICKERS:
        px, ts, interval = last_price(s)
        out[s] = {"last": px, "as_of": ts, "interval": interval}
    out["meta"] = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "yfinance (Yahoo delayed)",
        "note": "Falls back to 5m or 1d when 1m is unavailable."
    }

    outdir = Path("data")
    outdir.mkdir(parents=True, exist_ok=True)
    with open(outdir / "quotes.json", "w") as f:
        json.dump(out, f, indent=2)

if __name__ == "__main__":
    main()
