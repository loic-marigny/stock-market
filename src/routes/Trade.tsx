import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../firebase";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import provider from "../lib/prices";
import { fetchCompaniesIndex, type Company, marketLabel } from "../lib/companies";
import { usePortfolioSnapshot } from "../lib/usePortfolioSnapshot";
import { submitSpotOrder } from "../lib/trading";
import CompanySidebar from "../components/CompanySidebar";
import { useI18n } from "../i18n/I18nProvider";
import PositionsTable from "../components/PositionsTable";
import {
  buildOpenLots,
  buildPositionRows,
  formatCompactValue,
  type PositionRow,
} from "../lib/positionsTable";
import { useConditionalOrders } from "../lib/useConditionalOrders";
import {
  cancelConditionalOrder,
  executeConditionalOrder,
  scheduleConditionalOrder,
  type ConditionalOrder,
  type TriggerType,
} from "../lib/conditionalOrders";

type EntryMode = "qty" | "amount";

const assetPath = (path: string) => {
  if (/^https?:/i.test(path)) return path;
  const base = ((import.meta as any).env?.BASE_URL as string | undefined) ?? "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const trimmed = path.replace(/^\/+/, "");
  return `${normalizedBase}${trimmed}`;
};

export default function Trade(){
  const { t, locale } = useI18n();
  const uid = auth.currentUser!.uid;

  const [symbol, setSymbol] = useState<string>("AAPL");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [mode, setMode] = useState<EntryMode>("qty");
  const [qty, setQty] = useState<number>(1);
  const [amount, setAmount] = useState<number>(0);
  const [last, setLast] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");
  const [conditionalSide, setConditionalSide] = useState<"buy" | "sell">("sell");
  const [conditionalQty, setConditionalQty] = useState<number>(0);
  const [conditionalTriggerPrice, setConditionalTriggerPrice] = useState<number>(0);
  const [conditionalTriggerType, setConditionalTriggerType] = useState<TriggerType>("gte");
  const [conditionalMsg, setConditionalMsg] = useState<string>("");
  const [conditionalLoading, setConditionalLoading] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [focusSidebarOnOpen, setFocusSidebarOnOpen] = useState<boolean>(false);
  const reopenButtonRef = useRef<HTMLButtonElement | null>(null);

  const { positions, cash, orders, prices, loadingPrices } = usePortfolioSnapshot(uid);
  const openLots = useMemo(() => buildOpenLots(orders), [orders]);
  const portfolioRows = useMemo(
    () => buildPositionRows(openLots, prices),
    [openLots, prices],
  );
  const posQty = positions[symbol]?.qty ?? 0;
  const conditionalOrders = useConditionalOrders(uid);
  const pendingConditionalOrders = useMemo(
    () => conditionalOrders.filter((order) => order.status === "pending"),
    [conditionalOrders],
  );
  const fmtValue = formatCompactValue;

  // Détecter si le symbole est un FX (via l’index des companies ou heuristique 6 lettres)
  const isFxSymbol = (sym: string) =>
    /^[A-Z]{6}$/.test(sym) ||
    companies.find((c) => c.symbol === sym)?.market?.toUpperCase() === "FX";

  // USDJPY -> { base: "USD", quote: "JPY" }
  const parseFx = (sym: string) => {
    const s = sym.toUpperCase().replace(/[^A-Z]/g, "");
    return { base: s.slice(0, 3), quote: s.slice(3, 6) };
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

  useEffect(() => {
    if (conditionalTriggerPrice <= 0 && last > 0) {
      setConditionalTriggerPrice(last);
    }
  }, [last, conditionalTriggerPrice]);

  useEffect(() => {
    setConditionalQty((current) => {
      if (current > 0) return current;
      if (conditionalSide === "sell") {
        return posQty > 0 ? posQty : 1;
      }
      return 1;
    });
  }, [conditionalSide, posQty]);

  useEffect(() => {
    if (!sidebarOpen) {
      const frame = requestAnimationFrame(() => {
        reopenButtonRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [sidebarOpen]);

  useEffect(() => {
    if (!uid || pendingConditionalOrders.length === 0) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (cancelled) return;
      const grouped = new Map<string, ConditionalOrder[]>();
      for (const order of pendingConditionalOrders) {
        if (!grouped.has(order.symbol)) grouped.set(order.symbol, []);
        grouped.get(order.symbol)!.push(order);
      }
      for (const [sym, list] of grouped.entries()) {
        try {
          const px = await provider.getLastPrice(sym);
          if (!Number.isFinite(px) || px <= 0) continue;
          for (const order of list) {
            if (shouldTrigger(order, px)) {
              executeConditionalOrder({ uid, order, fillPrice: px }).catch((error) => {
                console.error("Failed to execute conditional order", error);
              });
            }
          }
        } catch (error) {
          console.error("Conditional order polling error", error);
        }
      }
      if (!cancelled) {
        timer = setTimeout(poll, 15_000);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [uid, pendingConditionalOrders]);

  const openSidebar = useCallback(() => {
    if (!sidebarOpen) {
      setSidebarOpen(true);
      setFocusSidebarOnOpen(true);
    }
  }, [sidebarOpen]);

  const closeSidebar = useCallback(() => {
    setFocusSidebarOnOpen(false);
    setSidebarOpen(false);
  }, []);

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

  const handleSelectSymbol = useCallback((value: string) => {
    setSymbol(value);
    if (!sidebarOpen) {
      setSidebarOpen(true);
      setFocusSidebarOnOpen(true);
    }
  }, [sidebarOpen]);

  const sortedConditionalOrders = useMemo(() => {
    return [...conditionalOrders].sort((a, b) => {
      const priority = (status: ConditionalOrder["status"]) => {
        switch (status) {
          case "pending":
            return 0;
          case "executing":
            return 1;
          case "error":
            return 2;
          case "triggered":
            return 3;
          case "cancelled":
          default:
            return 4;
        }
      };
      const diff = priority(a.status) - priority(b.status);
      if (diff !== 0) return diff;
      const aTime = a.createdAt?.getTime() ?? 0;
      const bTime = b.createdAt?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [conditionalOrders]);

  const statusLabel = (status: ConditionalOrder["status"]) => {
    switch (status) {
      case "pending":
        return t("trade.schedule.status.pending");
      case "executing":
        return t("trade.schedule.status.executing");
      case "triggered":
        return t("trade.schedule.status.triggered");
      case "cancelled":
        return t("trade.schedule.status.cancelled");
      case "error":
        return t("trade.schedule.status.error");
      default:
        return status;
    }
  };

  const canCancel = (status: ConditionalOrder["status"]) =>
    status === "pending" || status === "executing" || status === "error";

  const handlePrefillSell = useCallback((row: PositionRow) => {
    setSymbol(row.symbol);
    setMode("qty");
    setQty(row.qty);
    setConditionalSide("sell");
    setConditionalQty(row.qty);
    setConditionalTriggerType("gte");
    const fallbackPrice = row.last > 0 ? row.last : row.buyPrice;
    if (fallbackPrice > 0) {
      setConditionalTriggerPrice(fallbackPrice);
    }
  }, []);

  const handleScheduleConditional = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (conditionalLoading) return;
    setConditionalMsg("");
    if (!Number.isFinite(conditionalTriggerPrice) || conditionalTriggerPrice <= 0) {
      setConditionalMsg(t("trade.schedule.validation.triggerPrice"));
      return;
    }
    if (!conditionalQty || conditionalQty <= 0) {
      setConditionalMsg(t("trade.schedule.validation.qty"));
      return;
    }
    if (conditionalSide === "sell" && conditionalQty > posQty + 1e-9) {
      setConditionalMsg(t("trade.schedule.validation.position"));
      return;
    }
    if (conditionalSide === "buy") {
      const needed = conditionalQty * conditionalTriggerPrice;
      if (cash + 1e-6 < needed) {
        setConditionalMsg(t("trade.schedule.validation.cash"));
        return;
      }
    }

    try {
      setConditionalLoading(true);
      await scheduleConditionalOrder({
        uid,
        symbol,
        side: conditionalSide,
        qty: conditionalQty,
        triggerPrice: conditionalTriggerPrice,
        triggerType: conditionalTriggerType,
      });
      setConditionalMsg(t("trade.schedule.success"));
    } catch (error: any) {
      setConditionalMsg(error?.message ?? String(error));
    } finally {
      setConditionalLoading(false);
    }
  };

  const handleCancelConditional = async (orderId: string) => {
    try {
      await cancelConditionalOrder(uid, orderId);
    } catch (error: any) {
      setConditionalMsg(error?.message ?? String(error));
    }
  };

  return (
    <main className="explore-page">
      <div className={`explore-layout${sidebarOpen ? "" : " sidebar-collapsed"}`}>
        <CompanySidebar
          companies={companies}
          selectedSymbol={symbol}
          onSelectSymbol={handleSelectSymbol}
          collapsed={!sidebarOpen}
          onCollapse={closeSidebar}
          onExpand={openSidebar}
          title={t('explore.markets')}
          searchPlaceholder={t('explore.searchPlaceholder')}
          noResultsLabel={t('explore.noResults')}
          hideLabel={t('explore.hideSidebar')}
          assetPath={assetPath}
          placeholderLogoPath={placeholderLogoPath}
          marketLabel={marketLabel}
          focusOnMount={focusSidebarOnOpen}
          onFocusHandled={() => setFocusSidebarOnOpen(false)}
        />

        <div className="explore-main">
          {!sidebarOpen && (
            <button
              type="button"
              ref={reopenButtonRef}
              className="explore-sidebar-toggle reopen"
              onClick={openSidebar}
              aria-label={t('explore.showSidebar')}
              title={t('explore.showSidebar')}
            >
              <span className="explore-toggle-icon" aria-hidden="true" />
            </button>
          )}

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

            <div className="table-card" style={{ marginTop: "2rem" }}>
              <h3 className="insight-panel-title" style={{ marginTop: 0 }}>
                {t('trade.schedule.title')}
              </h3>
              <p className="hint" style={{ marginTop: 4 }}>
                {t('trade.schedule.description')}
              </p>
              <form className="trade-grid" onSubmit={handleScheduleConditional}>
                <div className="field">
                  <label>{t('trade.field.symbol')}</label>
                  <div className="price-tile">{symbol}</div>
                  <div className="hint">
                    {t('trade.field.inPortfolio')} <strong>{fmtQty(posQty)}</strong>
                  </div>
                </div>

                <div className="field">
                  <label>{t('trade.schedule.field.side')}</label>
                  <select
                    className="input"
                    value={conditionalSide}
                    onChange={(event) => setConditionalSide(event.target.value as "buy" | "sell")}
                  >
                    <option value="buy">{t('trade.schedule.side.buy')}</option>
                    <option value="sell">{t('trade.schedule.side.sell')}</option>
                  </select>
                </div>

                <div className="field">
                  <label>{t('trade.schedule.field.qty')}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="any"
                    value={conditionalQty}
                    onChange={(event) => setConditionalQty(Number(event.target.value))}
                  />
                </div>

                <div className="field">
                  <label>{t('trade.schedule.field.triggerPrice')}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={conditionalTriggerPrice}
                    onChange={(event) => setConditionalTriggerPrice(Number(event.target.value))}
                  />
                  <div className="hint">
                    {t('trade.field.lastPrice')}: <strong>{last ? last.toFixed(2) : "-"}</strong>
                  </div>
                </div>

                <div className="field">
                  <label>{t('trade.schedule.field.triggerType')}</label>
                  <select
                    className="input"
                    value={conditionalTriggerType}
                    onChange={(event) => setConditionalTriggerType(event.target.value as TriggerType)}
                  >
                    <option value="gte">{t('trade.schedule.triggerType.gte')}</option>
                    <option value="lte">{t('trade.schedule.triggerType.lte')}</option>
                  </select>
                </div>

                <div className="field">
                  <label>{t('trade.field.creditsLabel')}</label>
                  <div className="price-tile">{cash.toFixed(2)}</div>
                </div>

                <div className="trade-actions" style={{ gridColumn: "1 / -1" }}>
                  <button type="submit" className="btn btn-accent" disabled={conditionalLoading}>
                    {t('trade.schedule.submit')}
                  </button>
                </div>
              </form>

              {conditionalMsg && <div className="trade-msg">{conditionalMsg}</div>}
            </div>

            <div className="table-card" style={{ marginTop: "1.5rem" }}>
              <h3 className="insight-panel-title" style={{ marginTop: 0 }}>
                {t('trade.schedule.orders.title')}
              </h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('trade.schedule.orders.headers.symbol')}</th>
                    <th>{t('trade.schedule.orders.headers.side')}</th>
                    <th>{t('trade.schedule.orders.headers.qty')}</th>
                    <th>{t('trade.schedule.orders.headers.trigger')}</th>
                    <th>{t('trade.schedule.orders.headers.status')}</th>
                    <th>{t('trade.schedule.orders.headers.error')}</th>
                    <th>{t('trade.schedule.orders.headers.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedConditionalOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                        {t('trade.schedule.orders.empty')}
                      </td>
                    </tr>
                  ) : (
                    sortedConditionalOrders.map((order) => {
                      const directionSymbol = order.triggerType === "gte" ? "≥" : "≤";
                      return (
                        <tr key={order.id}>
                          <td>{order.symbol}</td>
                          <td>{order.side === "buy" ? t('trade.actions.buy') : t('trade.actions.sell')}</td>
                          <td className="num">{fmtQty(order.qty)}</td>
                          <td className="num">
                            {directionSymbol} {fmtValue(order.triggerPrice ?? 0)}
                          </td>
                          <td>{statusLabel(order.status)}</td>
                          <td>
                            {order.lastError ? (
                              <span className="neg">{order.lastError}</span>
                            ) : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {canCancel(order.status) ? (
                              <button
                                type="button"
                                className="btn"
                                onClick={() => handleCancelConditional(order.id)}
                              >
                                {t('trade.schedule.orders.cancel')}
                              </button>
                            ) : (
                              <span style={{ color: "var(--text-muted)" }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: "1.5rem" }}>
              <h3 className="insight-panel-title" style={{ marginTop: 0 }}>
                {t('trade.positions.title')}
              </h3>
              <PositionsTable
                rows={portfolioRows}
                companies={companies}
                loading={loadingPrices}
                t={t}
                assetPath={assetPath}
                placeholderLogoPath={placeholderLogoPath}
                locale={locale}
                showActions
                actionLabel={t('trade.actions.sell')}
                onAction={handlePrefillSell}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function shouldTrigger(order: ConditionalOrder, price: number) {
  if (!Number.isFinite(price) || price <= 0) return false;
  const target = order.triggerPrice ?? 0;
  if (!Number.isFinite(target) || target <= 0) return false;
  const epsilon = 1e-6;
  if (order.triggerType === "gte") {
    return price >= target - epsilon;
  }
  return price <= target + epsilon;
}

function fmtQty(n:number){
  return n.toLocaleString(undefined,{maximumFractionDigits:6});
}

