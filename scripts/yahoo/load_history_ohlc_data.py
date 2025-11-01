# pip install supabase yfinance pandas python-dateutil

import yfinance as yf
import os
from supabase import create_client
import pandas as pd
from datetime import datetime
import math

# DB CONFIG
SUPABASE_URL = "your_supabase_url"
SUPABASE_KEY = "your_supabase_key"
TABLE = "stock_market_history"
all_rows = []
page = 0
BATCH_SIZE = 1000  # tune by API limits

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

while True:
    from_row = page * BATCH_SIZE
    to_row = (page + 1) * BATCH_SIZE - 1

    print(f"Fetching rows {from_row} -> {to_row} ...")

    data = (
        supabase.table(TABLE)
        .select("id, symbol, record_date")
        .is_("open_value", None)
        .range(from_row, to_row)
        .execute()
        .data
    )

    if not data:
        break

    all_rows.extend(data)
    page += 1

if len(all_rows) == 0:
    print("No rows found.")
    raise SystemExit

df = pd.DataFrame(all_rows)

# Normalize columns
df['symbol'] = df['symbol'].astype(str).str.upper()
df['record_date'] = pd.to_datetime(df['record_date']).dt.normalize()

symbols = df['symbol'].unique()

print(f"Total rows loaded: {len(df)}")
print(f"Unique symbols to fetch: {len(symbols)}")

updates = []

# ---- STEP 2: Fetch Yahoo OHLC data per symbol ----
for symbol in symbols:
    symbol_rows = df[df['symbol'] == symbol].copy()

    # Filter only rows having valid dates
    symbol_rows = symbol_rows.dropna(subset=["record_date"])
    if symbol_rows.empty:
        print(f"Skipping {symbol}: no valid record_date")
        continue

    min_date = symbol_rows['record_date'].min()
    max_date = symbol_rows['record_date'].max()

    # If min or max is still NaT, skip
    if pd.isna(min_date) or pd.isna(max_date):
        print(f"Skipping {symbol}: min/max date is NaT")
        continue

    start = (min_date - pd.Timedelta(days=2)).strftime("%Y-%m-%d")
    end = (max_date + pd.Timedelta(days=2)).strftime("%Y-%m-%d")
    print(f"Fetching {symbol} from {start} to {end} ...")

    ticker = yf.Ticker(symbol)
    hist = ticker.history(start=start, end=end, interval="1d")[["Open", "High", "Low", "Close"]]

    if hist.empty:
        print(f"No Yahoo data for {symbol}, skipping...")
        continue

    hist = hist.reset_index()
    hist['Date'] = pd.to_datetime(hist['Date']).dt.tz_localize(None).dt.normalize()
    hist = hist.rename(columns={
        "Open": "open_value",
        "High": "high_value",
        "Low": "low_value",
        "Close": "close_value",
    })

    merged = symbol_rows.merge(
        hist[['Date', 'open_value', 'high_value', 'low_value', 'close_value']],
        left_on='record_date', right_on='Date', how='left'
    )

    for _, r in merged.iterrows():
        if pd.isna(r['open_value']):
            continue

        updates.append({
            "id": r['id'],
            "symbol": r['symbol'],
            "open_value": float(r['open_value']),
            "high_value": float(r['high_value']),
            "low_value": float(r['low_value']),
            "close_value": float(r['close_value'])
        })

print(f"\n✅ Prepared {len(updates)} rows for update")

# ---- STEP 3: Upsert in chunks ----
def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

for chunk in chunks(updates, BATCH_SIZE):
    supabase.table(TABLE).upsert(
        chunk,
        on_conflict="id",
        returning="minimal"
    ).execute()
    print(f"⬆️ Upserted {len(chunk)} rows")

print("\n🎯 Done! ✅")