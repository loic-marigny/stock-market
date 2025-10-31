// src/routes/Portfolio.tsx
import { useEffect, useMemo, useState } from "react";
import { auth } from "../firebase";
import type { Order } from "../lib/portfolio";
import { usePortfolioSnapshot } from "../lib/usePortfolioSnapshot";
import { useI18n } from "../i18n/I18nProvider";
import provider from "../lib/prices";

// ? nouveaux imports pour r�cup�rer noms/logos comme sur Explore
import { fetchCompaniesIndex, type Company } from "../lib/companies";

import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  type TooltipContentProps,
} from "recharts";

// --- helpers UI ---
const EPSILON = 1e-9;

// m�me logique qu'Explore pour construire le chemin d'actif (BASE_URL, etc.)
const assetPath = (path: string) => {
  if (/^https?:/i.test(path)) return path;
  const base = ((import.meta as any).env?.BASE_URL as string | undefined) ?? "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const trimmed = path.replace(/^\/+/, "");
  return `${normalizedBase}${trimmed}`;
};

const PLACEHOLDER_LOGO = assetPath("img/logo-placeholder.svg");


const PIE_COLORS = [
  "#6366F1", "#22C55E", "#F59E0B", "#EC4899", "#06B6D4",
  "#84CC16", "#A855F7", "#F97316", "#60A5FA", "#10B981",
];
const OTHERS_COLOR = "rgba(148,163,184,0.85)";
const THRESHOLD_PCT = 0.03;


type Row = {
  id: string;
  symbol: string;
  qty: number;
  buyPrice: number;
  buyDate: Date;
  last: number;
  value: number;
  pnlAbs: number;
  pnlPct: number;
};

type Lot = {
  symbol: string;
  qty: number;
  price: number;
  ts: Date;
};

