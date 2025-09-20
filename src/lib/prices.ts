// src/lib/prices.ts
export type OHLC = { date: string; close: number };

export interface PriceProvider {
  getDailyHistory(symbol: string): Promise<OHLC[]>; // trié par date croissante
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
      const qurl = fromBase(`quotes.json`);
      const q = await fetchJSON<Record<string,{last:number}>>(qurl);
      const v = (q as any)?.[symbol]?.last;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    } catch {}
    const hist = await this.getDailyHistory(symbol);
    return hist.at(-1)?.close ?? 0;
  }
};

export default jsonProvider;

