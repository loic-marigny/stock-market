import { useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import provider from "../lib/prices";
import { fetchCompaniesIndex, type Company, marketLabel } from "../lib/companies";
import { usePortfolioSnapshot } from "../lib/usePortfolioSnapshot";
import { submitSpotOrder } from "../lib/trading";
import CompanySidebar from "../components/CompanySidebar";
import { useI18n } from "../i18n/I18nProvider";

type EntryMode = "qty" | "amount";

const assetPath = (path: string) => {
  if (/^https?:/i.test(path)) return path;
  const base = ((import.meta as any).env?.BASE_URL as string | undefined) ?? "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const trimmed = path.replace(/^\/+/, "");
  return `${normalizedBase}${trimmed}`;
};

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
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

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

      // --- Chemin non-FX : actions/ETF/crypto -> positions ---
      const err = validate(side, fillPrice);
      if (err) { setMsg(err); setLoading(false); return; }

      await submitSpotOrder({
        uid,
        symbol,
        side,
        qty: qBase,
        fillPrice,
        extra: { source: "Trade" },
      });

      setMsg(side === "buy" ? t('trade.success.buy') : t('trade.success.sell'));
      if (mode === "qty") setQty(1); else setAmount(0);
      setLast(fillPrice);
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };


  const placeholderLogoPath = "img/logo-placeholder.svg";
  const selectedCompany = companies.find((company) => company.symbol === symbol) ?? null;

  const handleSelectSymbol = (value: string) => {
    setSymbol(value);
    setSidebarOpen(true);
  };

  return (
    <main className="explore-page">
      <div className={`explore-layout${sidebarOpen ? "" : " sidebar-collapsed"}`}>
        <CompanySidebar
          companies={companies}
          selectedSymbol={symbol}
          onSelectSymbol={handleSelectSymbol}
          collapsed={!sidebarOpen}
          onCollapse={() => setSidebarOpen(false)}
          onExpand={() => setSidebarOpen(true)}
          title={t('explore.markets')}
          searchPlaceholder={t('explore.searchPlaceholder')}
          noResultsLabel={t('explore.noResults')}
          hideLabel={t('explore.hideSidebar')}
          assetPath={assetPath}
          placeholderLogoPath={placeholderLogoPath}
          marketLabel={marketLabel}
        />

        <div className="explore-main">
          <button
            type="button"
            className={`explore-sidebar-toggle reopen${sidebarOpen ? '' : ' visible'}`}
            onClick={() => setSidebarOpen(true)}
            aria-label={t('explore.showSidebar')}
            title={t('explore.showSidebar')}
            aria-hidden={sidebarOpen}
            tabIndex={sidebarOpen ? -1 : 0}
          >
            <span className="explore-toggle-icon" aria-hidden="true" />
          </button>

          <div className="explore-main-content">
            <div className="trade-header">
              <h2 className="signin-title" style={{ marginTop: 0 }}>{t('trade.title')}</h2>
              {selectedCompany && (
                <p className="hint" style={{ marginBottom: "1rem" }}>
                  {selectedCompany.symbol} · {selectedCompany.name ?? selectedCompany.symbol}
                </p>
              )}
            </div>

            <div className="trade-grid">
              <div className="field">
                <label>{t('trade.field.symbol')}</label>
                <div className="price-tile">{symbol}</div>
                <div className="hint">{t('trade.field.inPortfolio')} <strong>{fmtQty(posQty)}</strong></div>
              </div>

              <div className="field">
                <label>{t('trade.field.lastPrice')}</label>
                <div className="price-tile">{last ? last.toFixed(2) : "-"}</div>
              </div>

              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <div className="seg">
                  <button type="button" className={mode === "qty" ? "on" : ""} onClick={() => setMode("qty")}>{t('trade.mode.enterQuantity')}</button>
                  <button type="button" className={mode === "amount" ? "on" : ""} onClick={() => setMode("amount")}>{t('trade.mode.enterAmount')}</button>
                </div>
              </div>

              {mode === "qty" ? (
                <div className="field">
                  <label>{t('trade.field.quantityLabel')}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="any"
                    value={qty}
                    onChange={(event) => setQty(Number(event.target.value))}
                  />
                  <div className="hint">
                    {t('trade.field.estimatedCost')}: <strong>{last ? (qty * last).toFixed(2) : "-"}</strong>
                  </div>
                </div>
              ) : (
                <div className="field">
                  <label>{t('trade.field.amountLabel')}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(Number(event.target.value))}
                  />
                  <div className="hint">
                    {t('trade.field.estimatedQuantity')}: <strong>{fmtQty(previewQty)}</strong>
                  </div>
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
              {mode === "qty" ? t('trade.hint.quantity') : t('trade.hint.amount')}
            </div>

            {msg && <div className="trade-msg">{msg}</div>}
          </div>
        </div>
      </div>
    </main>
  );
}

function fmtQty(n:number){
  return n.toLocaleString(undefined,{maximumFractionDigits:6});
}

