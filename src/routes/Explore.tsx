import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { CandlestickSeries, createChart, type BusinessDay, type CandlestickData, type Time } from "lightweight-charts";
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

type GaugeVariant = "circular" | "linear";

type GaugeConfig = {
  value: number;
  min: number;
  max: number;
  format: (value: number) => string;
  variant?: GaugeVariant;
  target?: number;
};

type InsightItem = {
  key: string;
  label: string;
  description?: string;
  content?: ReactNode;
  gauge?: GaugeConfig;
};

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

const DEFAULT_LOGO_STYLE: CSSProperties = {
  padding: 12,
  background: "linear-gradient(135deg, rgba(244,247,254,0.95), rgba(226,232,240,0.7))",
  border: "1px solid rgba(15,23,42,0.12)",
  boxShadow: "0 4px 14px rgba(15,23,42,0.16)",
};

const assetPath = (path: string) => {
  if (/^https?:/i.test(path)) return path;
  const base = ((import.meta as any).env?.BASE_URL as string | undefined) ?? "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const trimmed = path.replace(/^\/+/, "");
  return `${normalizedBase}${trimmed}`;
};

const toBusinessDay = (value: string): BusinessDay => {
  const [year, month, day] = value.split("-").map((x) => Number.parseInt(x, 10));
  return { year, month, day } as BusinessDay;
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

const analyzeLogoAppearance = async (src: string): Promise<CSSProperties> => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  const size = 64;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("logo-load-failed"));
    image.src = src;
  });

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return DEFAULT_LOGO_STYLE;
  }
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, size, size);
  } catch {
    return DEFAULT_LOGO_STYLE;
  }
  const data = imageData.data;
  let brightnessSum = 0;
  let pixelCount = 0;
  let edgePixels = 0;
  let opaqueEdgePixels = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (a < 15) continue;
      pixelCount += 1;
      brightnessSum += 0.299 * r + 0.587 * g + 0.114 * b;
      const isEdge = x < 2 || x >= size - 2 || y < 2 || y >= size - 2;
      if (isEdge) {
        edgePixels += 1;
        if (a > 230) opaqueEdgePixels += 1;
      }
    }
  }

  const hasOpaqueFrame = edgePixels > 0 && opaqueEdgePixels / edgePixels > 0.85;
  if (hasOpaqueFrame) {
    return {
      padding: 0,
      background: "transparent",
      border: "0",
      boxShadow: "none",
      objectFit: "cover",
    };
  }

  const avgBrightness = pixelCount > 0 ? brightnessSum / pixelCount : 200;
  if (avgBrightness < 140) {
    return {
      padding: 12,
      background: "linear-gradient(135deg, rgba(248,250,252,0.96), rgba(226,232,240,0.72))",
      border: "1px solid rgba(15,23,42,0.18)",
      boxShadow: "0 4px 16px rgba(15,23,42,0.18)",
    };
  }
  if (avgBrightness > 200) {
    return {
      padding: 12,
      background: "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(30,41,59,0.75))",
      border: "1px solid rgba(15,23,42,0.32)",
      boxShadow: "0 4px 18px rgba(15,23,42,0.3)",
    };
  }
  return {
    padding: 12,
    background: "linear-gradient(135deg, rgba(240,244,255,0.95), rgba(226,232,240,0.75))",
    border: "1px solid rgba(15,23,42,0.14)",
    boxShadow: "0 4px 16px rgba(15,23,42,0.2)",
  };
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

  const applyTimeframeRange = useCallback(
    (timeframe: TF) => {
      if (!chartRef.current || data.length === 0) return;
      if (data.length < 2) {
        chartRef.current.timeScale().fitContent();
        return;
      }
      const lastEntry = data[data.length - 1];
      const lastDate = new Date(lastEntry.date);
      let fromDate = new Date(data[0].date);
      const yearStart = new Date(lastDate.getFullYear(), 0, 1);

      if (timeframe === "1M") {
        fromDate = shiftDays(lastDate, -30);
      } else if (timeframe === "6M") {
        fromDate = shiftDays(lastDate, -182);
      } else if (timeframe === "1Y") {
        fromDate = shiftDays(lastDate, -365);
      } else if (timeframe === "YTD") {
        fromDate = yearStart;
      } else if (timeframe === "MAX") {
        chartRef.current.timeScale().fitContent();
        return;
      }

      const fromEntry = data.find((d) => new Date(d.date) >= fromDate) ?? data[0];

      chartRef.current
        .timeScale()
        .setVisibleRange({ from: toBusinessDay(fromEntry.date), to: toBusinessDay(lastEntry.date) });
    },
    [data]
  );

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
      chart.resize(width, height);
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
    const formatted: CandlestickData[] = data.map((d) => ({
      time: d.date as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    seriesRef.current.setData(formatted);
  }, [data]);

  useEffect(() => {
    applyTimeframeRange(tf);
  }, [tf, applyTimeframeRange]);

  const lastClose = data.at(-1)?.close ?? 0;
  const lastCloseLabel = data.length ? lastClose.toFixed(2) : "--";

  const displayName = profile?.longName ?? selectedCompany?.name ?? symbol;
  const subtitleParts: string[] = [symbol];
  if (profile?.industryDisp) {
    subtitleParts.push(profile.industryDisp);
  } else if (selectedCompany?.sector) {
    subtitleParts.push(selectedCompany.sector);
  } else if (selectedCompany?.name) {
    subtitleParts.push(selectedCompany.name);
  }
  const subtitle = subtitleParts.join(" - ");

  const ensureProtocol = (url: string) =>
    /^https?:/i.test(url) ? url : `https://${url}`;

  const insightItems = useMemo(() => {
    if (!profile) return [];
    const items: InsightItem[] = [];

    if (profile.beta !== undefined) {
      const betaValue = profile.beta;
      const betaMin = Math.min(-1, Math.floor(betaValue - 1));
      const betaMax = Math.max(3, Math.ceil(betaValue + 1));

      items.push({
        key: "beta",
        label: t("explore.metrics.beta"),
        description: t("explore.metrics.beta.help"),
        gauge: {
          value: betaValue,
          min: betaMin,
          max: betaMax,
          target: 1,
          variant: "linear",
          format: (val) => val.toFixed(2),
        },
      });
    }

    if (profile.recommendationMean !== undefined) {
      items.push({
        key: "recommendation",
        label: t("explore.metrics.recommendationMean"),
        description: t("explore.metrics.recommendationMean.help"),
        gauge: {
          value: profile.recommendationMean,
          min: 1,
          max: 5,
          format: (val) => val.toFixed(1),
        },
      });
    }

    if (profile.auditRisk !== undefined) {
      items.push({
        key: "audit",
        label: t("explore.metrics.auditRisk"),
        description: t("explore.metrics.auditRisk.help"),
        gauge: {
          value: profile.auditRisk,
          min: 0,
          max: 10,
          format: (val) => val.toFixed(0),
        },
      });
    }

    return items;
  }, [profile, t]);

  const headerMeta = useMemo(() => {
    if (!profile) return [];
    const items: { key: string; label: string; value: ReactNode }[] = [];

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

  const headerLogo = selectedCompany?.logo ? assetPath(selectedCompany.logo) : placeholderLogo;
  const [logoStyle, setLogoStyle] = useState<CSSProperties>(DEFAULT_LOGO_STYLE);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCompany?.logo) {
      setLogoStyle(DEFAULT_LOGO_STYLE);
      return () => {
        cancelled = true;
      };
    }
    setLogoStyle(DEFAULT_LOGO_STYLE);
    analyzeLogoAppearance(headerLogo)
      .then((style) => {
        if (!cancelled) setLogoStyle(style);
      })
      .catch(() => {
        if (!cancelled) setLogoStyle(DEFAULT_LOGO_STYLE);
      });

    return () => {
      cancelled = true;
    };
  }, [headerLogo, selectedCompany?.logo]);

  const formatTick = (tick: number) =>
    Math.abs(tick) >= 10 || Number.isInteger(tick) ? tick.toFixed(0) : tick.toFixed(1);

  const Gauge = ({ label, value, min, max, format, variant = "circular", target }: { label: string } & GaugeConfig) => {
    const span = Math.max(0.0001, max - min);
    const clamped = Math.min(max, Math.max(min, value));
    const pct = (clamped - min) / span;

    if (variant === "linear") {
      const boundedPct = Math.min(100, Math.max(0, pct * 100));
      const targetPct =
        target !== undefined ? Math.min(100, Math.max(0, ((target - min) / span) * 100)) : undefined;
      const isAboveTarget = target !== undefined ? clamped >= target : pct >= 0.5;
      const color = isAboveTarget ? "var(--primary-500)" : "var(--primary-700)";
      return (
        <div className="linear-gauge" role="img" aria-label={`${label}: ${format(clamped)}`}>
          <div className="linear-gauge-value">{format(clamped)}</div>
          <div className="linear-gauge-track">
            <div
              className="linear-gauge-fill"
              style={{ width: `${boundedPct}%`, background: `linear-gradient(90deg, ${color}, rgba(147,40,192,0.45))` }}
            />
            <span className="linear-gauge-marker" style={{ left: `${boundedPct}%` }} />
            {targetPct !== undefined && <span className="linear-gauge-target" style={{ left: `${targetPct}%` }} />}
          </div>
          <div className={`linear-gauge-scale${target !== undefined ? " with-target" : ""}`}>
            <span>{formatTick(min)}</span>
            {target !== undefined && <span>{formatTick(target)}</span>}
            <span>{formatTick(max)}</span>
          </div>
        </div>
      );
    }

    const angle = pct * 360;
    const color = `hsl(${Math.max(0, 120 - pct * 120)}, 70%, 50%)`;
    return (
      <div className="gauge gauge--circular" role="img" aria-label={`${label}: ${format(clamped)}`}>
        <div
          className="gauge-dial"
          style={{
            background: `conic-gradient(${color} ${angle}deg, rgba(148,163,184,0.15) ${angle}deg)`,
          }}
        >
          <div className="gauge-cap">
            <span>{format(clamped)}</span>
          </div>
          <span className="gauge-marker gauge-marker--min">{formatTick(min)}</span>
          <span className="gauge-marker gauge-marker--max">{formatTick(max)}</span>
        </div>
      </div>
    );
  };

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
            <div className="explore-header">
              <div className="company-identity">
                <img
                  src={headerLogo}
                  alt={`${selectedCompany?.name ?? symbol} logo`}
                  className="company-logo"
                  style={logoStyle}
                />
                <div>
                  <h1>{displayName}</h1>
                  <p>{subtitle}</p>
                </div>
              </div>
              {profile?.longBusinessSummary && (
                <p className="company-summary">{profile.longBusinessSummary}</p>
              )}
              {headerMeta.length > 0 && (
                <dl className="company-meta">
                  {headerMeta.map((item) => (
                    <div key={item.key} className="company-meta-item">
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <div className="chart-card">
              <div className="chart-overlay">
                <div className="chart-last">
                  {t("explore.lastLabel")} <strong>{lastCloseLabel}</strong>
                </div>
                <div className="timeframe-group" role="group" aria-label={t("explore.timeframe.label")}>
                  {["1M", "6M", "YTD", "1Y", "MAX"].map((x) => (
                    <button
                      key={x}
                      type="button"
                      className={tf === x ? "timeframe-btn active" : "timeframe-btn"}
                      onClick={() => setTf(x as TF)}
                      aria-pressed={tf === x}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>
              <div ref={chartContainerRef} className="chart-container" />
            </div>
            {insightItems.length > 0 && (
              <section className="explore-insights">
                <h3>{t("explore.metrics.title")}</h3>
                <div className="explore-insights-grid">
                  {insightItems.map((item) => {
                    const tooltipId = `insight-${item.key}-tooltip`;
                    const tooltipLabel = item.description ? `${item.label}: ${item.description}` : item.label;
                    return (
                      <div key={item.key} className="explore-insight-card">
                        <div className="insight-header">
                          <span className="label">{item.label}</span>
                          {item.description && (
                            <span className="info-tooltip">
                              <button
                                type="button"
                                className="info-btn"
                                title={item.description}
                                aria-label={tooltipLabel}
                                aria-describedby={item.description ? tooltipId : undefined}
                              >
                                i
                              </button>
                              <span id={tooltipId} role="tooltip" className="info-tooltip-content">
                                {item.description}
                              </span>
                            </span>
                          )}
                        </div>
                        <div className="insight-body">
                          {item.gauge ? (
                            <Gauge label={item.label} {...item.gauge} />
                          ) : (
                            <div className="insight-value">{item.content ?? "--"}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
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




