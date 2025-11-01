# pip install supabase yfinance pandas python-dateutil
import time

import yfinance as yf
from supabase import create_client
import pandas as pd

# DB CONFIG
SUPABASE_URL = "your_supabase_url"
SUPABASE_KEY = "your_supabase_key"
TABLE = "stock_market_companies"
all_rows = []
page = 0
BATCH_SIZE = 1000  # tune by API limits

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---- 1) load only rows missing metadata ----
res = (
    supabase.table(TABLE)
    .select("id, symbol, industry, website, ir_website")
    .or_("industry.is.null,website.is.null,ir_website.is.null")  # rows where any is NULL
    .execute()
)

rows = res.data
if not rows:
    print("✅ No missing metadata, everything already filled.")
    raise SystemExit

df = pd.DataFrame(rows)
symbols = df["symbol"].dropna().unique().tolist()

print(f"🔍 Found {len(symbols)} tickers missing profile data")

updates = []

for symbol in symbols:
    print(f"Fetching metadata for {symbol}...")
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info  # full metadata
    except Exception as e:
        print(f"⚠️ Error reading data for {symbol}: {e}, skipping")
        continue

    industry = info.get("industry")
    website = info.get("website")
    ir_website = info.get("irWebsite") or info.get("website")  # fallback if IR not available

    # skip if both industry & website still empty
    if not industry and not website:
        print(f"⚠️ No metadata found for {symbol}, skipping…")

    # get DB ids for this symbol
    symbol_rows = df[df["symbol"] == symbol]

    for _, r in symbol_rows.iterrows():
        updates.append({
            "id": r["id"],
            "symbol": symbol,
            "industry": industry,
            "website": website,
            "ir_website": ir_website
        })

    time.sleep(0.2)  # prevent Yahoo rate-limit

print(f"📝 Prepared {len(updates)} updates.")

# ---- 3) bulk upsert into DB ----
def chunks(lst, size):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]

for chunk in chunks(updates, BATCH_SIZE):
    res = (
        supabase.table(TABLE)
        .upsert(chunk, on_conflict="id", returning="minimal")
        .execute()
    )
    print(f"✅ Upserted {len(chunk)} rows")

print("🎉 Company metadata update complete!")