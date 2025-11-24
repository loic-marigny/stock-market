# Scripts Reference

This document inventories every file under the `scripts/` directory, highlights their purpose, required dependencies, and their current maintenance status. Use it to decide which tool to run, which ones to modernize, and which ones are merely historical artifacts.

## Quick Index

| Path | Primary role | Status |
| --- | --- | --- |
| `scripts/build_companies_index.py` | Generates `public/companies/index.json` and skeleton profiles from `data/tickers.json`. | Active |
| `scripts/check_history.py` | Lists symbols whose history JSON lacks coverage. | Active |
| `scripts/debug_companies.mjs` | Prints a handful of Supabase rows for manual inspection. | Utility |
| `scripts/history.py` | Produces close-only daily history JSON via Cloudflare Yahoo worker or Finnhub fallback. | Active |
| `scripts/history_local.py` | Local-only variant that hits Yahoo (yfinance) directly. | Local helper |
| `scripts/history_ohlc.py` | Same as `history.py` but keeps full OHLC candles under `public/history_ohlc`. | Active |
| `scripts/history_usage.txt` | Mini manual for `history.py`. | Doc |
| `scripts/load_companies_json_to_db*.py` | Push company JSON into a Postgres schema. | Legacy / manual |
| `scripts/load_history_json_to_db.py` | Bulk-loads `public/history/*.json` into Postgres. | Legacy / manual |
| `scripts/quotes.py` | Refreshes `data/quotes.json` and `public/quotes.json` using Finnhub plus regional fallbacks. | Active |
| `scripts/sync_fundamentals.py` | Fetches financial metrics (PE, Market Cap, ATH) via yfinance & upserts to Supabase. | Active |
| `scripts/sync_history_supabase.py` | Batched yfinance sync that upserts recent OHLC data directly to Supabase. | Active |
| `scripts/update_company_profiles.py` | Enriches `public/companies/*/profile.json` via the Yahoo worker. | Active |
| `scripts/migration/supabase_migration.py` | Copies a local Postgres table into Supabase. | Legacy |
| `scripts/public/` | Placeholder for public-facing helper scripts (currently empty). | Unused |
| `scripts/yahoo/` | Standalone yfinance + Supabase prototypes. | Experimental |
| `scripts/yahoo_payloads/` | Empty JSON fixtures kept for documenting Yahoo worker payloads. | Reference |

The sections below expand on each group and include caveats and usage advice.

## 1. Catalog Builders & Debug Utilities

### `build_companies_index.py` (active)
Reads `data/tickers.json`, ensures every symbol has a folder in `public/companies/{SYMBOL}`, backfills a minimal `profile.json` when missing, and regenerates `public/companies/index.json`. The script purposely skips existing profile files to avoid clobbering manually curated data. Requires no APIs, just read/write access to `data/` and `public/`.

### `check_history.py` (active)
Imports helper logic from `history.py` to detect symbols missing the required one-year coverage. Its output (a comma-separated list) is consumed by CI jobs before calling `scripts/history.py`. Only dependency is Python’s stdlib plus whatever `history.py` imports.

### `debug_companies.mjs` (utility)
Small Node/ESM script that uses `@supabase/supabase-js` and the `VITE_SUPABASE_*` env vars to fetch the first five rows from the `stock_market_companies` table. Useful for sanity checks during development; not referenced anywhere else.

## 2. Historical Data Pipelines

### `sync_history_supabase.py` (active)
The modern, optimized synchronization script designed for frequent CI runs (e.g., every 15 minutes).
1. Fetches the list of active tickers directly from Supabase.
2. Uses `yfinance` in **batched mode** to download the last 5 days of OHLC data for all tickers in a single request (avoiding rate limits caused by iteration).
3. Upserts the data directly into the `stock_market_history` table in supabase.
*Note: This script replaces the need for local JSON history files when using Supabase as the primary backend.*

### `history.py` (active)
The main close-only refresher. It enforces at least `MIN_YEARS` (1) of daily closes per symbol, stores output under `public/history/{SYMBOL}.json`, and can fetch data via:

1. `YAHOO_WORKER_URL` + optional `YAHOO_WORKER_TOKEN` (preferred path, hits the Cloudflare worker).
2. Finnhub (`FINNHUB_API_KEY` or `FINNHUB_TOKEN`) as a paid fallback.
3. Additional providers (Akshare, requests with randomized headers) when worker/Finnhub fail.

Command-line usage is documented in `scripts/history_usage.txt`. The script logs each HTTP request, merges new candles with existing JSON, and is wired into GitHub workflows such as `.github/workflows/update-history.yml`.

### `history_usage.txt` (doc)
A short CLI reference for `history.py`, detailing the `--symbols` and `--limit` flags. Keep it synced when the script gains new arguments.

### `history_local.py` (local helper)
A reduced, yfinance-powered variant meant to be run manually (never in CI). Pass `--symbols` to restrict the coverage or `--years` to fetch deeper history. Useful when worker tokens are unavailable.

