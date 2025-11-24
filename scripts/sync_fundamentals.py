import os
import time
import yfinance as yf
from supabase import create_client, Client
from datetime import datetime
import random

# ==========================================
# CONFIGURATION
# ==========================================
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Tables
TABLE_COMPANIES = "stock_market_companies"
TABLE_FUNDAMENTALS = "company_fundamentals"


def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: SUPABASE_URL or SUPABASE_KEY missing.")
        return None
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def fetch_tickers(supabase):
    """Fetches the list of symbols to process"""
    try:
        res = supabase.table(TABLE_COMPANIES).select("symbol").execute()
        return [i['symbol'] for i in res.data if i.get('symbol')]
    except Exception as e:
        print(f"Error fetching tickers: {e}")
        return []

def get_clean_value(val):
    """Cleans None or 'NaN' values returned by Yahoo"""
    if val is None or val == "NaN":
        return None
    return val

def process_company(symbol):
    """Fetches info for ONE company"""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        
        # If Yahoo returns no useful info
        if not info or 'symbol' not in info:
            print(f"No info for {symbol}")
            return None
        
        #Records calculation
        market_cap = get_clean_value(info.get("marketCap"))
        all_time_high = None
        all_time_low = None
        current_price = None

        try:
            hist = ticker.history(period="max", auto_adjust=True)
            if not hist.empty:
                all_time_high = round(hist['Close'].max(), 2)
                all_time_low = round(hist['Close'].min(), 2)
                current_price = hist['Close'].iloc[-1]

                if market_cap is None:
                    shares = info.get('sharesOutstanding')
                    if shares and current_price:
                        market_cap = int(current_price * shares)

        except Exception as e:
            print(f"Error calculating history for {symbol}: {e}")
            # If it fails, leave None, and the filter below will remove it (we keep the old value in the database)

        # Mapping fields
        # Note: allTimeHigh/Low are not always in .info, 
        # we take fiftyTwoWeek if missing or leave null.
        # We build the complete object with potential None values
        raw_data = {
            "symbol": symbol, # Primary key (always required)
            "long_business_summary": get_clean_value(info.get("longBusinessSummary")),
            "market_cap": market_cap,
            "fifty_two_week_high": get_clean_value(info.get("fiftyTwoWeekHigh")),
            "fifty_two_week_low": get_clean_value(info.get("fiftyTwoWeekLow")),
            "all_time_high": all_time_high, 
            "all_time_low": all_time_low,
            "beta": get_clean_value(info.get("beta")),
            "recommendation_mean": get_clean_value(info.get("recommendationMean")),
            "trailing_pe": get_clean_value(info.get("trailingPE")),
            "trailing_eps": get_clean_value(info.get("trailingEps")),
            "total_revenue": get_clean_value(info.get("totalRevenue")),
            "total_debt": get_clean_value(info.get("totalDebt")),
            "total_cash": get_clean_value(info.get("totalCash")),
            "free_cashflow": get_clean_value(info.get("freeCashflow")),
            "operating_cashflow": get_clean_value(info.get("operatingCashflow")),
            "last_updated": datetime.utcnow().isoformat()
        }

        # We keep key only if there are different from None
        # EXCEPT 'symbol' which we always keep to identify the row
        clean_data = {k: v for k, v in raw_data.items() if v is not None}
        
        return clean_data

    except Exception as e:
        print(f"Exception on {symbol}: {e}")
        return None

def main():
    supabase = get_supabase()
    if not supabase: return

    tickers = fetch_tickers(supabase)
    if not tickers:
        print("No tickers found.")
        return

    print(f"{len(tickers)} companies to update.")
    
    # Processing one by one
    for i, symbol in enumerate(tickers):
        print(f" [{i+1}/{len(tickers)}] {symbol}...", end="", flush=True)
        
        data = process_company(symbol)
        
        if data:
            try:
                # Immediate upsert (line by line) because the script is slow
                supabase.table(TABLE_FUNDAMENTALS).upsert(data).execute()
                print(" Saved.")
            except Exception as e:
                print(f" DB Error: {e}")
        else:
            print("Skipped.")

        # CRITICAL PAUSE TO AVOID BAN
        time.sleep(random.uniform(2, 3))

    print("\n Done! All fundamental data is up to date.")

if __name__ == "__main__":
    main()