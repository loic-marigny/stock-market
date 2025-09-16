// src/routes/Portfolio.tsx
import { useEffect, useMemo, useState } from "react";
import { auth, db } from "../firebase";
import { collection, onSnapshot, orderBy, query, doc, getDoc } from "firebase/firestore";
import provider from "../lib/prices";
import { computeCash, computePositions } from "../lib/portfolio";
import type { Order } from "../lib/portfolio";
type Row = {
  symbol: string;
  qty: number;
  avg: number;
  last: number;
  value: number;
  pnlAbs: number;
  pnlPct: number;
};

export default function Portfolio(){
  const [orders, setOrders] = useState<Order[]>([]);
  const [initial, setInitial] = useState<number>(100);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const uid = auth.currentUser!.uid;

  // 1) charger les ordres en temps réel
  useEffect(()=>{
    const qRef = query(collection(db, "users", uid, "orders"), orderBy("ts", "asc"));
    return onSnapshot(qRef, (snap)=>{
      const arr: Order[] = snap.docs.map(d => d.data() as Order);
      setOrders(arr);
    });
  }, [uid]);

  // 2) charger initialCredits (user doc)
  useEffect(()=>{
    (async ()=>{
      const s = await getDoc(doc(db, "users", uid));
      if (s.exists()) setInitial(s.data().initialCredits ?? 100);
    })();
  }, [uid]);

  // 3) positions + cash
  const positions = useMemo(()=> computePositions(orders), [orders]);
  const cash = useMemo(()=> computeCash(initial, orders), [initial, orders]);

  // 4) charger les derniers prix des symboles détenus (qty>0)
  useEffect(()=>{
    (async ()=>{
      const held = Object.entries(positions).filter(([_,p])=> p.qty>0).map(([sym])=> sym);
      const map: Record<string, number> = {};
      for (const s of held) map[s] = await provider.getLastPrice(s);
      setPrices(map);
    })();
  }, [positions]);

  // 5) composer les lignes du tableau
  const rows: Row[] = useMemo(()=>{
    return Object.entries(positions)
      .filter(([_, p]) => p.qty !== 0)
      .map(([symbol, p]) => {
        const last = prices[symbol] ?? 0;
        const value = p.qty * last;
        const pnlAbs = (last - p.avgPrice) * p.qty;
        const pnlPct = p.avgPrice ? (last / p.avgPrice - 1) * 100 : 0;
        return { symbol, qty: p.qty, avg: p.avgPrice, last, value, pnlAbs, pnlPct };
      })
      .sort((a,b)=> a.symbol.localeCompare(b.symbol));
  }, [positions, prices]);

  const mktValue = rows.reduce((acc, r)=> acc + r.value, 0);
  const nav = cash + mktValue;

  return (
    <div className="container">
      <h2 className="signin-title" style={{marginTop: 0}}>Mon portefeuille</h2>

      <div className="grid-cards">
        <div className="kpi-card">
          <div className="kpi-k">Crédits</div>
          <div className="kpi-v">{fmt(cash)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-k">Valeur du portefeuille</div>
          <div className="kpi-v">{fmt(mktValue)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-k">NAV</div>
          <div className="kpi-v">{fmt(nav)}</div>
        </div>
      </div>

      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Symbole</th><th>Qté</th><th>PA moyen</th><th>Dernier</th><th>Valeur</th><th>P&L</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} style={{textAlign:'center', color:'var(--text-muted)'}}>Pas encore de positions.</td></tr>
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

      <p className="hint">Les prix proviennent du provider <code>mock</code>. On branchera une source réelle ensuite.</p>
    </div>
  );
}

function fmt(n: number){ return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
