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
FOLDER_PATH = "../public/companies/"

# Connect to PostgresSQL
conn = psycopg2.connect(
    host=DB_HOST,
    dbname=DB_NAME,
    user=DB_USER,
    password=DB_PASSWORD,
    port=DB_PORT
)
cur = conn.cursor()

# Loop through each JSON file in the folder
for company_folder in os.listdir(FOLDER_PATH):
    subfolder_path = os.path.join(FOLDER_PATH, company_folder)

    # Make sure it's a folder
    if not os.path.isdir(subfolder_path):
        continue

    for filename in os.listdir(subfolder_path):
        if filename.endswith(".json"):
            file_path = os.path.join(subfolder_path, filename)

            empty_file = True
            with open(file_path, "r", encoding="utf-8") as f:
                try:
                    data = json.load(f)
                    empty_file = False
                except json.JSONDecodeError:
                    print(f"Skipping invalid or empty JSON file: {filename}")

            values = []

            if not empty_file:
                # Prepare data for insertion
                values = [(data["symbol"], data["name"], data["sector"])]

                # Insert into schema.table
                execute_values(
                    cur,
                    'INSERT INTO "rtu-university".stock_market_companies(symbol, name, sector) VALUES %s',
                    values
                )

# Commit and close connection
conn.commit()
cur.close()
conn.close()
