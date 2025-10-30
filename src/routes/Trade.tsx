import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import provider from "../lib/prices";
import { fetchCompaniesIndex, type Company, marketLabel } from "../lib/companies";
import { usePortfolioSnapshot } from "../lib/usePortfolioSnapshot";
import { useI18n } from "../i18n/I18nProvider";

type EntryMode = "qty" | "amount";

export default function Trade(){
  const { t } = useI18n();
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

  // Détecter si le symbole est un FX (via companies index ou simple heuristique)
  const isFxSymbol = (sym: string) => /^[A-Z]{6}$/.test(sym) || (companies.find(c => c.symbol === sym)?.market?.toUpperCase() === "FX");

  // USDJPY -> { base: "USD", quote: "JPY" }
  const parseFx = (sym: string) => {
    const s = sym.toUpperCase().replace(/[^A-Z]/g,"");
    return { base: s.slice(0,3), quote: s.slice(3,6) };
  };

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
      const fetched = await provider.getLastPrice(symbol);
      setLast(Number.isFinite(fetched) && fetched > 0 ? fetched : 0);
    })();
  }, [symbol]);

  const round6 = (x:number) => Math.round(x * 1e6) / 1e6;
  const previewQty = mode === "qty"
    ? Math.max(0, qty || 0)
    : (last ? round6((amount || 0) / last) : 0);

  const validate = (side:"buy"|"sell", px:number) => {
    if (!Number.isFinite(px) || px <= 0) {
      return t('trade.validation.invalidPrice');
    }
    const q = mode === "qty" ? qty : round6(amount / px);
    if (!q || q <= 0) return t('trade.validation.invalidQuantity');
    if (side === "sell" && posQty < q - 1e-9) return t('trade.validation.insufficientPosition');
    if (side === "buy") {
      const needed = q * px;
      if (cash + 1e-6 < needed) return t('trade.validation.insufficientCash');
    }
    return "";
  };

  const place = async (side: "buy"|"sell") => {
    setMsg(""); setLoading(true);
    try {
      const fetchedPrice = await provider.getLastPrice(symbol);
      if (!Number.isFinite(fetchedPrice) || fetchedPrice <= 0) {
        setMsg(t('trade.validation.invalidPrice')); setLoading(false); return;
      }
      const fillPrice = fetchedPrice;

      // quantité base calculée selon le mode
      const qBase = mode === "qty" ? Number(qty) : round6(Number(amount) / fillPrice);
      if (qBase <= 0) { setMsg(t('trade.validation.invalidQuantity')); setLoading(false); return; }

      if (isFxSymbol(symbol)) {
        const { base, quote } = parseFx(symbol);
        // ex. buy USDJPY: +USD(qBase)  -JPY(qBase*fillPrice)
        const deltaBase  = side === "buy" ?  qBase : -qBase;
        const deltaQuote = side === "buy" ? -qBase * fillPrice :  qBase * fillPrice;

        // On peut ajouter une vérif “suffisance” sur le solde quote si tu veux
        const baseRef  = doc(db, "users", uid, "balances", base);
        const quoteRef = doc(db, "users", uid, "balances", quote);
        const ordRef   = doc(collection(db, "users", uid, "orders"));

        await runTransaction(db, async (tx) => {
          const baseSnap  = await tx.get(baseRef);
          const quoteSnap = await tx.get(quoteRef);
          const baseAmt   = (baseSnap.exists()  ? (baseSnap.data()  as any).amount : 0) + deltaBase;
          const quoteAmt  = (quoteSnap.exists() ? (quoteSnap.data() as any).amount : 0) + deltaQuote;

          tx.set(baseRef, { amount: baseAmt });
          tx.set(quoteRef, { amount: quoteAmt });

          tx.set(ordRef, { symbol, side, qty: qBase, fillPrice, ts: serverTimestamp(), type: "FX", base, quote });
        });

        setMsg(side === "buy" ? t('trade.success.buy') : t('trade.success.sell'));
        if (mode === "qty") setQty(1); else setAmount(0);
        setLast(fillPrice);
        return;
      }

      // --- Chemin non-FX (inchangé) : actions/ETF/crypto -> positions ---
      const err = validate(side, fillPrice);
      if (err) { setMsg(err); setLoading(false); return; }
      // ... ta logique actuelle de mise à jour positions (comme aujourd'hui) ...
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="container">
      <h2 className="signin-title" style={{marginTop:0}}>{t('trade.title')}</h2>

      <div className="trade-grid">
        <div className="field">
          <label>{t('trade.field.symbol')}</label>
          <select className="select" value={symbol} onChange={e=>setSymbol(e.target.value)}>
            {Object.entries(groupByMarket(companies)).map(([mkt, arr])=> (
              <optgroup key={mkt} label={marketLabel(mkt)}>
                {arr.map(c=> (
                  <option key={c.symbol} value={c.symbol}>{c.symbol} - {c.name || c.symbol}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="hint">{t('trade.field.inPortfolio')} <strong>{fmtQty(posQty)}</strong></div>
        </div>

        <div className="field">
          <label>{t('trade.field.lastPrice')}</label>
          <div className="price-tile">{last ? last.toFixed(2) : "-"}</div>
        </div>

        <div className="field" style={{gridColumn:"1 / -1"}}>
          <div className="seg">
            <button type="button" className={mode === "qty" ? "on" : ""} onClick={() => setMode("qty")}>{t('trade.mode.enterQuantity')}</button>
            <button type="button" className={mode === "amount" ? "on" : ""} onClick={() => setMode("amount")}>{t('trade.mode.enterAmount')}</button>
          </div>
        </div>

        {mode === "qty" ? (
          <div className="field">
            <label>{t('trade.field.quantityLabel')}</label>
            <input className="input" type="number" min={0} step="any"
                   value={qty} onChange={e=>setQty(Number(e.target.value))}/>
            <div className="hint">{t('trade.field.estimatedCost')}: <strong>{last ? (qty * last).toFixed(2) : "-"}</strong></div>
          </div>
        ) : (
          <div className="field">
            <label>{t('trade.field.amountLabel')}</label>
            <input className="input" type="number" min={0} step="0.01"
                   value={amount} onChange={e=>setAmount(Number(e.target.value))}/>
            <div className="hint">{t('trade.field.estimatedQuantity')}: <strong>{fmtQty(previewQty)}</strong></div>
          </div>
        )}

        <div className="field">
          <label>{t('trade.field.creditsLabel')}</label>
          <div className="price-tile">{cash.toFixed(2)}</div>
        </div>
      </div>

      <div className="trade-actions">
        <button className="btn btn-accent" disabled={loading} onClick={() => place("buy")}>
          {t('trade.actions.buy')}
        </button>
        <button className="btn btn-sell" disabled={loading} onClick={() => place("sell")}>
          {t('trade.actions.sell')}
        </button>
      </div>

      <div className="hint">
        {mode === "qty"
          ? t('trade.hint.quantity')
          : t('trade.hint.amount')}
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
  for(const pref of ["US","CN","EU","JP","SA","IDX","COM","CRYPTO","FX"]) if(map[pref]) ordered[pref]=map[pref];
  for(const k of Object.keys(map).sort()) if(!(k in ordered)) ordered[k]=map[k];
  return ordered;
}

