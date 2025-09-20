import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import provider from "../lib/prices";
import { fetchCompaniesIndex, type Company, marketLabel } from "../lib/companies";
import { usePortfolioSnapshot } from "../lib/usePortfolioSnapshot";

type EntryMode = "qty" | "amount";

export default function Trade(){
  const uid = auth.currentUser!.uid;

  const [symbol, setSymbol] = useState<string>("AAPL");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [mode, setMode] = useState<EntryMode>("qty");
  const [qty, setQty] = useState<number>(1);
  const [amount, setAmount] = useState<number>(0);
  const [last, setLast] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  const { positions, cash } = usePortfolioSnapshot(uid);
  const posQty = positions[symbol]?.qty ?? 0;

  useEffect(()=>{
    (async()=>{
      try{
        const idx = await fetchCompaniesIndex();
        setCompanies(idx);
        if (!idx.find(c => c.symbol === symbol)){
          const firstUS = idx.find(c => (c.market || "").toUpperCase() === "US");
          setSymbol(firstUS?.symbol || idx[0]?.symbol || symbol);
        }
      }catch{}
    })();
  }, []);

  useEffect(()=>{
    (async()=>{
      setLast(await provider.getLastPrice(symbol));
    })();
  }, [symbol]);

  const round6 = (x:number) => Math.round(x * 1e6) / 1e6;
  const previewQty = mode === "qty"
    ? Math.max(0, qty || 0)
    : (last ? round6((amount || 0) / last) : 0);

  const validate = (side:"buy"|"sell", px:number) => {
    const q = mode === "qty" ? qty : round6(amount / px);
    if (!q || q <= 0) return "Quantite ou montant invalide.";
    if (side === "sell" && posQty < q - 1e-9) return "Position insuffisante pour cette vente.";
    if (side === "buy") {
      const needed = q * px;
      if (cash + 1e-6 < needed) return "Credits insuffisants pour cet achat.";
    }
    return "";
  };

  const place = async (side: "buy"|"sell")=>{
    setMsg("");
    setLoading(true);
    try{
      const fillPrice = await provider.getLastPrice(symbol);
      const q = mode === "qty" ? Number(qty) : round6(Number(amount) / fillPrice);

      const err = validate(side, fillPrice);
      if (err) { setMsg(err); setLoading(false); return; }

      const posRef = doc(db, "users", uid, "positions", symbol);
      const ordRef = doc(collection(db, "users", uid, "orders"));

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

      setMsg(side === "buy" ? "Achat execute." : "Vente executee.");

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
          <select className="select" value={symbol} onChange={e=>setSymbol(e.target.value)}>
            {Object.entries(groupByMarket(companies)).map(([mkt, arr])=> (
              <optgroup key={mkt} label={marketLabel(mkt)}>
                {arr.map(c=> (
                  <option key={c.symbol} value={c.symbol}>{c.symbol} - {c.name || c.symbol}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="hint">En portefeuille : <strong>{fmtQty(posQty)}</strong></div>
        </div>

        <div className="field">
          <label>Dernier prix</label>
          <div className="price-tile">{last ? last.toFixed(2) : "-"}</div>
        </div>

        <div className="field" style={{gridColumn:"1 / -1"}}>
          <div className="seg">
            <button type="button" className={mode === "qty" ? "on" : ""} onClick={() => setMode("qty")}>Entrer par quantite</button>
            <button type="button" className={mode === "amount" ? "on" : ""} onClick={() => setMode("amount")}>Entrer par montant</button>
          </div>
        </div>

        {mode === "qty" ? (
          <div className="field">
            <label>Quantite (unites)</label>
            <input className="input" type="number" min={0} step="any"
                   value={qty} onChange={e=>setQty(Number(e.target.value))}/>
            <div className="hint">Cout estime : <strong>{last ? (qty * last).toFixed(2) : "-"}</strong></div>
          </div>
        ) : (
          <div className="field">
            <label>Montant (credits)</label>
            <input className="input" type="number" min={0} step="0.01"
                   value={amount} onChange={e=>setAmount(Number(e.target.value))}/>
            <div className="hint">Quantite estimee : <strong>{fmtQty(previewQty)}</strong></div>
          </div>
        )}

        <div className="field">
          <label>Credits dispo</label>
          <div className="price-tile">{cash.toFixed(2)}</div>
        </div>
      </div>

      <div className="trade-actions">
        <button className="btn btn-accent" disabled={loading} onClick={() => place("buy")}>
          Acheter
        </button>
        <button className="btn btn-sell" disabled={loading} onClick={() => place("sell")}>
          Vendre
        </button>
      </div>

      <div className="hint">
        {mode === "qty"
          ? "Execution: quantite x dernier prix au moment du clic."
          : "Execution: quantite calculee = montant / dernier prix."}
      </div>

      {msg && <div className="trade-msg">{msg}</div>}
    </div>
  );
}

function fmtQty(n:number){
  return n.toLocaleString(undefined,{maximumFractionDigits:6});
}

function groupByMarket(list: Company[]): Record<string, Company[]>{
  const map: Record<string, Company[]> = {};
  for(const c of list){
    const key = (c.market || "OTHER").toUpperCase();
    (map[key] ||= []).push(c);
  }
  for(const k of Object.keys(map)){
    map[k].sort((a,b)=> (a.symbol).localeCompare(b.symbol));
  }
  const ordered: Record<string, Company[]> = {};
  for(const pref of ["US","CN","EU","JP","SA","COM","CRYPTO","FX"]) if(map[pref]) ordered[pref]=map[pref];
  for(const k of Object.keys(map).sort()) if(!(k in ordered)) ordered[k]=map[k];
  return ordered;
}
