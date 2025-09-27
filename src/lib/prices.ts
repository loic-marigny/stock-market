// src/lib/prices.ts
export type OHLC = { date: string; close: number };

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
      .then(data => {
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


export const jsonProvider: PriceProvider = {
  async getDailyHistory(symbol: string): Promise<OHLC[]> {
    const tryFetch = async (pathSymbol: string) => {
      const url = fromBase(`history/${pathSymbol}.json`);
      const arr = await fetchJSON<OHLC[]>(url);
      arr.sort((a,b)=> a.date.localeCompare(b.date));
      return arr;
    };
    try {
      return await tryFetch(symbol);
    } catch {
      try {
        const enc = encodeURIComponent(symbol);
        if (enc !== symbol) {
          return await tryFetch(enc);
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
  }
};

export default jsonProvider;
