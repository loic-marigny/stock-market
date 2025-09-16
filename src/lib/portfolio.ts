// src/lib/portfolio.ts
export type Side = 'buy' | 'sell';
export type Order = { symbol: string; side: Side; qty: number; fillPrice: number; ts: any };

export type Position = { qty: number; avgPrice: number };

export function computePositions(orders: Order[]): Record<string, Position> {
  const pos: Record<string, Position> = {};
  for (const o of orders) {
    const p = pos[o.symbol] ?? { qty: 0, avgPrice: 0 };
    if (o.side === 'buy') {
      const totalCost = p.avgPrice * p.qty + o.fillPrice * o.qty;
      const newQty = p.qty + o.qty;
      pos[o.symbol] = { qty: newQty, avgPrice: newQty ? totalCost / newQty : 0 };
    } else {
      const newQty = p.qty - o.qty;
      pos[o.symbol] = { qty: newQty, avgPrice: newQty > 0 ? p.avgPrice : 0 };
    }
  }
  return pos;
}

export function computeCash(initialCredits: number, orders: Order[]): number {
  let cash = initialCredits;
  for (const o of orders) {
    const v = o.qty * o.fillPrice;
    cash += o.side === 'sell' ? v : -v;
  }
  return cash;
}
