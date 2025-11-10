import type { Order } from "./portfolio";

const EPSILON = 1e-9;

export type Lot = {
  symbol: string;
  qty: number;
  price: number;
  ts: Date;
};

export type PositionRow = {
  id: string;
  symbol: string;
  qty: number;
  buyPrice: number;
  buyValue: number;
  buyDate: Date;
  last: number;
  value: number;
  pnlAbs: number;
  pnlPct: number;
};

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

export function toDate(raw: any): Date {
  if (!raw) return new Date(0);
  if (raw instanceof Date) return raw;
  if (typeof raw === "number") return new Date(raw);
  if (typeof raw === "string") return new Date(raw);
  if (typeof raw.toDate === "function") {
    const converted = raw.toDate();
    if (converted instanceof Date) return converted;
    return new Date(converted);
  }
  return new Date(raw ?? 0);
}

export function buildOpenLots(orders: Order[]): Lot[] {
  if (!orders.length) return [];

  const sorted = [...orders].sort(
    (a, b) => toDate(a.ts).getTime() - toDate(b.ts).getTime(),
  );
  const perSymbol = new Map<string, Lot[]>();

  for (const order of sorted) {
    const queue = perSymbol.get(order.symbol) ?? [];
    if (!perSymbol.has(order.symbol)) perSymbol.set(order.symbol, queue);
    const ts = toDate(order.ts);

    if (order.side === "buy") {
      queue.push({
        symbol: order.symbol,
        qty: round6(order.qty),
        price: order.fillPrice,
        ts,
      });
      continue;
    }

    let remaining = round6(order.qty);
    while (remaining > EPSILON && queue.length) {
      const lot = queue[0];
      if (lot.qty > remaining + EPSILON) {
        lot.qty = round6(lot.qty - remaining);
        remaining = 0;
      } else {
        remaining = round6(remaining - lot.qty);
        queue.shift();
      }
    }
  }

  const lots: Lot[] = [];
  for (const queue of perSymbol.values()) {
    for (const lot of queue) {
      if (lot.qty > EPSILON) {
        lots.push({ ...lot });
      }
    }
  }

  return lots.sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

export function buildPositionRows(
  lots: Lot[],
  prices: Record<string, number>,
): PositionRow[] {
  return lots
    .map((lot, index) => {
      const last = prices[lot.symbol] ?? 0;
      const value = lot.qty * last;
      const buyValue = lot.qty * lot.price;
      const pnlAbs = (last - lot.price) * lot.qty;
      const pnlPct = lot.price ? (last / lot.price - 1) * 100 : 0;
      return {
        id: `${lot.symbol}-${lot.ts.toISOString()}-${index}`,
        symbol: lot.symbol,
        qty: lot.qty,
        buyPrice: lot.price,
        buyValue,
        buyDate: lot.ts,
        last,
        value,
        pnlAbs,
        pnlPct,
      };
    })
    .sort((a, b) => {
      const sym = a.symbol.localeCompare(b.symbol);
      if (sym !== 0) return sym;
      return a.buyDate.getTime() - b.buyDate.getTime();
    });
}

export function formatCompactValue(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
