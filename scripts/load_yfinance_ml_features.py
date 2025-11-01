import yfinance as yf
import pandas as pd

# ---  Load the ticker ---
ticker = yf.Ticker("AAPL")

# ---  Get OHLCV data (1 year, daily) ---
ohlcv = ticker.history(period="1y", interval="1d")[["Open", "High", "Low", "Close", "Volume"]]
ohlcv.reset_index(inplace=True)
ohlcv["Symbol"] = "AAPL"

# ---  Get key fundamental and contextual data ---
info = ticker.info

fundamentals = {
    "symbol": "AAPL",
    "displayName": info.get("shortName"),
    "marketCap": info.get("marketCap"),
    "beta": info.get("beta"),
    "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
    "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
    "allTimeHigh": info.get("allTimeHigh"),
    "allTimeLow": info.get("allTimeLow"),
    "trailingPE": info.get("trailingPE"),
    "trailingEps": info.get("trailingEps"),
    "totalRevenue": info.get("totalRevenue"),
    "totalDebt": info.get("totalDebt"),
    "totalCash": info.get("totalCash"),
    "operatingCashflow": info.get("operatingCashflow"),
    "freeCashflow": info.get("freeCashflow"),
    "sector": info.get("sector"),
    "industry": info.get("industry")
}

fundamentals_df = pd.DataFrame([fundamentals])

# ---  Display or store the results ---
print("OHLCV (1 year):")
print(ohlcv.head())

print("\nFundamentals:")
print(fundamentals_df)
