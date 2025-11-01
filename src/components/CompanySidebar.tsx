import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Company } from "../lib/companies";

const MARKET_ICONS: Record<string, string> = {
  US: "img/companies/categories/us.png",
  CN: "img/companies/categories/cn.png",
  EU: "img/companies/categories/eu.png",
  JP: "img/companies/categories/jp.png",
  SA: "img/companies/categories/sa.png",
  IDX: "img/companies/categories/world.png",
  COM: "img/companies/categories/commodities.png",
  CRYPTO: "img/companies/categories/crypto.svg",
  FX: "img/companies/categories/forex.png",
};

const DEFAULT_MARKET_ICON = "img/companies/categories/world.png";

type GroupedCompany = {
  code: string;
  label: string;
  companies: Company[];
};

export type CompanySidebarProps = {
  companies: Company[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand?: () => void;
  title: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  hideLabel: string;
  assetPath: (path: string) => string;
  placeholderLogoPath: string;
  marketLabel: (code: string) => string;
  classNamePrefix?: string;
  marketIcons?: Record<string, string>;
  defaultMarketIcon?: string;
  focusOnMount?: boolean;
  onFocusHandled?: () => void;
};

const groupByMarket = (list: Company[]): Record<string, Company[]> => {
  const map: Record<string, Company[]> = {};
  for (const company of list) {
    const key = (company.market || "OTHER").toUpperCase();
    (map[key] ||= []).push(company);
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
};

function CompanySidebarComponent(props: CompanySidebarProps) {
  const {
    companies,
    selectedSymbol,
    onSelectSymbol,
    collapsed,
    onCollapse,
    onExpand,
    title,
    searchPlaceholder,
    noResultsLabel,
    hideLabel,
    assetPath,
    placeholderLogoPath,
    marketLabel,
    classNamePrefix = "explore",
    marketIcons = MARKET_ICONS,
    defaultMarketIcon = DEFAULT_MARKET_ICON,
    focusOnMount = false,
    onFocusHandled,
  } = props;

  const [query, setQuery] = useState<string>("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const asideRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const trimmedQuery = query.trim();
  const searchMode = trimmedQuery.length > 0;

  const grouped = useMemo<GroupedCompany[]>(() => {
    const ordered = groupByMarket(companies);
    return Object.entries(ordered).map(([code, list]) => ({
      code,
      label: marketLabel(code),
      companies: list,
    }));
  }, [companies, marketLabel]);

  useEffect(() => {
    setExpanded((prev) => {
      let changed = false;
      const next = { ...prev };
      grouped.forEach((group, index) => {
        if (!(group.code in next)) {
          const containsSelected = group.companies.some((company) => company.symbol === selectedSymbol);
          next[group.code] = containsSelected || index === 0;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [grouped, selectedSymbol]);

  useEffect(() => {
    const owner = grouped.find((group) =>
      group.companies.some((company) => company.symbol === selectedSymbol),
    );
    if (!owner) return;
    setExpanded((prev) => {
      if (prev[owner.code]) return prev;
      return { ...prev, [owner.code]: true };
    });
  }, [grouped, selectedSymbol]);

  useEffect(() => {
    const node = asideRef.current;
    if (!node) return;
    if (collapsed) {
      node.setAttribute("inert", "");
    } else {
      node.removeAttribute("inert");
    }
  }, [collapsed]);

  useEffect(() => {
    if (!collapsed && focusOnMount) {
      const frame = requestAnimationFrame(() => {
        searchInputRef.current?.focus({ preventScroll: true });
        onFocusHandled?.();
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [collapsed, focusOnMount, onFocusHandled]);

  const filteredCompanies = useMemo(() => {
    if (!searchMode) return companies;
    const q = trimmedQuery.toLowerCase();
    return companies.filter(
      (company) =>
        company.symbol.toLowerCase().includes(q) ||
        (company.name ?? "").toLowerCase().includes(q),
    );
  }, [companies, searchMode, trimmedQuery]);

  const searchResults = useMemo(() => {
    if (!searchMode) return [];
    return [...filteredCompanies].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [filteredCompanies, searchMode]);

  const toggleGroup = useCallback((code: string) => {
    setExpanded((prev) => ({ ...prev, [code]: !prev[code] }));
  }, []);

  const handleSelect = useCallback((symbol: string) => {
    if (collapsed && onExpand) onExpand();
    onSelectSymbol(symbol);
  }, [collapsed, onExpand, onSelectSymbol]);

  const prefix = classNamePrefix;
  const sidebarClass = `${prefix}-sidebar${collapsed ? " hidden" : ""}`;
  const toggleClass = `${prefix}-sidebar-toggle`;
  const contentClass = `${prefix}-sidebar-content`;
  const headerClass = `${prefix}-sidebar-header`;
  const searchClass = `${prefix}-search`;
  const groupsClass = `${prefix}-groups`;
  const noResultsClass = `${prefix}-no-results`;
  const symbolsClass = `${prefix}-symbols`;
  const groupClass = `${prefix}-group`;
  const groupHeaderClass = `${prefix}-group-header`;
  const chevronClass = `${prefix}-chevron`;

  const placeholderLogo = useMemo(
    () => assetPath(placeholderLogoPath),
    [assetPath, placeholderLogoPath],
  );

  return (
    <aside
      ref={asideRef}
      className={sidebarClass}
      aria-hidden={collapsed}
    >
      <button
        type="button"
        className={toggleClass}
        onClick={onCollapse}
        aria-label={hideLabel}
        title={hideLabel}
      >
        <span className={`${prefix}-toggle-icon`} aria-hidden="true" />
      </button>
      <div className={contentClass}>
        <div className={headerClass}>
          <h3>{title}</h3>
        </div>
        <div className={searchClass}>
          <input
            ref={searchInputRef}
            type="search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={searchPlaceholder}
          />
        </div>
        <div className={groupsClass}>
          {searchMode ? (
            searchResults.length === 0 ? (
              <p className={noResultsClass}>{noResultsLabel}</p>
            ) : (
              <ul className={`${symbolsClass} search-results`}>
                {searchResults.map((company) => {
                  const logoPath = company.logo ? assetPath(company.logo) : placeholderLogo;
                  const isActive = company.symbol === selectedSymbol;
                  return (
                    <li key={company.symbol}>
                      <button
                        type="button"
                        className={`${prefix}-symbol${isActive ? " active" : ""}`}
                        onClick={() => handleSelect(company.symbol)}
                      >
                        <img
                          src={logoPath}
                          alt={`${company.name || company.symbol} logo`}
                          loading="lazy"
                          decoding="async"
                        />
                        <span>{`${company.symbol} - ${company.name || company.symbol}`}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            grouped.map((group) => {
              const expandedGroup = !!expanded[group.code];
              const panelId = `${prefix}-market-${group.code}`;
              const iconSrc = assetPath(marketIcons[group.code] ?? defaultMarketIcon);
              if (!group.companies.length) return null;
              return (
                <div key={group.code} className={groupClass}>
                  <button
                    type="button"
                    className={groupHeaderClass}
                    onClick={() => toggleGroup(group.code)}
                    aria-expanded={expandedGroup}
                    aria-controls={panelId}
                  >
                    <img src={iconSrc} alt="" className={`${prefix}-market-icon`} aria-hidden="true" />
                    <span>{group.label}</span>
                    <span className={`${chevronClass}${expandedGroup ? " open" : ""}`} aria-hidden="true" />
                  </button>
                  {expandedGroup && (
                    <ul className={symbolsClass} id={panelId}>
                      {group.companies.map((company) => {
                        const logoPath = company.logo ? assetPath(company.logo) : placeholderLogo;
                        const isActive = company.symbol === selectedSymbol;
                        return (
                          <li key={company.symbol}>
                            <button
                              type="button"
                              className={`${prefix}-symbol${isActive ? " active" : ""}`}
                              onClick={() => handleSelect(company.symbol)}
                            >
                              <img
                                src={logoPath}
                                alt={`${company.name || company.symbol} logo`}
                                loading="lazy"
                                decoding="async"
                              />
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
  );
}

const CompanySidebar = memo(CompanySidebarComponent);

export default CompanySidebar;
