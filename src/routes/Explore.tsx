import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CandlestickSeries, createChart, type CandlestickData, type Time } from "lightweight-charts";
import provider, { type OHLC } from "../lib/prices";
import { fetchCompaniesIndex, type Company, marketLabel } from "../lib/companies";
import { useI18n } from "../i18n/I18nProvider";

type TF = "1M" | "6M" | "YTD" | "1Y" | "MAX";

type GroupedCompany = {
  code: string;
  label: string;
  companies: Company[];
};

const MARKET_ICONS: Record<string, string> = {
  US: 'img/companies/categories/us.png',
  CN: 'img/companies/categories/cn.png',
  EU: 'img/companies/categories/eu.png',
  JP: 'img/companies/categories/jp.png',
  SA: 'img/companies/categories/sa.png',
  IDX: 'img/companies/categories/world.png',
  COM: 'img/companies/categories/commodities.png',
  CRYPTO: 'img/companies/categories/crypto.svg',
  FX: 'img/companies/categories/forex.png',
};

const DEFAULT_MARKET_ICON = 'img/companies/categories/world.png';

type CompanyProfile = {
  symbol: string;
  name?: string;
  sector?: string;
  longName?: string;
  longBusinessSummary?: string;
  industryDisp?: string;
  website?: string;
  irWebsite?: string;
  beta?: number;
  recommendationMean?: number;
  auditRisk?: number;
};

const assetPath = (path: string) => {
  if (/^https?:/i.test(path)) return path;
  const base = ((import.meta as any).env?.BASE_URL as string | undefined) ?? "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const trimmed = path.replace(/^\/+/, "");
  return `${normalizedBase}${trimmed}`;
};