### `history_ohlc.py` (active)
Blueprint identical to `history.py` but writes the full OHLC payload to `public/history_ohlc`. It uses the same provider priority (Yahoo worker → Finnhub → Akshare) and has additional helpers to sanitize missing open/high/low values. The file is large because it contains many data-cleaning utilities and fallback heuristics.

### `scripts/yahoo/load_history_ohlc_data.py` (experimental)
Standalone yfinance routine that scans the `stock_market_history` table for rows missing OHLC data, fetches the missing range via yfinance, and writes the values back to Supabase. It batches rows manually and assumes credentials are hard-coded in the file. Treat it as a throwaway ETL prototype.

## 3. Company Metadata Enrichment

### `sync_fundamentals.py` (active)
Runs daily via GitHub Actions (`update_fundamentals.yml`) to populate the `company_fundamentals` table in Supabase.
1. Iterates through all symbols one by one.
2. Fetches detailed metrics via `yfinance.Ticker().info`.
3. **Calculates fallbacks**: Computes All-Time High/Low from full history and estimates Market Cap (Price * Shares) if Yahoo returns null.
4. Performs a **partial upsert**: It filters out `None` values to avoid overwriting existing data with nulls.
5. Implements a **random sleep** (2-3s) between requests to avoid rate-limiting, as this script does not use proxies.

### `update_company_profiles.py` (active)
Pulls metadata (`longBusinessSummary`, websites, risk metrics, etc.) from the Yahoo worker and patches `public/companies/{SYMBOL}/profile.json` while keeping existing keys. Requires `YAHOO_WORKER_URL` (and optionally `YAHOO_WORKER_TOKEN`) plus `data/tickers.json` as the symbol source.

### `scripts/yahoo/load_company_metadata.py` (experimental)
Another Supabase+yfinance helper. It locates rows missing `industry` or `website` info and upserts updates in batches of 1,000. Everything – including Supabase credentials – is inline, so treat this as a one-off script rather than production code.

### `scripts/yahoo/load_yfinance_ml_features.py` (experimental)
A quick Jupyter-style snippet that fetches one year of OHLCV data and a handful of fundamentals for a single ticker (hard-coded to `AAPL`). Intended for prototyping ML features rather than automated pipelines.

### `scripts/yahoo_payloads/` (reference)
Contains placeholder JSON files (each only includes a UTF-8 BOM) for various Yahoo tickers and indices. They serve as documentation of expected payload names rather than usable data.

## 4. Quote Refreshers

### `quotes.py` (active)
Refreshes both `data/quotes.json` and `public/quotes.json`. It fetches last prices via Finnhub (`FINNHUB_API_KEY`), optionally Alltick for some CN tickers, and includes helper logic to skip markets that are currently closed. Dependencies include `requests`, `pandas`, `akshare`, and Python 3.11’s `zoneinfo`. Expect ~1 request per symbol, so throttle the run in CI.

## 5. Database Loaders & Migration Tools (legacy)

These Python scripts push JSON files into Postgres tables using hard-coded credentials. They pre-date the Supabase pipelines and should only be run manually in controlled environments.

- `load_companies_json_to_db.py`: walks `public/companies/*/*.json` and inserts `symbol`, `name`, `sector`. Does not deduplicate rows or handle schema changes.
- `load_companies_json_to_db_v2.py`: newer attempt that ingests `public/companies/index.json`, maps `market_code` → readable `market`, and writes additional columns. Still loops row-by-row and lacks upserts.
- `load_history_json_to_db.py`: reads every `public/history/*.json` file and inserts (symbol, record_date, close). Will happily duplicate data if run twice.
- `migration/supabase_migration.py`: copies rows from a local Postgres schema (`"rtu-university".stock_market_companies`) into Supabase using the service-role key. Credentials are placeholders; swap them before running.

Because these scripts were written quickly and never hardened (no retries, no secrets management, no schema migrations), treat them as references. If you need a repeatable ingestion flow, prefer Supabase’s SQL importers or rewrite them with proper configuration.

## 6. Miscellaneous Helpers

- `history_usage.txt`: see Section 2.
- `scripts/public/`: empty folder kept for future public-oriented helpers.

## 7. Best Practices

1. **Virtual environments** – None of the scripts pin dependencies, so use a dedicated venv per run (`python -m venv .venv && .venv/Scripts/activate`).
2. **Secrets** – Replace the inline placeholders (`your_supabase_key`, `123sss123`, etc.) with environment variables or `.env` files before executing any loader.
3. **Dry runs** – Most scripts print which symbols they are touching; interrupt them early if you only need a subset by providing `--symbols` or editing the script.
4. **Version drift** – Duplicate scripts (`load_companies_json_to_db.py` vs. `_v2`) exist because different experiments were captured in git. Prefer the `_v2` variant if you need markets, otherwise the original is slightly simpler.

If you add a new utility under `scripts/`, update this file so the next person understands whether it is production-ready, experimental, or abandoned.