import json
import psycopg2

# PostgreSQL connection info
DB_HOST = "localhost"  # or your DB server IP
DB_NAME = "postgres"  # change this
DB_USER = "postgres"  # change this
DB_PASSWORD = "123sss123"  # change this
DB_PORT = "5432"  # your port

# Connect to PostgreSQL
conn = psycopg2.connect(
    dbname=DB_NAME,
    user=DB_USER,
    password=DB_PASSWORD,
    host=DB_HOST,  # or your Supabase/Cloud host
    port=DB_PORT
)
cur = conn.cursor()

# Folder containing your JSON files
FOLDER_PATH = "../public/history/"

# Path to your JSON file
json_file = "../data/tickers.json"

# Dictionary mapping
MARKET_MAP = {
    "US": "New York",
    "CN": "Shanghai",
    "EU": "Euronext",
    "JP": "Tokyo",
    "SA": "Saudi Arabia",
    "CRYPTO": "Crypto",
    "FX": "Forex",
    "FOREX": "Forex",
    "COM": "Commodities",
    "IDX": "Indices"
}


def map_market(code: str) -> str:
    if not code:
        return "Other"
    return MARKET_MAP.get(code.upper(), code.upper() or "Other")


# Load JSON data
with open(json_file, "r", encoding="utf-8") as f:
    companies = json.load(f)

# Update each company with its market
for company in companies:
    symbol = company["symbol"]
    code = company.get("market", "")
    market = map_market(code)

    cur.execute("""
        UPDATE "rtu-university".stock_market_companies
        SET market_code = %s, market = %s
        WHERE symbol = %s
    """, (code, market, symbol))

conn.commit()
cur.close()
conn.close()

print("✅ Market column updated successfully!")