const toNumeric = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value && typeof value === "object") {
    const container = value as Record<string, unknown>;
    if (typeof container.raw === "number" && Number.isFinite(container.raw)) return container.raw;
    if (typeof container.fmt === "number" && Number.isFinite(container.fmt)) return container.fmt;
    if (typeof container.fmt === "string") {
      const parsed = Number(container.fmt.replace(/[^\d.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};

const normalizeProfile = (raw: any): CompanyProfile => {
  const sanitizeString = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  const profile: CompanyProfile = {
    symbol: sanitizeString(raw?.symbol) ?? "",
    name: sanitizeString(raw?.name),
    sector: sanitizeString(raw?.sector),
    longName: sanitizeString(raw?.longName),
    longBusinessSummary: sanitizeString(raw?.longBusinessSummary),
    industryDisp: sanitizeString(raw?.industryDisp),
    website: sanitizeString(raw?.website),
    irWebsite: sanitizeString(raw?.irWebsite),
  };

  const beta = toNumeric(raw?.beta);
  if (beta !== undefined) profile.beta = beta;

  const recommendationMean = toNumeric(raw?.recommendationMean);
  if (recommendationMean !== undefined) profile.recommendationMean = recommendationMean;

  const auditRisk = toNumeric(raw?.auditRisk);
  if (auditRisk !== undefined) profile.auditRisk = auditRisk;

  return profile;
};

export default function Explore() {
  const { t } = useI18n();
  const [symbol, setSymbol] = useState<string>("AAPL");
  const [tf, setTf] = useState<TF>("6M");
  const [data, setData] = useState<OHLC[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [expandedMarkets, setExpandedMarkets] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const searchMode = trimmedQuery.length > 0;
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  type ChartApi = ReturnType<typeof createChart>;
  type CandlestickSeriesApi = ReturnType<ChartApi["addSeries"]>;
  const chartRef = useRef<ChartApi | null>(null);
  const seriesRef = useRef<CandlestickSeriesApi | null>(null);
  const profileCacheRef = useRef<Map<string, CompanyProfile>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idx = await fetchCompaniesIndex();
        if (cancelled) return;
        setCompanies(idx);
      } catch {
        // Ignore network errors for now; UI will simply show an empty list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!companies.length) return;
    if (companies.some((c) => c.symbol === symbol)) return;

    const firstUS = companies.find((c) => (c.market || "").toUpperCase() === "US");
    const fallback = firstUS?.symbol ?? companies[0]?.symbol;
    if (fallback) setSymbol(fallback);
  }, [companies, symbol]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hist = await provider.getDailyHistory(symbol);
        if (!cancelled) setData(hist);
      } catch {
        if (!cancelled) setData([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const grouped = useMemo<GroupedCompany[]>(() => {
    const ordered = groupByMarket(companies);
    return Object.entries(ordered).map(([code, list]) => ({
      code,
      label: marketLabel(code),
      companies: list,
    }));
  }, [companies]);

  useEffect(() => {
    if (searchMode) return;
    setExpandedMarkets((prev) => {
      const next = { ...prev };
      grouped.forEach((group, index) => {
        if (!(group.code in next)) {
          const containsSelected = group.companies.some((company) => company.symbol === symbol);
          next[group.code] = containsSelected || index === 0;
        }
      });
      return next;
    });
  }, [grouped, symbol, searchMode]);

  useEffect(() => {
    if (searchMode) return;
    const owner = grouped.find((group) =>
      group.companies.some((company) => company.symbol === symbol)
    );
    if (!owner) return;
    setExpandedMarkets((prev) => {
      if (prev[owner.code]) return prev;
      return { ...prev, [owner.code]: true };
    });
  }, [grouped, symbol, searchMode]);

  const filteredCompanies = useMemo(() => {
    if (!searchMode) return companies;
    const q = trimmedQuery.toLowerCase();
    return companies.filter(
      (c) => c.symbol.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q)
    );
  }, [companies, trimmedQuery, searchMode]);

  const searchResults = useMemo(() => {
    if (!searchMode) return [];
    return [...filteredCompanies].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [filteredCompanies, searchMode]);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.symbol === symbol) ?? null,
    [companies, symbol]
  );

  useEffect(() => {
    const company = selectedCompany;
    if (!company?.profile) {
      setProfile(null);
      return;
    }
    const profileUrl = assetPath(company.profile);
    const cached = profileCacheRef.current.get(profileUrl);
    if (cached) {
      setProfile(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(profileUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`profile fetch failed: ${response.status}`);
        const raw = await response.json();
        const normalized = normalizeProfile(raw);
        const enriched: CompanyProfile = {
          ...normalized,
          symbol: company.symbol,
          name: company.name ?? normalized.name,
          sector: company.sector ?? normalized.sector,
        };
        profileCacheRef.current.set(profileUrl, enriched);
        if (!cancelled) setProfile(enriched);
      } catch (error) {
        console.warn("[profile] load failed", error);
        if (!cancelled) setProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCompany]);

  const filtered = useMemo(() => {
    if (!data.length) return [];
    const last = new Date(data[data.length - 1].date);
    let from = new Date(data[0].date);
    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    if (tf === "1M") {
      from = shiftDays(last, -30);
    } else if (tf === "6M") {
      from = shiftDays(last, -182);
    } else if (tf === "1Y") {
      from = shiftDays(last, -365);
    } else if (tf === "YTD") {
      from = yearStart;
    }

    return data.filter((d) => new Date(d.date) >= from);
  }, [data, tf]);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const element = chartContainerRef.current;
    const chart = createChart(element, {
      width: element.clientWidth,
      height: element.clientHeight,
      layout: { background: { color: "transparent" }, textColor: "#0f172a" },
      grid: {
        vertLines: { color: "rgba(15,23,42,0.08)" },
        horzLines: { color: "rgba(15,23,42,0.05)" },
      },
      rightPriceScale: { borderColor: "rgba(15,23,42,0.08)" },
      timeScale: { borderColor: "rgba(15,23,42,0.08)" },
      crosshair: { mode: 1 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    const formatted: CandlestickData[] = filtered.map((d) => ({
      time: d.date as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    seriesRef.current.setData(formatted);
    chartRef.current?.timeScale().fitContent();
  }, [filtered]);

  const lastClose = filtered.at(-1)?.close ?? data.at(-1)?.close ?? 0;

  const displayName = profile?.longName ?? selectedCompany?.name ?? symbol;
  const subtitleParts: string[] = [symbol];
  if (profile?.industryDisp) {
    subtitleParts.push(profile.industryDisp);
  } else if (selectedCompany?.sector) {
    subtitleParts.push(selectedCompany.sector);
  } else if (selectedCompany?.name) {
    subtitleParts.push(selectedCompany.name);
  }
  const subtitle = subtitleParts.join(" · ");

  const ensureProtocol = (url: string) =>
    /^https?:/i.test(url) ? url : `https://${url}`;

  const insightItems = useMemo(() => {
    if (!profile) return [];
    const items: Array<{ key: string; label: string; value: ReactNode }> = [];
    if (profile.beta !== undefined) {
      items.push({
        key: "beta",
        label: t("explore.metrics.beta"),
        value: profile.beta.toFixed(2),
      });
    }
    if (profile.recommendationMean !== undefined) {
      items.push({
        key: "recommendation",
        label: t("explore.metrics.recommendationMean"),
        value: profile.recommendationMean.toFixed(1),
      });
    }
    if (profile.auditRisk !== undefined) {
      items.push({
        key: "audit",
        label: t("explore.metrics.auditRisk"),
        value: Math.round(profile.auditRisk).toString(),
      });
    }
    if (profile.industryDisp) {
      items.push({
        key: "industry",
        label: t("explore.metrics.industry"),
        value: profile.industryDisp,
      });
    }
    if (profile.website) {
      const href = ensureProtocol(profile.website);
      const label = profile.website.replace(/^https?:\/\//i, "");
      items.push({
        key: "website",
        label: t("explore.metrics.website"),
        value: (
          <a href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ),
      });
    }
    if (profile.irWebsite) {
      const href = ensureProtocol(profile.irWebsite);
      const label = profile.irWebsite.replace(/^https?:\/\//i, "");
      items.push({
        key: "irWebsite",
        label: t("explore.metrics.irWebsite"),
        value: (
          <a href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ),
      });
    }
    return items;
  }, [profile, t]);

  const toggleMarket = (code: string) => {
    setExpandedMarkets((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const placeholderLogo = assetPath("img/logo-placeholder.svg");

  return (
    <main className="explore-page">
      <div className={`explore-layout${sidebarOpen ? "" : " sidebar-collapsed"}`}>
        <aside className={`explore-sidebar${sidebarOpen ? "" : " hidden"}`}>
          <button
            type="button"
            className="explore-sidebar-toggle"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('explore.hideSidebar')}
            title={t('explore.hideSidebar')}
          >
            <span className="explore-toggle-icon" aria-hidden="true" />
          </button>
          <div className="explore-sidebar-content">
            <div className="explore-sidebar-header">
              <h3>{t('explore.markets')}</h3>
            </div>
            <div className="explore-search">
              <input
                type="search"
                placeholder={t('explore.searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="explore-groups">
              {searchMode ? (
                searchResults.length === 0 ? (
                  <p className="explore-no-results">{t('explore.noResults')}</p>
                ) : (
                  <ul className="explore-symbols search-results">
                    {searchResults.map((company) => {
                      const logoPath = company.logo ? assetPath(company.logo) : placeholderLogo;
                      const isActive = company.symbol === symbol;
                      return (
                        <li key={company.symbol}>
                          <button
                            type="button"
                            className={`explore-symbol${isActive ? " active" : ""}`}
                            onClick={() => {
                              setSymbol(company.symbol);
                              if (!sidebarOpen) setSidebarOpen(true);
                            }}
                          >
                            <img src={logoPath} alt={`${company.name || company.symbol} logo`} />
                            <span>{`${company.symbol} - ${company.name || company.symbol}`}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : (
                grouped.map((group) => {
                  const expanded = !!expandedMarkets[group.code];
                  const panelId = `market-${group.code}`;
                  const iconSrc = assetPath(MARKET_ICONS[group.code] ?? DEFAULT_MARKET_ICON);
                  if (!group.companies.length) return null;
                  return (
                    <div key={group.code} className="explore-group">
                      <button
                        type="button"
                        className="explore-group-header"
                        onClick={() => toggleMarket(group.code)}
                        aria-expanded={expanded}
                        aria-controls={panelId}
                      >
                        <img src={iconSrc} alt="" className="explore-market-icon" aria-hidden="true" />
                        <span>{group.label}</span>
                        <span
                          className={`explore-chevron${expanded ? " open" : ""}`}
                          aria-hidden="true"
                        />
                      </button>
                      {expanded && (
                        <ul className="explore-symbols" id={panelId}>
                          {group.companies.map((company) => {
                            const logoPath = company.logo ? assetPath(company.logo) : placeholderLogo;
                            const isActive = company.symbol === symbol;
                            return (
                              <li key={company.symbol}>
                                <button
                                  type="button"
                                  className={`explore-symbol${isActive ? " active" : ""}`}
                                  onClick={() => setSymbol(company.symbol)}
                                >
                                  <img src={logoPath} alt={`${company.name || company.symbol} logo`} />
                                  <span>{`${company.symbol} - ${company.name || company.symbol}`}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>

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
            <div className="explore-toolbar">
              <div className="explore-selected">
                <h2>{displayName}</h2>
                <p>{subtitle}</p>
              </div>
              <div className="tf">
                {["1M", "6M", "YTD", "1Y", "MAX"].map((x) => (
                  <button
                    key={x}
                    type="button"
                    className={`pill${tf === x ? " active" : ""}`}
                    onClick={() => setTf(x as TF)}
                  >
                    {x}
                  </button>
                ))}
              </div>
              <div className="price">
                {t("explore.lastLabel")} <strong>{lastClose.toFixed(2)}</strong>
              </div>
            </div>

            <div className="chart-card">
              <div ref={chartContainerRef} className="chart-container" />
            </div>
            {insightItems.length > 0 && (
              <section className="explore-insights">
                <h3>{t("explore.metrics.title")}</h3>
                <div className="explore-insights-grid">
                  {insightItems.map((item) => (
                    <div key={item.key} className="explore-insight-card">
                      <span className="label">{item.label}</span>
                      <span className="value">{item.value}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {profile?.longBusinessSummary && (
              <section className="explore-summary-card">
                <h3>{t("explore.aboutTitle")}</h3>
                <p>{profile.longBusinessSummary}</p>
              </section>
            )}
            <p className="hint">{t("explore.sourceHint")}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
function shiftDays(d: Date, delta: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  return x;
}

function groupByMarket(list: Company[]): Record<string, Company[]> {
  const map: Record<string, Company[]> = {};
  for (const c of list) {
    const key = (c.market || "OTHER").toUpperCase();
    (map[key] ||= []).push(c);
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  const ordered: Record<string, Company[]> = {};
  for (const pref of ["US", "CN", "EU", "JP", "SA", "IDX", "COM", "CRYPTO", "FX"]) {
    if (map[pref]) ordered[pref] = map[pref];
  }
  for (const key of Object.keys(map).sort()) {
    if (!(key in ordered)) ordered[key] = map[key];
  }
  return ordered;
}

