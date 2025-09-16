import { useEffect, useMemo, useState } from "react";
import { auth, db } from "../firebase";
import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp } from "firebase/firestore";
import provider from "../lib/prices";
import { computeCash, computePositions, type Order } from "../lib/portfolio";

const TICKERS = ["ASML.AS","SAP.DE","MC.PA","AIR.PA","BMW.DE","BNP.PA"] as const;

export default function Trade(){
  const uid = auth.currentUser!.uid;

  // état du formulaire
  const [symbol, setSymbol] = useState<(typeof TICKERS)[number]>("ASML.AS");
  const [qty, setQty] = useState<number>(1);
  const [last, setLast] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  // ordres en temps réel (pour calculer cash/positions)
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(()=>{
    const qRef = query(collection(db,"users",uid,"orders"), orderBy("ts","asc"));
    return onSnapshot(qRef, snap => setOrders(snap.docs.map(d=>d.data() as Order)));
  },[uid]);

  const initial = 100;
  const cash = useMemo(()=> computeCash(initial, orders), [orders]);
  const positions = useMemo(()=> computePositions(orders), [orders]);
  const posQty = positions[symbol]?.qty ?? 0;

  // charger le dernier prix quand symbol change
  useEffect(()=>{ (async()=>{
    setLast(await provider.getLastPrice(symbol));
  })() }, [symbol]);

  const place = async (side: "buy"|"sell")=>{
    setMsg("");
    if (!qty || qty <= 0) { setMsg("Quantité invalide."); return; }

    // rafraîchir prix pour l’exécution
    const fillPrice = await provider.getLastPrice(symbol);

    // règles côté client minimalistes
    if (side === "sell" && posQty < qty) { setMsg("Vous ne possédez pas autant d’actions à vendre."); return; }
    if (side === "buy" && cash < qty * fillPrice) { setMsg("Crédits insuffisants pour cet achat."); return; }

    setLoading(true);
    try{
      const posRef = doc(db,"users",uid,"positions",symbol);
      const ordRef = doc(collection(db,"users",uid,"orders"));
      await runTransaction(db, async (tx)=>{
        const snap = await tx.get(posRef);
        const cur = snap.exists() ? (snap.data() as any) : { qty: 0, avgPrice: 0 };

        if (side === "sell" && cur.qty < qty) {
          throw new Error("Position insuffisante.");
        }

        let newQty = cur.qty;
        let newAvg = cur.avgPrice;

        if (side === "buy") {
          const totalCost = cur.avgPrice * cur.qty + fillPrice * qty;
          newQty = cur.qty + qty;
          newAvg = newQty ? totalCost / newQty : 0;
        } else {
          newQty = cur.qty - qty;
          newAvg = newQty ? cur.avgPrice : 0;
        }

        tx.set(ordRef, {
          symbol,
          side,
          qty,
          fillPrice,
          ts: serverTimestamp(),
        });
        tx.set(posRef, { qty: newQty, avgPrice: newAvg });
      });
      setMsg(side === "buy" ? "Achat exécuté." : "Vente exécutée.");
      setQty(1);
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
            {TICKERS.map(t=> <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="hint">En portefeuille : <strong>{posQty}</strong></div>
        </div>

        <div className="field">
          <label>Dernier prix</label>
          <div className="price-tile">{last ? last.toFixed(2) : "—"}</div>
        </div>

        <div className="field">
          <label>Quantité</label>
          <input className="input" type="number" min={1} value={qty}
                 onChange={e=>setQty(parseInt(e.target.value || "1"))}/>
        </div>

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

      {msg && <div className="trade-msg">{msg}</div>}

      <p className="hint">Les exécutions utilisent le dernier prix du provider <code>mock</code>.</p>
    </div>
  );
}
