// src/routes/Portfolio.tsx
import { useEffect, useMemo, useState } from "react";
import { auth } from "../firebase";
import type { Position } from "../lib/portfolio";
import { usePortfolioSnapshot } from "../lib/usePortfolioSnapshot";
import { useI18n } from "../i18n/I18nProvider";
import provider from "../lib/prices";

// ✅ nouveaux imports pour récupérer noms/logos comme sur Explore
import { fetchCompaniesIndex, type Company } from "../lib/companies";

import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";

// --- helpers UI ---
const EPSILON = 1e-9;

// même logique qu'Explore pour construire le chemin d'actif (BASE_URL, etc.)
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
const RADIAN = Math.PI / 180;
function renderPercentLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  if (!percent || percent < 0.015) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" style={{ fontWeight: 700 }}>
      {(percent * 100).toFixed(0)}%
    </text>
  );
}


type Row = {
  symbol: string;
  qty: number;
  avg: number;
  last: number;
  value: number;
  pnlAbs: number;
  pnlPct: number;
};

export default function Portfolio() {
  const { t } = useI18n();
  const uid = auth.currentUser?.uid ?? null;
  const { positions, prices, cash, marketValue, totalValue, loadingPrices } = usePortfolioSnapshot(uid);

  // On suppose que usePortfolioSnapshot retournera bientôt cashByCcy.
  // En attendant, fallback: tout le cash est en USD.
  const cashByCcy: Record<string, number> =
    ((usePortfolioSnapshot as any)?.cashByCcy) || { USD: cash };

  // --- conversion des liquidités en USD ---
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
          // Essai direct: EURUSD, GBPUSD, etc. (USD par unité de ccy)
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


  // 🔎 charger l'index des sociétés pour avoir noms/logos
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idx = await fetchCompaniesIndex();
        if (!cancelled) setCompanies(idx);
      } catch {
        // silencieux : l'UI gère l'absence de logo/nom avec des fallbacks
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Couleurs fixes pour devises (teal & dérivés)
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

  const rows: Row[] = useMemo(() => buildRows(positions, prices), [positions, prices]);

  // Composition des positions (hors cash), regroupement “Autres” pour petites parts
  type Slice = {
    key: string;
    label: string;
    value: number;
    symbol?: string;
    isOthers?: boolean;
    color?: string; // ✅ on garde la couleur pour synchroniser chart & légende
  };

  const pieData: Slice[] = useMemo(() => {
    const total = rows.reduce((acc, r) => acc + Math.max(0, r.value), 0);
    if (total <= 0) return [];

    const base = rows
      .filter(r => r.value > 0)
      .map(r => {
        const comp = bySymbol.get(r.symbol);
        const label = comp?.name || r.symbol;
        return { key: r.symbol, label, value: r.value, symbol: r.symbol } as Slice;
      })
      .sort((a, b) => b.value - a.value);

    const big: Slice[] = [], small: Slice[] = [];
    for (const s of base) ((s.value / total) >= THRESHOLD_PCT ? big : small).push(s);

    if (small.length) {
      big.push({
        key: "__OTHERS__",
        label: (t('portfolio.composition.others') as string) || "Autres",
        value: small.reduce((acc, s) => acc + s.value, 0),
        isOthers: true,
      });
    }

    // ✅ fixe la couleur ici pour rester cohérent avec la légende même si on réordonne l’affichage
    return big.map((s, idx) => ({
      ...s,
      color: s.isOthers ? OTHERS_COLOR : PIE_COLORS[idx % PIE_COLORS.length],
    }));
  }, [rows, bySymbol, t]);


  const pieWithCashData: Slice[] = useMemo(() => {
    const positions = pieData.map(s => ({ ...s })); // conserve couleurs des positions

    // cash par devise
    const cashSlices: Slice[] = Object.entries(cashByCcy)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([ccy, v]) => ({
        key: `__CASH_${normalizeCcy(ccy)}__`,
        label: `${(t('portfolio.composition.cash') as string) || 'Liquidités'} ${normalizeCcy(ccy)}`,
        value: v,
        color: CASH_COLORS[normalizeCcy(ccy)] || "#0F766E",
      }));

    if (!positions.length && !cashSlices.length) return [];
    return [...positions, ...cashSlices];
  }, [pieData, cashByCcy, t]);



  // petit helper de traduction avec fallback
  const tt = (primaryKey: string, fallbackKey: string, fallback: string) =>
    (t as any)?.(primaryKey) ?? (t as any)?.(fallbackKey) ?? fallback;


  type HistPoint = { date: string; stocks: number; cash: number };

