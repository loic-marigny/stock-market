import os
import json
import random
import requests
import pandas as pd
import yfinance as yf
from supabase import create_client, Client

# ==========================================
# CONFIGURATION & CONSTANTS
# ==========================================
# User-Agent to mimic a real browser for scraping
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
}

# Supabase Credentials (from environment variables)
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY")
TABLE_NAME = "stock_market_companies"
BATCH_SIZE = 50

# ==========================================
# PART 1: PROXY SCRAPING LOGIC
# ==========================================

def get_free_proxy_list():
    """Scrapes free-proxy-list.net for HTTPS proxies."""
    url = "https://free-proxy-list.net/"
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        tables = pd.read_html(r.text)
        df = tables[0]
        df = df[df['Https'] == 'yes']  # Filter for HTTPS
        return [f"http://{row['IP Address']}:{row['Port']}" for _, row in df.iterrows()]
    except Exception:
        return []

def get_proxydb_list():
    """Scrapes proxydb.net for HTTPS proxies."""
    url = "https://proxydb.net/?anonlvl=4&country=&protocol=https&sort_column_id=uptime&sort_order_desc=true"
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        tables = pd.read_html(r.text)
        proxies = []
        for _, row in tables[0].iterrows():
            # Handle port parsing
            port = str(row['Port']).split(' ')[-1] if ' ' in str(row['Port']) else str(row['Port'])
            proxies.append(f"http://{str(row['IP'])}:{port}")
        return proxies
    except Exception:
        return []

def get_github_iplocate_list():
    """Fetches raw proxy list from GitHub."""
    url = "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/protocols/https.txt"
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            return [f"http://{line.strip()}" for line in r.text.splitlines() if ":" in line]
    except Exception:
        pass
    return []

def find_working_proxy():
    """
    Aggregates proxies and tests them against Yahoo Finance 
    to find a single working 'champion'.
    """
    print("\nGathering HTTPS proxies...")
    
    # Aggregate and remove duplicates using set()
    raw_list = get_free_proxy_list() + get_proxydb_list() + get_github_iplocate_list()
    proxies = list(set(raw_list))
    
    print(f"Found {len(proxies)} unique proxies. Testing for a champion...")

    # Shuffle to randomize the search
    random.shuffle(proxies)
    # Add Direct Connection (None) as a fallback at the end
    proxies.append(None)

    test_ticker = "AAPL"
    
    # Limit attempts to save time (first 25)
    for i, proxy_url in enumerate(proxies[:25]):
        display = proxy_url if proxy_url else "DIRECT CONNECTION"
        print(f"Attempt {i+1}: {display}... ", end="")
        
        try:
            # Test a small request with a short timeout
            ticker = yf.Ticker(test_ticker)
            hist = ticker.history(period="1d", proxy=proxy_url, timeout=5)
            
            if not hist.empty:
                print("SUCCESS!")
                return proxy_url
            else:
                print("Empty response.")
        except Exception:
            print("Failed.")
            
    print("\n⚠️ No working proxy found. Defaulting to direct connection.")
    return None

# ==========================================
# PART 2: SUPABASE & DATA PROCESSING
# ==========================================

def get_supabase_client():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: Missing SUPABASE_URL or SUPABASE_KEY.")
        return None
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def fetch_tickers(supabase):
    """Retrieves existing tickers from the database."""
    print("Fetching tickers from Supabase...")
    try:
        response = supabase.table(TABLE_NAME).select("symbol").execute()
        return [item['symbol'] for item in response.data if item.get('symbol')]
    except Exception as e:
        print(f"Supabase Error: {e}")
        return []

def format_history_data(df_symbol):
    """Formats a Pandas DataFrame into a JSON-serializable list of dicts."""
    try:
        df_clean = df_symbol[['Close']].dropna().reset_index()
        df_clean.columns = ['date', 'close']
        df_clean['date'] = df_clean['date'].dt.strftime('%Y-%m-%d')
        return df_clean.to_dict('records')
    except Exception:
        return None

# ==========================================
# MAIN EXECUTION
# ==========================================

def main():
    # 1. Connect to Database
    supabase = get_supabase_client()
    if not supabase: return

    tickers = fetch_tickers(supabase)
    if not tickers:
        print("No tickers found in database.")
        return

    # 2. Proxy Selection
    champion_proxy = find_working_proxy()
    if champion_proxy:
        print(f"\n Selected Proxy: {champion_proxy}")

    # 3. Batch Download (yfinance)
    print(f"\n Batch downloading data for {len(tickers)} companies...")
    try:
        # Download 2 years of data for all tickers at once
        raw_data = yf.download(
            tickers, 
            period="2y", 
            interval="1d", 
            group_by='ticker', 
            threads=True,
            proxy=champion_proxy
        )
    except Exception as e:
        print(f"Critical Download Error: {e}")
        return

    # 4. Process and Buffer Updates
    print(f"\n Processing data...")
    updates_buffer = []
    
    for symbol in tickers:
        try:
            # Handle yfinance MultiIndex structure
            if len(tickers) == 1:
                df_sym = raw_data
            else:
                if symbol not in raw_data.columns.levels[0]: continue
                df_sym = raw_data[symbol]

            history_json = format_history_data(df_sym)
            
            if history_json:
                updates_buffer.append({
                    "symbol": symbol,
                    "history": history_json
                })
        except Exception:
            continue

    # 5. Batch Upsert to Supabase
    total = len(updates_buffer)
    print(f"Uploading {total} records to Supabase...")
    
    for i in range(0, total, BATCH_SIZE):
        chunk = updates_buffer[i : i + BATCH_SIZE]
        try:
            supabase.table(TABLE_NAME).upsert(chunk).execute()
            print(f"Batch {i}-{i+len(chunk)} uploaded.")
        except Exception as e:
            print(f"Batch Error {i}: {e}")

    print("\n SYNC COMPLETED SUCCESSFULLY!")

if __name__ == "__main__":
    main()