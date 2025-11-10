import { useMemo } from "react";
import type { Company } from "../lib/companies";
import {
  formatCompactValue,
  type PositionRow,
} from "../lib/positionsTable";

type Props = {
  rows: PositionRow[];
  companies: Company[];
  loading: boolean;
  // t: (key: string, vars?: Record<string, any>) => string;
  t: (...args: any[]) => string;
  assetPath: (path: string) => string;
  placeholderLogoPath: string;
  locale: string;
  showActions?: boolean;
  actionLabel?: string;
  onAction?: (row: PositionRow) => void;
};

const noop = () => {};

export default function PositionsTable({
  rows,
  companies,
  loading,
  t,
  assetPath,
  placeholderLogoPath,
  locale,
  showActions = false,
  actionLabel,
  onAction,
}: Props) {
  const bySymbol = useMemo(
    () => new Map(companies.map((company) => [company.symbol, company])),
    [companies],
  );
  const buyDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const effectiveActionLabel = actionLabel ?? t("trade.actions.sell");
  const tt = (primaryKey: string, fallbackKey: string, fallback: string) =>
    (t as any)?.(primaryKey) ?? (t as any)?.(fallbackKey) ?? fallback;
  const fmt = formatCompactValue;
  const totalColumns = showActions ? 9 : 8;

  return (
    <div className="table-card">
      <table className="table">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>
              <HeaderWithInfo
                label={tt("portfolio.table.headers.company", "portfolio.table.headers.symbol", "Company")}
                help={t("portfolio.help.company") ?? "Company name and ticker symbol."}
              />
            </th>
            <th>
              <HeaderWithInfo
                label={t("portfolio.table.headers.qty")}
                help={t("portfolio.help.qty") ?? "Shares/units held."}
              />
            </th>
            <th>
              <HeaderWithInfo
                label={t("portfolio.table.headers.buyPrice")}
                help={t("portfolio.help.buyPrice") ?? "Purchase price for this lot."}
              />
            </th>
            <th>
              <HeaderWithInfo
                label={t("portfolio.table.headers.buyValue")}
                help={t("portfolio.help.buyValue") ?? "Invested amount (qty x buy price)."}
              />
            </th>
            <th>
              <HeaderWithInfo
                label={t("portfolio.table.headers.buyDate")}
                help={t("portfolio.help.buyDate") ?? "Execution date/time for the trade."}
              />
            </th>
            <th>
              <HeaderWithInfo
                label={t("portfolio.table.headers.last")}
                help={t("portfolio.help.last") ?? "Most recent known market price."}
              />
            </th>
            <th>
              <HeaderWithInfo
                label={t("portfolio.table.headers.value")}
                help={t("portfolio.help.value") ?? "Current line value (last x quantity)."}
              />
            </th>
            <th>
              <HeaderWithInfo
                label={t("portfolio.table.headers.pnl")}
                help={t("portfolio.help.pnl") ?? "Unrealized profit/loss."}
              />
            </th>
            {showActions && <th>{effectiveActionLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={totalColumns}
                style={{ textAlign: "center", color: "var(--text-muted)" }}
              >
                {loading ? t("portfolio.table.loading") : t("portfolio.table.empty")}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const company = bySymbol.get(row.symbol);
              const logo = company?.logo ? assetPath(company.logo) : placeholderLogoPath;
              const displayName = company?.name || row.symbol;
              const actionHandler = onAction ?? noop;
              return (
                <tr key={row.id}>
                  <td style={{ textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <img
                        src={logo}
                        alt={`${displayName} logo`}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 8,
                          objectFit: "contain",
                          background: "transparent",
                        }}
                      />
                      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                        <span style={{ fontWeight: 700 }}>{displayName}</span>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                          {row.symbol}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="num">
                    {row.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </td>
                  <td className="num">{fmt(row.buyPrice)}</td>
                  <td className="num">{fmt(row.buyValue)}</td>
                  <td
                    style={{
                      whiteSpace: "nowrap",
                      textAlign: "right",
                      color: "var(--text-muted)",
                    }}
                  >
                    {buyDateFormatter.format(row.buyDate)}
                  </td>
                  <td className="num">{fmt(row.last)}</td>
                  <td className="num">{fmt(row.value)}</td>
                  <td className={`num ${row.pnlAbs >= 0 ? "pos" : "neg"}`}>
                    {fmt(row.pnlAbs)}{" "}
                    <span className={row.pnlPct >= 0 ? "pos" : "neg"}>
                      ({row.pnlPct.toFixed(1)}%)
                    </span>
                  </td>
                  {showActions && (
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-sell"
                        onClick={() => actionHandler(row)}
                      >
                        {effectiveActionLabel}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function HeaderWithInfo({ label, help }: { label: string; help: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        justifyContent: "space-between",
        width: "100%",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span className="info-tooltip">
        <button type="button" className="info-btn" aria-label={`${label}: ${help}`}>
          i
        </button>
        <span role="tooltip" className="info-tooltip-content">{help}</span>
      </span>
    </div>
  );
}