export default function Portfolio() {
  const { t, locale } = useI18n();
  const uid = auth.currentUser?.uid ?? null;
  const { orders, positions, prices, cash, marketValue, totalValue, loadingPrices } = usePortfolioSnapshot(uid);

  // On suppose que usePortfolioSnapshot retournera bient�t cashByCcy.
  // En attendant, fallback: tout le cash est en USD.
  const cashByCcy: Record<string, number> =
    ((usePortfolioSnapshot as any)?.cashByCcy) || { USD: cash };

  // --- conversion des liquidit�s en USD ---
  // fxRatesUSD["USD"]=1 ; fxRatesUSD["EUR"]=prix EURUSD ; fxRatesUSD["JPY"]=1 / USDJPY ; etc.
  const [fxRatesUSD, setFxRatesUSD] = useState<Record<string, number>>({ USD: 1 });

  useEffect(() => {
    let aborted = false;
    (async () => {
      const ccys = Object.keys(cashByCcy).map(c => c.toUpperCase()).filter(c => c !== "USD");
      if (!ccys.length) { setFxRatesUSD({ USD: 1 }); return; }

      const next: Record<string, number> = { USD: 1 };
      for (const ccy of ccys) {
        try {
          // Essai direct: EURUSD, GBPUSD, etc. (USD par unit� de ccy)
          const direct = await provider.getLastPrice(`${ccy}USD`);
          if (Number.isFinite(direct) && direct > 0) { next[ccy] = direct; continue; }

          // Sinon, on essaie USDJPY, USDCHF, etc. (inverser)
          const inverse = await provider.getLastPrice(`USD${ccy}`);
          if (Number.isFinite(inverse) && inverse > 0) { next[ccy] = 1 / inverse; continue; }

          next[ccy] = 1; // fallback "neutre" si pas dispo
        } catch {
          next[ccy] = 1;
        }
      }
      if (!aborted) setFxRatesUSD(next);
    })();
    return () => { aborted = true; };
  }, [JSON.stringify(Object.keys(cashByCcy).sort())]);


  // ?? charger l'index des soci�t�s pour avoir noms/logos
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idx = await fetchCompaniesIndex();
        if (!cancelled) setCompanies(idx);
      } catch {
        // silencieux : l'UI g�re l'absence de logo/nom avec des fallbacks
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Couleurs fixes pour devises (teal & d�riv�s)
  const CASH_COLORS: Record<string, string> = {
    USD: "#0F766E",
    EUR: "#0EA5E9",
    JPY: "#06B6D4",
    GBP: "#14B8A6",
    CHF: "#0891B2",
  };

  const normalizeCcy = (x: string) => x?.trim().toUpperCase();

  const bySymbol = useMemo(() => {
    const map = new Map<string, Company>();
    for (const c of companies) map.set(c.symbol, c);
    return map;
  }, [companies]);

  const openLots = useMemo(() => buildOpenLots(orders), [orders]);
  const rows: Row[] = useMemo(() => buildRows(openLots, prices), [openLots, prices]);

  // Composition des positions (hors cash), regroupement �Autres� pour petites parts
  type Slice = {
    key: string;
  label: string;
  value: number;
  symbol?: string;
  isOthers?: boolean;
  color?: string; // ? on garde la couleur pour synchroniser chart & l�gende
  unit?: string;
};

  const rawCurrencyUnit = t('portfolio.currency.unit');
  const currencyUnit = rawCurrencyUnit === 'portfolio.currency.unit' ? 'USD' : rawCurrencyUnit;

  const compositionBase: Slice[] = useMemo(() => {
    const slices: Slice[] = [];
    for (const [symbol, pos] of Object.entries(positions)) {
      const qty = pos.qty;
      if (Math.abs(qty) <= EPSILON) continue;
      const px = prices[symbol];
      if (typeof px !== "number" || !Number.isFinite(px)) continue;
      const value = qty * px;
      if (value <= 0) continue;
      const comp = bySymbol.get(symbol);
      const label = comp?.name || symbol;
      slices.push({ key: symbol, label, value, symbol });
    }
    return slices.sort((a, b) => b.value - a.value);
  }, [positions, prices, bySymbol]);

  const pieData: Slice[] = useMemo(() => {
    const total = compositionBase.reduce((acc, slice) => acc + slice.value, 0);
    if (total <= 0) return [];

    const big: Slice[] = [];
    const small: Slice[] = [];
    for (const slice of compositionBase) {
      ((slice.value / total) >= THRESHOLD_PCT ? big : small).push(slice);
    }

    if (small.length) {
      big.push({
        key: "__OTHERS__",
        label: (t('portfolio.composition.others') as string) || "Autres",
        value: small.reduce((acc, s) => acc + s.value, 0),
        isOthers: true,
      });
    }

    // ? fixe la couleur ici pour rester coh�rent avec la l�gende m�me si on r�ordonne l�affichage
    return big.map((s, idx) => ({
      ...s,
      color: s.isOthers ? OTHERS_COLOR : PIE_COLORS[idx % PIE_COLORS.length],
      unit: currencyUnit,
    }));
  }, [compositionBase, t, currencyUnit]);


  const pieWithCashData: Slice[] = useMemo(() => {
    const positions = pieData.map(s => ({ ...s })); // conserve couleurs des positions

    // cash par devise
    const cashSlices: Slice[] = Object.entries(cashByCcy)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([ccy, v]) => {
        const normalized = normalizeCcy(ccy);
        return {
          key: `__CASH_${normalized}__`,
          label: `${(t('portfolio.composition.cash') as string) || 'Liquidit�s'} ${normalized}`,
          value: v,
          color: CASH_COLORS[normalized] || "#0F766E",
          unit: normalized,
        };
      });

    if (!positions.length && !cashSlices.length) return [];
    return [...positions, ...cashSlices];
  }, [pieData, cashByCcy, t]);
  const pieTotal = useMemo(() => pieData.reduce((acc, slice) => acc + slice.value, 0), [pieData]);
  const pieWithCashTotal = useMemo(() => pieWithCashData.reduce((acc, slice) => acc + slice.value, 0), [pieWithCashData]);
  const buyDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale]
  );

  // petit helper de traduction avec fallback
  const tt = (primaryKey: string, fallbackKey: string, fallback: string) =>
    (t as any)?.(primaryKey) ?? (t as any)?.(fallbackKey) ?? fallback;


  type HistPoint = { label: string; stocks: number; cash: number };

  const historyDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
    [locale]
  );
  const historyTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale]
  );

  /* mock donn�es historiques pour l'instant */
  const historyData: HistPoint[] = useMemo(() => {
    const now = new Date();
    const points: HistPoint[] = [];
    const baseStocks = 14000;
    const baseCash = 3200;

    for (let step = 13; step >= 0; step--) {
      const ts = new Date(now.getTime() - step * 12 * 60 * 60 * 1000); // deux relev�s par jour
      const index = 13 - step;
      const stocksTrend = baseStocks + index * 180 + Math.sin(index / 2) * 350;
      const cashTrend = baseCash + index * 35 + Math.cos(index / 3) * 140;
      const dateLabel = historyDateFormatter.format(ts);
      const timeLabel = historyTimeFormatter.format(ts);
      points.push({
        label: `${dateLabel}\n${timeLabel}`,
        stocks: Math.round(stocksTrend),
        cash: Math.round(cashTrend),
      });
    }
    return points;
  }, [historyDateFormatter, historyTimeFormatter]);

  function LegendTable({
    data,
    bySymbol,
    fxRatesUSD,
  }: {
    data: Slice[];
    bySymbol: Map<string, Company>;
    fxRatesUSD: Record<string, number>;
    showLogos?: boolean;
  }) {

    return (
      <div style={{ display: "grid", gap: 6 }}>
        {data
          .slice()
          .sort((a, b) => b.value - a.value)
          .map((s) => {
            const isCash = s.key.startsWith("__CASH_");
            const ccy = isCash ? s.key.replace("__CASH_", "") : "";
            const comp = (!isCash && s.symbol) ? bySymbol.get(s.symbol) : undefined;
            const logo = comp?.logo ? assetPath(comp.logo) : PLACEHOLDER_LOGO;
            const usd = isCash ? (s.value * (fxRatesUSD[ccy] ?? 1)) : s.value;
            const pct = (s.value / (data.reduce((a, x) => a + x.value, 0) || 1)) * 100;

            // colonnes: �pastille �(logo+nom) �% �USD
            return (
              <div
                key={s.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "12px minmax(0,1fr) 68px 90px",
                  alignItems: "center",
                  gap: 10,
                  lineHeight: 1.15,
                }}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: 2,
                  background: s.color || "#999", boxShadow: "0 0 0 2px rgba(0,0,0,0.05)"
                }}/>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {!isCash && !s.isOthers && (
                    <img src={logo} alt="" style={{ width: 18, height: 18, borderRadius: 5, objectFit: "contain", flex: "0 0 auto" }}/>
                  )}
                  <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.label}
                  </strong>
                </div>
                <span className="hint" style={{ textAlign: "right" }}>{pct.toFixed(1)}%</span>
                <span className="hint" style={{ textAlign: "right" }}>{fmt(usd)}</span>
              </div>
            );
          })}
      </div>
    );
  }


  return (
    <div className="page-main portfolio-page">
      <div className="container">
        {/* Header de page */}
        <header className="portfolio-header">
          <div className="portfolio-title-card">
            <h1>{t('portfolio.title')}</h1>
          </div>
        </header>

        {/* ===== KPIs avec info-tooltips ===== */}
        <div className="grid-cards">
          <div className="kpi-card">
            <div style={{display:"flex", alignItems:"center", gap:8, justifyContent: "space-between", width: "100%" }}>
              <div className="kpi-k">{t('portfolio.cards.cash')}</div>
              <span className="info-tooltip" aria-hidden="false">
                <button
                  type="button"
                  className="info-btn"
                  aria-label={`${t('portfolio.cards.cash')}: ${t('portfolio.help.cash') ?? 'Liquidit�s disponibles pour acheter'}`}
                >
                  i
                </button>
                <span role="tooltip" className="info-tooltip-content">
                  {t('portfolio.help.cash') ?? "Montant de liquidit�s imm�diatement disponibles pour ex�cuter des achats."}
                </span>
              </span>
            </div>
            <div className="kpi-v">
              <span>{fmt(totalSafe(cash))}</span>
              <span className="kpi-unit">{currencyUnit}</span>
            </div>
          </div>

          <div className="kpi-card">
            <div style={{display:"flex", alignItems:"center", gap:8, justifyContent: "space-between", width: "100%" }}>
              <div className="kpi-k">{t('portfolio.cards.positionValue')}</div>
              <span className="info-tooltip">
                <button
                  type="button"
                  className="info-btn"
                  aria-label={`${t('portfolio.cards.positionValue')}: ${t('portfolio.help.positionValue') ?? 'Valeur de march� des positions'}`}
                >
                  i
                </button>
                <span role="tooltip" className="info-tooltip-content">
                  {t('portfolio.help.positionValue') ?? "Somme des valeurs actuelles (dernier prix � quantit�) de toutes les positions."}
                </span>
              </span>
            </div>
            <div className="kpi-v">
              <span>{fmt(totalSafe(marketValue))}</span>
              <span className="kpi-unit">{currencyUnit}</span>
            </div>
          </div>

          <div className="kpi-card">
            <div style={{display:"flex", alignItems:"center", gap:8, justifyContent: "space-between", width: "100%" }}>
              <div className="kpi-k">{t('portfolio.cards.totalValue')}</div>
              <span className="info-tooltip">
                <button
                  type="button"
                  className="info-btn"
                  aria-label={`${t('portfolio.cards.totalValue')}: ${t('portfolio.help.totalValue') ?? 'Cash + valeur des positions'}`}
                >
                  i
                </button>
                <span role="tooltip" className="info-tooltip-content">
                  {t('portfolio.help.totalValue') ?? "Somme du cash et de la valeur de vos positions (patrimoine total du portefeuille)."}
                </span>
              </span>
            </div>
            <div className="kpi-v">
              <span>{fmt(totalSafe(totalValue))}</span>
              <span className="kpi-unit">{currencyUnit}</span>
            </div>
          </div>
        </div>

        
        {/* ===== Deux camemberts c�te � c�te ===== */}
        {(pieData.length > 0 || pieWithCashData.length > 0) && (
          <div className="grid-charts-2">
            {/* ===== Camembert hors liquidit�s ===== */}
            {pieData.length > 0 && (
              <div className="chart-card" style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <h3 className="insight-panel-title" style={{ margin: 0 }}>
                    {(t('portfolio.composition.title') as string) || "Composition du portefeuille"}
                  </h3>
                  <div className="hint" style={{ margin: 0 }}>
                    {(t('portfolio.composition.note') as string) || "Hors liquidit�s"}
                  </div>
                </div>

                <div style={{ minHeight: 260, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                  <div style={{ width: "100%", maxWidth: 360, height: 260, minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          labelLine={false}
                          isAnimationActive={false}
                        >
                          {pieData.map((entry) => (
                            <Cell
                              key={entry.key}
                              fill={entry.color || OTHERS_COLOR}
                              stroke="rgba(255,255,255,0.85)"
                            />
                          ))}
                        </Pie>
                          <Tooltip
                            content={<PieTooltip total={pieTotal} unit={currencyUnit} />}
                            wrapperStyle={{ zIndex: 9999, pointerEvents: "none" }}
                            contentStyle={{
                              backgroundColor: "transparent",
                              border: "none",
                              boxShadow: "none",
                              padding: 0,
                            }}
                          />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* L�gende sous le graphique (m�me structure que droite) */}
                  <div style={{ width: "100%", maxWidth: 360 }}>
                    <LegendTable data={pieData} bySymbol={bySymbol} fxRatesUSD={{ USD: 1 }} />
                  </div>
                </div>
              </div>
            )}

            {/* ===== Camembert avec liquidit�s ===== */}
            {pieWithCashData.length > 0 && (
              <div className="chart-card" style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <h3 className="insight-panel-title" style={{ margin: 0 }}>
                    {(t('portfolio.composition.withCash.title') as string) || "Portefeuille (avec liquidit�s)"}
                  </h3>
                  <div className="hint" style={{ margin: 0 }}>
                    {(t('portfolio.composition.withCash.note') as string) || "Inclut les liquidit�s"}
                  </div>
                </div>

                <div style={{ minHeight: 260, minWidth: 0 }}>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={pieWithCashData}
                        dataKey="value"
                        nameKey="label"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          labelLine={false}
                          isAnimationActive={false}
                        >
                          {pieWithCashData.map((entry) => (
                            <Cell key={entry.key} fill={entry.color || OTHERS_COLOR} stroke="rgba(255,255,255,0.85)" />
                          ))}
                        </Pie>
                        <Tooltip
                          content={<PieTooltip total={pieWithCashTotal} unit={currencyUnit} />}
                          wrapperStyle={{ zIndex: 9999, pointerEvents: "none" }}
                          contentStyle={{
                            backgroundColor: "transparent",
                            border: "none",
                            boxShadow: "none",
                            padding: 0,
                          }}
                        />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                  {/* L�gende d�taill�e */}
                  <div style={{ display:"flex", flexDirection:"column", gap:8, alignSelf:"center" }}>
                    <LegendTable data={pieWithCashData} bySymbol={bySymbol} fxRatesUSD={fxRatesUSD} />
                  </div>
              </div>
            )}
          </div>
        )}

        {/* ===== Stacked Area Chart (mock) ===== */}
        {historyData.length > 0 && (
          <div className="chart-card" style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <h3 className="insight-panel-title" style={{ margin: 0 }}>
                {(t('portfolio.history.title') as string) || "Historique du patrimoine"}
              </h3>
              <div className="hint" style={{ margin: 0 }}>
                {(t('portfolio.history.note') as string) || "R�partition actions + liquidit�s (mock)"}
              </div>
            </div>

            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historyData} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.1)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: "#475569" }}
                    minTickGap={18}
                  />
                  <YAxis
                    tickFormatter={(n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    tick={{ fontSize: 12, fill: "#475569" }}
                  />
                  <Tooltip
                    formatter={(v: any, name: any) => [fmt(Number(v) || 0), name === "stocks" ? (t('portfolio.history.stocks') as string) || "Actions" : (t('portfolio.history.cash') as string) || "Liquidit�s"]}
                    labelFormatter={(lab: any) => String(lab).split("\n").join(" \u00B7 ")}
                  />
                  {/* Actions */}
                  <Area type="monotone" dataKey="stocks" stackId="1" stroke="#6366F1" fill="rgba(99,102,241,0.45)" />
                  {/* Liquidit�s */}
                  <Area type="monotone" dataKey="cash" stackId="1" stroke="#0F766E" fill="rgba(15,118,110,0.45)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}


        {/* ===== Tableau positions ===== */}
        <div className="table-card">
          <table className="table">
            <thead>
              <tr>
                <th style={{textAlign:"left"}}>
                  <HeaderWithInfo
                    label={tt('portfolio.table.headers.company','portfolio.table.headers.symbol','Company')}
                    help={t('portfolio.help.company') ?? "Nom de l�entreprise et symbole boursier."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.qty')}
                    help={t('portfolio.help.qty') ?? "Nombre d�actions/parts d�tenues."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.buyPrice')}
                    help={t('portfolio.help.buyPrice') ?? "Prix d'achat de ce lot sp�cifique."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.buyDate')}
                    help={t('portfolio.help.buyDate') ?? "Date et heure de l'ex�cution de l'achat."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.last')}
                    help={t('portfolio.help.last') ?? "Dernier prix de march� connu pour le titre."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.value')}
                    help={t('portfolio.help.value') ?? "Valeur actuelle de la ligne (dernier prix � quantit�)."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.pnl')}
                    help={t('portfolio.help.pnl') ?? "Gain/Perte latent(e) : (dernier prix - PRU) � quantit�. Entre parenth�ses : en %."}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    {loadingPrices ? t('portfolio.table.loading') : t('portfolio.table.empty')}
                  </td>
                </tr>
              ) : rows.map(r => {
                const comp = bySymbol.get(r.symbol);
                const logo = comp?.logo ? assetPath(comp.logo) : PLACEHOLDER_LOGO;
                const displayName = comp?.name || r.symbol;

                return (
                  <tr key={r.id}>
                    <td style={{textAlign:"left"}}>
                      <div style={{display:"flex", alignItems:"center", gap:10}}>
                        <img
                          src={logo}
                          alt={`${displayName} logo`}
                          style={{
                            width: 24, height: 24, borderRadius: 8,
                            objectFit: "contain", background: "transparent"
                          }}
                        />
                        <div style={{display:"flex", flexDirection:"column", lineHeight:1.2}}>
                          <span style={{fontWeight:700}}>{displayName}</span>
                          <span style={{fontSize:"0.8rem", color:"var(--text-muted)"}}>{r.symbol}</span>
                        </div>
                      </div>
                    </td>
                    <td className="num">{r.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td className="num">{fmt(r.buyPrice)}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right", color: "var(--text-muted)" }}>
                      {buyDateFormatter.format(r.buyDate)}
                    </td>
                    <td className="num">{fmt(r.last)}</td>
                    <td className="num">{fmt(r.value)}</td>
                    <td className={"num " + (r.pnlAbs >= 0 ? "pos" : "neg")}>
                      {fmt(r.pnlAbs)} <span className={r.pnlPct >= 0 ? "pos" : "neg"}>({r.pnlPct.toFixed(1)}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="hint">{t('portfolio.hint')}</p>
      </div>
    </div>
  );
}

// ====== Petites briques r�utilisables ======

function HeaderWithInfo({ label, help }: { label: string; help: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", width: "100%" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span className="info-tooltip">
        <button type="button" className="info-btn" aria-label={`${label}: ${help}`}>i</button>
        <span role="tooltip" className="info-tooltip-content">{help}</span>
      </span>
    </div>
  );
}

function buildOpenLots(orders: Order[]): Lot[] {
  if (!orders.length) return [];

  const sorted = [...orders].sort((a, b) => toDate(a.ts).getTime() - toDate(b.ts).getTime());
  const perSymbol = new Map<string, Lot[]>();

  for (const order of sorted) {
    const queue = perSymbol.get(order.symbol) ?? [];
    if (!perSymbol.has(order.symbol)) perSymbol.set(order.symbol, queue);
    const ts = toDate(order.ts);

    if (order.side === "buy") {
      queue.push({ symbol: order.symbol, qty: order.qty, price: order.fillPrice, ts });
      continue;
    }

    let remaining = order.qty;
    while (remaining > EPSILON && queue.length) {
      const lot = queue[0];
      if (lot.qty > remaining + EPSILON) {
        lot.qty -= remaining;
        remaining = 0;
      } else {
        remaining -= lot.qty;
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

function buildRows(lots: Lot[], prices: Record<string, number>): Row[] {
  return lots
    .map((lot, index) => {
      const last = prices[lot.symbol] ?? 0;
      const value = lot.qty * last;
      const pnlAbs = (last - lot.price) * lot.qty;
      const pnlPct = lot.price ? (last / lot.price - 1) * 100 : 0;
      return {
        id: `${lot.symbol}-${lot.ts.toISOString()}-${index}`,
        symbol: lot.symbol,
        qty: lot.qty,
        buyPrice: lot.price,
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

function toDate(raw: any): Date {
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

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function totalSafe(n: number) {
  return Number.isFinite(n) ? n : 0;
}

type PieTooltipProps = Partial<TooltipContentProps<number, string>> & {
  total: number;
  unit: string;
};

function PieTooltip(props: PieTooltipProps) {
  const { active, total, unit: fallbackUnit, payload = [] } = props;
  if (!active || payload.length === 0) return null;

  const entry = payload[0];
  const slice: any = entry?.payload ?? {};
  const label = slice?.label ?? entry?.name ?? "";
  const color: string = slice?.color ?? entry?.color ?? "#6366F1";

  const rawValue =
    typeof entry?.value === "number"
      ? entry.value
      : typeof slice?.value === "number"
      ? slice.value
      : Number(entry?.value ?? slice?.value ?? Number.NaN);
  const safeValue = Number.isFinite(rawValue) ? rawValue : 0;
  const sliceUnit = slice?.unit ?? slice?.currency ?? fallbackUnit ?? "";
  const percentFraction = total ? safeValue / total : 0;
  const percentLabel = Number.isFinite(percentFraction)
    ? `${(percentFraction * 100).toFixed(1)}%`
    : null;
  const valueLabel = safeValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const unitLabel = sliceUnit ? `${valueLabel} ${sliceUnit}` : valueLabel;

  if (!label && !percentLabel && !unitLabel) return null;

  return (
    <div className="pie-hover-label" style={{ borderColor: color }}>
      <div className="pie-hover-label-header">
        <span className="pie-hover-label-dot" style={{ backgroundColor: color }} />
        <span className="pie-hover-label-name">{label || percentLabel || unitLabel}</span>
      </div>
      {(percentLabel || unitLabel) && (
        <div className="pie-hover-label-meta">
          {percentLabel && <span className="pie-hover-label-percent">{percentLabel}</span>}
          {percentLabel && unitLabel && <span className="pie-hover-label-separator">•</span>}
          {unitLabel && <span className="pie-hover-label-value">{unitLabel}</span>}
        </div>
      )}
    </div>
  );
}
