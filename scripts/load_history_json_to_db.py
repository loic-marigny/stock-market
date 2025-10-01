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
FOLDER_PATH = "../public/history/"

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
for filename in os.listdir(FOLDER_PATH):
    if filename.endswith(".json"):
        file_path = os.path.join(FOLDER_PATH, filename)

        empty_file = True
        with open(file_path, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
                empty_file = False
            except json.JSONDecodeError:
                print(f"Skipping invalid or empty JSON file: {filename}")

        values = []

        if empty_file:
            values = [(filename, None, None)]
        else:
            # Prepare data for insertion
            values = [(os.path.splitext(filename)[0], item["date"], item["close"]) for item in data]

        # Insert into schema.table
        execute_values(
            cur,
            'INSERT INTO "rtu-university".stock_market_history(symbol, record_date, record_value) VALUES %s',
            values
        )

# Commit and close connection
conn.commit()
cur.close()
conn.close()
