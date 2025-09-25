// src/routes/Portfolio.tsx
import { useMemo } from "react";
import { auth } from "../firebase";
import type { Position } from "../lib/portfolio";
import { usePortfolioSnapshot } from "../lib/usePortfolioSnapshot";

type Row = {
  symbol: string;
  qty: number;
  avg: number;
  last: number;
  value: number;
  pnlAbs: number;
  pnlPct: number;
};

const EPSILON = 1e-9;

export default function Portfolio(){
  const uid = auth.currentUser?.uid ?? null;
  const { positions, prices, cash, marketValue, totalValue, loadingPrices } = usePortfolioSnapshot(uid);

  const rows: Row[] = useMemo(()=> buildRows(positions, prices), [positions, prices]);

  return (
    <div className="container">
      <h2 className="signin-title" style={{marginTop: 0}}>My portfolio</h2>

      <div className="grid-cards">
        <div className="kpi-card">
          <div className="kpi-k">Cash (USD)</div>
          <div className="kpi-v">{fmt(cash)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-k">Position value</div>
          <div className="kpi-v">{fmt(marketValue)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-k">Total value</div>
          <div className="kpi-v">{fmt(totalValue)}</div>
        </div>
      </div>

      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Symbol</th><th>Qty</th><th>Average price</th><th>Last</th><th>Value</th><th>P&L</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} style={{textAlign:'center', color:'var(--text-muted)'}}>
                {loadingPrices ? 'Calculating...' : 'No positions yet.'}
              </td></tr>
            ) : rows.map(r => (
              <tr key={r.symbol}>
                <td>{r.symbol}</td>
                <td className="num">{r.qty.toLocaleString(undefined,{maximumFractionDigits:6})}</td>
                <td className="num">{fmt(r.avg)}</td>
                <td className="num">{fmt(r.last)}</td>
                <td className="num">{fmt(r.value)}</td>
                <td className={"num " + (r.pnlAbs>=0 ? "pos" : "neg")}>
                  {fmt(r.pnlAbs)} <span className={r.pnlPct>=0?"pos":"neg"}>({r.pnlPct.toFixed(1)}%)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint">Prices are provided by the <code>json</code> provider kept up to date by the scripts.</p>
    </div>
  );
}

function buildRows(positions: Record<string, Position>, prices: Record<string, number>): Row[]{
  return Object.entries(positions)
    .filter(([, p]) => Math.abs(p.qty) > EPSILON)
    .map(([symbol, p]) => {
      const last = prices[symbol] ?? 0;
      const value = p.qty * last;
      const pnlAbs = (last - p.avgPrice) * p.qty;
      const pnlPct = p.avgPrice ? (last / p.avgPrice - 1) * 100 : 0;
      return { symbol, qty: p.qty, avg: p.avgPrice, last, value, pnlAbs, pnlPct };
    })
    .sort((a,b)=> a.symbol.localeCompare(b.symbol));
}

function fmt(n: number){
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