/* mock données historiques pour l'instant */
const historyData: HistPoint[] = useMemo(() => {
  // 12 points mensuels mock
  const base = [
    { date: "2025-01", stocks: 12000, cash: 3000 },
    { date: "2025-02", stocks: 13200, cash: 2800 },
    { date: "2025-03", stocks: 12800, cash: 3500 },
    { date: "2025-04", stocks: 14000, cash: 3200 },
    { date: "2025-05", stocks: 14500, cash: 3100 },
    { date: "2025-06", stocks: 15000, cash: 3000 },
    { date: "2025-07", stocks: 14800, cash: 3600 },
    { date: "2025-08", stocks: 15500, cash: 3400 },
    { date: "2025-09", stocks: 16000, cash: 3200 },
    { date: "2025-10", stocks: 15800, cash: 4000 },
    { date: "2025-11", stocks: 16500, cash: 3700 },
    { date: "2025-12", stocks: 17000, cash: 3500 },
  ];
  return base;
}, []);

  function LegendTable({
    data,
    bySymbol,
    fxRatesUSD,
    showLogos = true, // pour “Autres”, on masque de toute façon
  }: {
    data: Slice[];
    bySymbol: Map<string, Company>;
    fxRatesUSD: Record<string, number>;
    showLogos?: boolean;
  }) {
    const total = data.reduce((a, s) => a + s.value, 0) || 1;

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

            // colonnes: •pastille •(logo+nom) •% •USD
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
    <div className="page-main">
      <div className="container">
        {/* Header de page */}
        <header className="page-header">
          <h1 className="page-title">{t('portfolio.title')}</h1>
          {/* sous-titre optionnel ; tu peux y mettre la valeur totale, la date, etc. */}
          <span className="page-subtitle">{t('portfolio.composition.withCash.note')}</span>
        </header>

        {/* ===== KPIs avec info-tooltips ===== */}
        <div className="grid-cards">
          <div className="kpi-card">
            <div style={{display:"flex", alignItems:"center", gap:8, justifyContent: "space-between", width: "100%" }}>
              <div className="kpi-k">{t('portfolio.cards.cash')}</div>
              <span className="info-tooltip" aria-hidden="false">
                <button type="button" className="info-btn" title={t('portfolio.help.cash') ?? 'Liquidités disponibles pour acheter'}>
                  i
                </button>
                <span role="tooltip" className="info-tooltip-content">
                  {t('portfolio.help.cash') ?? "Montant de liquidités immédiatement disponibles pour exécuter des achats."}
                </span>
              </span>
            </div>
            <div className="kpi-v">{fmt(totalSafe(cash))}</div>
          </div>

          <div className="kpi-card">
            <div style={{display:"flex", alignItems:"center", gap:8, justifyContent: "space-between", width: "100%" }}>
              <div className="kpi-k">{t('portfolio.cards.positionValue')}</div>
              <span className="info-tooltip">
                <button type="button" className="info-btn" title={t('portfolio.help.positionValue') ?? 'Valeur de marché des positions'}>
                  i
                </button>
                <span role="tooltip" className="info-tooltip-content">
                  {t('portfolio.help.positionValue') ?? "Somme des valeurs actuelles (dernier prix × quantité) de toutes les positions."}
                </span>
              </span>
            </div>
            <div className="kpi-v">{fmt(totalSafe(marketValue))}</div>
          </div>

          <div className="kpi-card">
            <div style={{display:"flex", alignItems:"center", gap:8, justifyContent: "space-between", width: "100%" }}>
              <div className="kpi-k">{t('portfolio.cards.totalValue')}</div>
              <span className="info-tooltip">
                <button type="button" className="info-btn" title={t('portfolio.help.totalValue') ?? 'Cash + valeur des positions'}>
                  i
                </button>
                <span role="tooltip" className="info-tooltip-content">
                  {t('portfolio.help.totalValue') ?? "Somme du cash et de la valeur de vos positions (patrimoine total du portefeuille)."}
                </span>
              </span>
            </div>
            <div className="kpi-v">{fmt(totalSafe(totalValue))}</div>
          </div>
        </div>

        
        {/* ===== Deux camemberts côte à côte ===== */}
        {(pieData.length > 0 || pieWithCashData.length > 0) && (
          <div className="grid-charts-2">
            {/* ===== Camembert hors liquidités ===== */}
            {pieData.length > 0 && (
              <div className="chart-card" style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <h3 className="insight-panel-title" style={{ margin: 0 }}>
                    {(t('portfolio.composition.title') as string) || "Composition du portefeuille"}
                  </h3>
                  <div className="hint" style={{ margin: 0 }}>
                    {(t('portfolio.composition.note') as string) || "Hors liquidités"}
                  </div>
                </div>

                <div style={{ minHeight: 260, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                  <div style={{ width: "100%", maxWidth: 360, height: 260 }}>
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
                          label={renderPercentLabel}
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
                          formatter={(value: any, _name: string, item: any) => {
                            const v = Number(value) || 0;
                            const total = pieData.reduce((a, s) => a + s.value, 0);
                            const pct = total ? (v / total) * 100 : 0;
                            return [`${fmt(v)} (${pct.toFixed(1)}%)`, item?.payload?.label];
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Légende sous le graphique (même structure que droite) */}
                  <div style={{ width: "100%", maxWidth: 360 }}>
                    <LegendTable data={pieData} bySymbol={bySymbol} fxRatesUSD={{ USD: 1 }} />
                  </div>
                </div>
              </div>
            )}

            {/* ===== Camembert avec liquidités ===== */}
            {pieWithCashData.length > 0 && (
              <div className="chart-card" style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <h3 className="insight-panel-title" style={{ margin: 0 }}>
                    {(t('portfolio.composition.withCash.title') as string) || "Portefeuille (avec liquidités)"}
                  </h3>
                  <div className="hint" style={{ margin: 0 }}>
                    {(t('portfolio.composition.withCash.note') as string) || "Inclut les liquidités"}
                  </div>
                </div>

                <div style={{ minHeight: 260 }}>
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
                        label={renderPercentLabel}
                        isAnimationActive={false}
                      >
                        {pieWithCashData.map((entry) => (
                          <Cell key={entry.key} fill={entry.color || OTHERS_COLOR} stroke="rgba(255,255,255,0.85)" />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: any, _name: string, item: any) => {
                          const v = Number(value) || 0;
                          const total = pieWithCashData.reduce((a, s) => a + s.value, 0);
                          const pct = total ? (v / total) * 100 : 0;
                          return [`${fmt(v)} (${pct.toFixed(1)}%)`, item?.payload?.label];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                  {/* Légende détaillée */}
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
                {(t('portfolio.history.note') as string) || "Répartition actions + liquidités (mock)"}
              </div>
            </div>

            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historyData} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.1)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#475569" }} />
                  <YAxis
                    tickFormatter={(n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    tick={{ fontSize: 12, fill: "#475569" }}
                  />
                  <Tooltip
                    formatter={(v: any, name: any) => [fmt(Number(v) || 0), name === "stocks" ? (t('portfolio.history.stocks') as string) || "Actions" : (t('portfolio.history.cash') as string) || "Liquidités"]}
                    labelFormatter={(lab: any) => String(lab)}
                  />
                  {/* Actions */}
                  <Area type="monotone" dataKey="stocks" stackId="1" stroke="#6366F1" fill="rgba(99,102,241,0.45)" />
                  {/* Liquidités */}
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
                    help={t('portfolio.help.company') ?? "Nom de l’entreprise et symbole boursier."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.qty')}
                    help={t('portfolio.help.qty') ?? "Nombre d’actions/parts détenues."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.avgPrice')}
                    help={t('portfolio.help.avgPrice') ?? "Prix de revient unitaire (PRU) de la position."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.last')}
                    help={t('portfolio.help.last') ?? "Dernier prix de marché connu pour le titre."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.value')}
                    help={t('portfolio.help.value') ?? "Valeur actuelle de la ligne (dernier prix × quantité)."}
                  />
                </th>
                <th>
                  <HeaderWithInfo
                    label={t('portfolio.table.headers.pnl')}
                    help={t('portfolio.help.pnl') ?? "Gain/Perte latent(e) : (dernier prix − PRU) × quantité. Entre parenthèses : en %."}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    {loadingPrices ? t('portfolio.table.loading') : t('portfolio.table.empty')}
                  </td>
                </tr>
              ) : rows.map(r => {
                const comp = bySymbol.get(r.symbol);
                const logo = comp?.logo ? assetPath(comp.logo) : PLACEHOLDER_LOGO;
                const displayName = comp?.name || r.symbol;

                return (
                  <tr key={r.symbol}>
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
                    <td className="num">{fmt(r.avg)}</td>
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

// ====== Petites briques réutilisables ======

function HeaderWithInfo({ label, help }: { label: string; help: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", width: "100%" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span className="info-tooltip">
        <button type="button" className="info-btn" title={help} aria-label={`${label}: ${help}`}>i</button>
        <span role="tooltip" className="info-tooltip-content">{help}</span>
      </span>
    </div>
  );
}

function buildRows(positions: Record<string, Position>, prices: Record<string, number>): Row[] {
  return Object.entries(positions)
    .filter(([, p]) => Math.abs(p.qty) > EPSILON)
    .map(([symbol, p]) => {
      const last = prices[symbol] ?? 0;
      const value = p.qty * last;
      const pnlAbs = (last - p.avgPrice) * p.qty;
      const pnlPct = p.avgPrice ? (last / p.avgPrice - 1) * 100 : 0;
      return { symbol, qty: p.qty, avg: p.avgPrice, last, value, pnlAbs, pnlPct };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function totalSafe(n: number) {
  return Number.isFinite(n) ? n : 0;
}
