import os
import pandas as pd
import yfinance as yf
from supabase import create_client

# ==========================================
# CONFIGURATION & CONSTANTS
# ==========================================
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
# IMPORTANT: Must use SERVICE_ROLE key to bypass RLS (Row Level Security) for inserts
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Table names based on Supabase schema
TABLE_COMPANIES = "stock_market_companies"
TABLE_HISTORY = "stock_market_history"

BATCH_SIZE = 1000 

# ==========================================
# HELPER FUNCTIONS
# ==========================================

def get_supabase_client():
    """Initializes and returns the Supabase client."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: Missing environment variables (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).")
        return None
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def fetch_tickers(supabase):
    """Retrieves the list of existing tickers from the companies table."""
    print("Fetching tickers from Supabase...")
    try:
        response = supabase.table(TABLE_COMPANIES).select("symbol").execute()
        # Extract symbols and remove duplicates
        tickers = [item['symbol'] for item in response.data if item.get('symbol')]
        return list(set(tickers))
    except Exception as e:
        print(f"Supabase Fetch Error: {e}")
        return []

def prepare_history_records(symbol, df):
    """
    Transforms the yfinance DataFrame into a list of dictionaries
    matching the 'stock_market_history' table structure.
    """
    if df is None or df.empty:
        return []

    records = []
    # Reset index to ensure 'Date' is available as a column
    df = df.reset_index()
    
    for _, row in df.iterrows():
        # Convert date to ISO string format (YYYY-MM-DD)
        date_str = row['Date'].strftime('%Y-%m-%d')
        
        # Exact mapping to your Supabase table columns
        record = {
            "symbol": symbol,
            "record_date": date_str,
            "open_value": round(float(row['Open']), 2),
            "high_value": round(float(row['High']), 2),
            "low_value": round(float(row['Low']), 2),
            "close_value": round(float(row['Close']), 2),
            # Using 'Close' as the generic record_value
            "record_value": round(float(row['Close']), 2) 
        }
        records.append(record)
        
    return records

# ==========================================
# MAIN EXECUTION
# ==========================================

def main():
    # 1. Connect to Database
    supabase = get_supabase_client()
    if not supabase: return

    # 2. Get Tickers
    tickers = fetch_tickers(supabase)
    if not tickers:
        print("No tickers found in database.")
        return

    print(f"Processing {len(tickers)} companies...")

    # 3. Batch Download Data (2 days history)
    try:
        # 'auto_adjust=True' is default in new yfinance versions
        raw_data = yf.download(
            tickers, 
            period="5d", 
            group_by='ticker', 
            threads=True, 
            timeout=30
        )
    except Exception as e:
        print(f"Critical Download Error: {e}")
        return

    all_records = []

    # 4. Process Data
    print("Formatting data...")
    is_multi_ticker = len(tickers) > 1

    for symbol in tickers:
        try:
            if is_multi_ticker:
                # If ticker failed to download, it won't be in columns
                if symbol not in raw_data.columns.levels[0]:
                    continue
                df_sym = raw_data[symbol]
            else:
                df_sym = raw_data

            # Drop rows with missing values (NaN)
            df_sym = df_sym.dropna()
            
            # Create records for this specific symbol
            symbol_records = prepare_history_records(symbol, df_sym)
            all_records.extend(symbol_records)
            
        except Exception as e:
            print(f"Error processing {symbol}: {e}")
            continue

    # 5. Batch Upsert to Supabase
    total_records = len(all_records)
    print(f"\nUploading {total_records} history records to Supabase...")

    for i in range(0, total_records, BATCH_SIZE):
        batch = all_records[i : i + BATCH_SIZE]
        try:
            # Perform UPSERT based on conflict on (symbol, record_date)
            supabase.table(TABLE_HISTORY).upsert(
                batch, 
                on_conflict='symbol, record_date'
            ).execute()
            print(f"Batch {i}-{i+len(batch)} uploaded successfully.")
        except Exception as e:
            print(f"Batch Upload Error (Index {i}): {e}")

    print("\nSYNC COMPLETED SUCCESSFULLY!")

if __name__ == "__main__":
    main()