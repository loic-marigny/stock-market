import { useEffect, useMemo, useState } from "react";
import { auth, db } from "../firebase";
import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp } from "firebase/firestore";
import provider from "../lib/prices";
import { computeCash, computePositions, type Order } from "../lib/portfolio";

const US_TICKERS = [
  "AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","AVGO","LLY","TSLA",
  "JPM","V","XOM","UNH","JNJ","WMT","MA","PG","ORCL","COST",
  "MRK","HD","KO","PEP","BAC","ADBE","CRM","NFLX","CSCO","AMD",
] as const;
const CN_TICKERS = [
  "600519.SS","601318.SS","601398.SS","601288.SS","601988.SS","601857.SS",
  "600028.SS","600036.SS","601166.SS","600900.SS","601888.SS","601012.SS",
  "600104.SS","600030.SS","600585.SS","600000.SS","601601.SS","601939.SS",
  "600019.SS","600276.SS","601766.SS","600309.SS","601633.SS","600887.SS",
  "601668.SS","601658.SS","601728.SS","601628.SS","688981.SS",
] as const;
const TICKERS = [...US_TICKERS, ...CN_TICKERS] as const;
type EntryMode = "qty" | "amount";

export default function Trade(){
  const uid = auth.currentUser!.uid;

  // état du formulaire
  const [symbol, setSymbol] = useState<(typeof TICKERS)[number]>("AAPL");
  const [mode, setMode] = useState<EntryMode>("qty");
  const [qty, setQty] = useState<number>(1);
  const [amount, setAmount] = useState<number>(0);
  const [last, setLast] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  // ordres en temps réel
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(()=>{
    const qRef = query(collection(db,"users",uid,"orders"), orderBy("ts","asc"));
    return onSnapshot(qRef, snap => setOrders(snap.docs.map(d=>d.data() as Order)));
  },[uid]);

  const initial = 100;
  const cash = useMemo(()=> computeCash(initial, orders), [orders]);
  const positions = useMemo(()=> computePositions(orders), [orders]);
  const posQty = positions[symbol]?.qty ?? 0;

  // charger le dernier prix
  useEffect(()=>{ (async()=> setLast(await provider.getLastPrice(symbol)))() }, [symbol]);

  // helpers
  const round6 = (x:number) => Math.round(x * 1e6) / 1e6;
  const previewQty = mode === "qty"
    ? Math.max(0, qty || 0)
    : (last ? round6((amount || 0) / last) : 0);

  const validate = (side:"buy"|"sell", px:number) => {
    const q = mode === "qty" ? qty : round6(amount / px);
    if (!q || q <= 0) return "Quantité ou montant invalide.";
    if (side === "sell" && posQty < q - 1e-9) return "Position insuffisante pour cette vente.";
    if (side === "buy") {
      const needed = q * px;
      if (cash + 1e-6 < needed) return "Crédits insuffisants pour cet achat.";
    }
    return "";
  };

  const place = async (side: "buy"|"sell")=>{
    setMsg("");
    setLoading(true);
    try{
      // prix d’exécution rafraîchi
      const fillPrice = await provider.getLastPrice(symbol);
      const q = mode === "qty" ? Number(qty) : round6(Number(amount) / fillPrice);

      const err = validate(side, fillPrice);
      if (err) { setMsg(err); setLoading(false); return; }

      const posRef = doc(db,"users",uid,"positions",symbol);
      const ordRef = doc(collection(db,"users",uid,"orders"));

      await runTransaction(db, async (tx)=>{
        const snap = await tx.get(posRef);
        const cur = snap.exists() ? (snap.data() as any) : { qty: 0, avgPrice: 0 };

        if (side === "sell" && cur.qty < q - 1e-9) {
          throw new Error("Position insuffisante.");
        }

        let newQty = cur.qty;
        let newAvg = cur.avgPrice;

        if (side === "buy") {
          const totalCost = cur.avgPrice * cur.qty + fillPrice * q;
          newQty = cur.qty + q;
          newAvg = newQty ? totalCost / newQty : 0;
        } else {
          newQty = cur.qty - q;
          newAvg = newQty ? cur.avgPrice : 0;
        }

        tx.set(ordRef, { symbol, side, qty: q, fillPrice, ts: serverTimestamp() });
        tx.set(posRef, { qty: newQty, avgPrice: newAvg });
      });

      setMsg(side === "buy" ? "Achat exécuté." : "Vente exécutée.");

      // reset champs de saisie (selon le mode)
      if (mode === "qty") setQty(1);
      else setAmount(0);

      setLast(fillPrice);
    }catch(e:any){
      setMsg(e?.message ?? String(e));
    }finally{
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h2 className="signin-title" style={{marginTop:0}}>Trader</h2>

      <div className="trade-grid">
        <div className="field">
          <label>Symbole</label>
          <select className="select" value={symbol} onChange={e=>setSymbol(e.target.value as any)}>
            <optgroup label="New York">
              {US_TICKERS.map(t=> <option key={t} value={t}>{t}</option>)}
            </optgroup>
            <optgroup label="Shanghai">
              {CN_TICKERS.map(t=> <option key={t} value={t}>{t}</option>)}
            </optgroup>
          </select>
          <div className="hint">En portefeuille : <strong>{fmtQty(posQty)}</strong></div>
        </div>

        <div className="field">
          <label>Dernier prix</label>
          <div className="price-tile">{last ? last.toFixed(2) : "—"}</div>
        </div>

        <div className="field" style={{gridColumn:'1 / -1'}}>
          <div className="seg">
            <button type="button" className={mode==='qty'?'on':''} onClick={()=>setMode('qty')}>Entrer par quantité</button>
            <button type="button" className={mode==='amount'?'on':''} onClick={()=>setMode('amount')}>Entrer par montant</button>
          </div>
        </div>

        {mode === "qty" ? (
          <>
            <div className="field">
              <label>Quantité (actions)</label>
              <input className="input" type="number" min={0} step="any"
                     value={qty} onChange={e=>setQty(Number(e.target.value))}/>
              <div className="hint">Coût estimé : <strong>{last ? (qty*last).toFixed(2) : "—"}</strong></div>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>Montant (crédits)</label>
              <input className="input" type="number" min={0} step="0.01"
                     value={amount} onChange={e=>setAmount(Number(e.target.value))}/>
              <div className="hint">Quantité estimée : <strong>{fmtQty(previewQty)}</strong></div>
            </div>
          </>
        )}

        <div className="field">
          <label>Crédits dispo</label>
          <div className="price-tile">{cash.toFixed(2)}</div>
        </div>
      </div>

      <div className="trade-actions">
        <button className="btn btn-accent" disabled={loading} onClick={()=>place("buy")}>
          Acheter
        </button>
        <button className="btn btn-sell" disabled={loading} onClick={()=>place("sell")}>
          Vendre
        </button>
      </div>

      <div className="hint">
        {mode==='qty'
          ? <>Exécution: quantité × dernier prix au moment du clic.</>
          : <>Exécution: quantité calculée = montant / dernier prix.</>}
      </div>

      {msg && <div className="trade-msg">{msg}</div>}
    </div>
  );
}

function fmtQty(n:number){ return n.toLocaleString(undefined,{maximumFractionDigits:6}); }
