from supabase import create_client, Client
import psycopg2

# -------------------------------
# Supabase Config
# -------------------------------
SUPABASE_URL = "https://HOST.supabase.co"  # from Supabase Project Settings
SUPABASE_KEY = "SERVICE_ROLE_KEY"  # ⚠️ Use the service_role key, not anon key
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# -------------------------------
# Local Postgres Config
# -------------------------------
LOCAL_CONN = psycopg2.connect(
    host="localhost",
    dbname="postgres",
    user="postgres",
    password="123sss123",
    port="5432"
)
local_cur = LOCAL_CONN.cursor()

# -------------------------------
# Fetch data from local Postgres
# -------------------------------
local_cur.execute('''
    SELECT symbol, name, sector, market_code, market, profile, logo, history 
    FROM "rtu-university".stock_market_companies
''')
rows = local_cur.fetchall()

# Convert into list of dicts for Supabase
columns = [desc[0] for desc in local_cur.description]
data = [dict(zip(columns, row)) for row in rows]

# -------------------------------
# Insert into Supabase
# -------------------------------
for chunk_start in range(0, len(data), 100):  # insert in batches of 100
    chunk = data[chunk_start:chunk_start + 100]
    supabase.table("stock_market_companies").upsert(chunk).execute()

print("✅ Migration completed successfully!")

# -------------------------------
# Close connections
# -------------------------------
local_cur.close()
LOCAL_CONN.close()
