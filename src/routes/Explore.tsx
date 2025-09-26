import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import provider from "../lib/prices";
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

export default function Explore() {
  const { t } = useI18n();
  const [symbol, setSymbol] = useState<string>("AAPL");
  const [tf, setTf] = useState<TF>("6M");
  const [data, setData] = useState<{ date: string; close: number }[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [expandedMarkets, setExpandedMarkets] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const searchMode = trimmedQuery.length > 0;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

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
    if (!canvasRef.current) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: filtered.map((d) => d.date),
        datasets: [{ label: symbol, data: filtered.map((d) => d.close) }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        elements: { line: { tension: 0.25 }, point: { radius: 0 } },
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { maxTicksLimit: 6 } } },
      },
    });
    return () => chartRef.current?.destroy();
  }, [filtered, symbol]);

  const lastClose = filtered.at(-1)?.close ?? data.at(-1)?.close ?? 0;

  const toggleMarket = (code: string) => {
    setExpandedMarkets((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const asset = (path: string) => {
    if (/^https?:/i.test(path)) return path;
    const base = ((import.meta as any).env?.BASE_URL as string | undefined) ?? "/";
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    const trimmed = path.replace(/^\/+/, "");
    return `${normalizedBase}${trimmed}`;
  };

  const placeholderLogo = asset("img/logo-placeholder.svg");

  return (
    <main className="explore-page">
      <div className={`explore-layout${sidebarOpen ? "" : " sidebar-collapsed"}`}>
        <aside className={`explore-sidebar${sidebarOpen ? "" : " hidden"}`}>
          <div className="explore-sidebar-header">
            <h3>{t('explore.markets')}</h3>
            <button
              type="button"
              className="explore-sidebar-toggle"
              onClick={() => setSidebarOpen(false)}
              aria-label={t('explore.hideSidebar')}
              title={t('explore.hideSidebar')}
            >
              <span className="explore-toggle-icon" aria-hidden="true" />
            </button>
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
                    const logoPath = company.logo ? asset(company.logo) : placeholderLogo;
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
                const iconSrc = asset(MARKET_ICONS[group.code] ?? DEFAULT_MARKET_ICON);
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
                          const logoPath = company.logo ? asset(company.logo) : placeholderLogo;
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
        </aside>

        <div className="explore-main">
          {!sidebarOpen && (
            <button
              type="button"
              className="explore-sidebar-toggle open"
              onClick={() => setSidebarOpen(true)}
              aria-label={t('explore.showSidebar')}
              title={t('explore.showSidebar')}
            >
              <span className="explore-toggle-icon" aria-hidden="true" />
            </button>
          )}
          <div className="explore-toolbar">
            <div className="explore-selected">
              <h2>{selectedCompany?.symbol ?? symbol}</h2>
              <p>{selectedCompany?.name ?? symbol}</p>
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
            <canvas ref={canvasRef} />
          </div>
          <p className="hint">{t("explore.sourceHint")}</p>
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
