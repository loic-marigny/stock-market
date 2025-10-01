import os
import json
import psycopg2
from psycopg2.extras import execute_values

# PostgreSQL connection info
DB_HOST = "localhost"  # or your DB server IP
DB_NAME = "postgres"  # change this
DB_USER = "postgres"  # change this
DB_PASSWORD = "123sss123"  # change this
DB_PORT = "5432"  # your port

# Folder containing your JSON files
FILE_PATH = "../public/companies/index.json"

# Connect to PostgresSQL
conn = psycopg2.connect(
    host=DB_HOST,
    dbname=DB_NAME,
    user=DB_USER,
    password=DB_PASSWORD,
    port=DB_PORT
)
cur = conn.cursor()

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

empty_file = True
with open(FILE_PATH, "r", encoding="utf-8") as f:
    try:
        data = json.load(f)
        empty_file = False
    except json.JSONDecodeError:
        print(f"Skipping invalid or empty JSON file")

values = []

if data:
    for company in data:
        # Prepare data for insertion
        symbol = company["symbol"]
        name = company["name"]
        market_code = company.get("market", "")
        market = map_market(market_code)
        sector = company["sector"]
        profile = company["profile"]
        logo = company["logo"]
        history = company["history"]

        values = [(symbol, name, sector, market_code, market, profile, logo, history)]

        # Insert into schema.table
        execute_values(
            cur,
            'INSERT INTO "rtu-university".stock_market_companies(symbol, name, sector, market_code, market, profile, logo, history) VALUES %s',
            values
        )

# Commit and close connection
conn.commit()
cur.close()
conn.close()
