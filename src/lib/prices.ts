// src/lib/prices.ts
export type OHLC = { date: string; close: number };

export interface PriceProvider {
  getDailyHistory(symbol: string): Promise<OHLC[]>; // trié par date croissante
  getLastPrice(symbol: string): Promise<number>;
}

// --- MOCK: random walk (même API qu'une vraie source) ---
function genSeries(seed = 1, days = 3 * 365, start = 100): OHLC[] {
  const rng = mulberry32(seed);
  const out: OHLC[] = [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  let px = start;
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate); d.setDate(startDate.getDate() + i);
    // drift léger + bruit
    const drift = 0.0002;          // ≈ 5% annuel
    const vol = 0.012;             // ≈ 19% annuel
    const r = drift + vol * (rng() - 0.5);
    px = Math.max(0.5, px * (1 + r));
    out.push({ date: d.toISOString().slice(0,10), close: Number(px.toFixed(2)) });
  }
  return out;
}
function mulberry32(a:number){ return function(){ let t=(a+=0x6D2B79F5); t=Math.imul(t ^ t>>>15, t|1); t^=t+Math.imul(t ^ t>>>7, t|61); return ((t ^ t>>>14)>>>0)/4294967296; } }

// Minimal catalogue for US large caps
const SEED: Record<string, number> = {
  "AAPL": 7, "MSFT": 11, "AMZN": 13, "GOOGL": 17, "NVDA": 19, "TSLA": 23,
};

export const mockProvider: PriceProvider = {
  async getDailyHistory(symbol: string) {
    const s = SEED[symbol] ?? 1;
    return genSeries(s, 5 * 365, 100 + (s % 5) * 25);
  },
  async getLastPrice(symbol: string) {
    const h = await this.getDailyHistory(symbol);
    return h.at(-1)?.close ?? 0;
  }
};

export default mockProvider;
