// src/lib/prices.ts
export type OHLC = { date: string; open: number; high: number; low: number; close: number };

export interface PriceProvider {
  getDailyHistory(symbol: string): Promise<OHLC[]>; // sorted in ascending date order
  getLastPrice(symbol: string): Promise<number>;
}

function fromBase(path: string): string {
  const b = (import.meta as any).env?.BASE_URL || "/";
  const base = String(b);
  const p = path.startsWith("/") ? path.slice(1) : path;
  return base.endsWith("/") ? `${base}${p}` : `${base}/${p}`;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return res.json();
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeCandle(entry: any): OHLC | null {
  const date = typeof entry?.date === "string" ? entry.date : null;
  if (!date) return null;

  const close = toNumber(entry?.close);
  if (close === null) return null;

  let open = toNumber(entry?.open);
  let high = toNumber(entry?.high);
  let low = toNumber(entry?.low);

  if (open === null) open = close;
  if (high === null) high = Math.max(open, close);
  if (low === null) low = Math.min(open, close);

  high = Math.max(high, open, close);
  low = Math.min(low, open, close);

  if (low > high) {
    const tmp = low;
    low = high;
    high = tmp;
  }

  return { date, open, high, low, close };
}

function legacyToCandles(entries: Array<{ date: string; close: number }>): OHLC[] {
  const out: OHLC[] = [];
  for (const entry of entries) {
    const candle = normalizeCandle(entry);
    if (candle) out.push(candle);
  }
  return out;
}

const QUOTES_TTL_MS = 60_000;
let cachedQuotes: Record<string, { last: number }> | null = null;
let quotesFetchedAt = 0;
let quotesPromise: Promise<Record<string, { last: number }>> | null = null;

async function loadQuotes(): Promise<Record<string, { last: number }>> {
  const now = Date.now();
  if (cachedQuotes && now - quotesFetchedAt < QUOTES_TTL_MS) {
    return cachedQuotes;
  }
  if (!quotesPromise) {
    const qurl = fromBase(`quotes.json`);
    quotesPromise = fetchJSON<Record<string, { last: number }>>(qurl)
      .then((data) => {
        cachedQuotes = data;
        quotesFetchedAt = Date.now();
        return data;
      })
      .finally(() => {
        quotesPromise = null;
      });
  }
  const currentPromise = quotesPromise;
  if (!currentPromise) {
    if (cachedQuotes) return cachedQuotes;
    return {};
  }
  try {
    return await currentPromise;
  } catch (err) {
    if (cachedQuotes) {
      return cachedQuotes;
    }
    throw err;
  }
}

async function fetchCandlesForSymbol(pathSymbol: string): Promise<OHLC[]> {
  const tryOhlc = async () => {
    const url = fromBase(`history_ohlc/${pathSymbol}.json`);
    const raw = await fetchJSON<any[]>(url);
    const normalized = raw
      .map((entry) => normalizeCandle(entry))
      .filter((entry): entry is OHLC => !!entry)
      .sort((a, b) => a.date.localeCompare(b.date));
    return normalized;
  };

  const tryLegacy = async () => {
    const url = fromBase(`history/${pathSymbol}.json`);
    const raw = await fetchJSON<Array<{ date: string; close: number }>>(url);
    const normalized = legacyToCandles(raw).sort((a, b) => a.date.localeCompare(b.date));
    return normalized;
  };

  try {
    const ohlc = await tryOhlc();
    if (ohlc.length) return ohlc;
  } catch {
    // ignore and fall back to legacy path
  }

  return tryLegacy();
}

export const jsonProvider: PriceProvider = {
  async getDailyHistory(symbol: string): Promise<OHLC[]> {
    try {
      return await fetchCandlesForSymbol(symbol);
    } catch {
      try {
        const enc = encodeURIComponent(symbol);
        if (enc !== symbol) {
          return await fetchCandlesForSymbol(enc);
        }
      } catch {}
      return [];
    }
  },
  async getLastPrice(symbol: string): Promise<number> {
    try {
      const quotes = await loadQuotes();
      const entry = (quotes as any)?.[symbol];
      const v = entry?.last;
      if (typeof v === "number" && Number.isFinite(v)) return v;
    } catch {}
    const hist = await this.getDailyHistory(symbol);
    return hist.at(-1)?.close ?? 0;
  },
};

export default jsonProvider;
