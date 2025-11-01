// src/lib/companies.ts
import { supabase } from './supabaseClient';

export type Company = {
  symbol: string;
  name?: string;
  sector?: string;
  market?: string; // e.g., 'US', 'CN'
  profile: string; // path under public
  logo?: string | null; // path or null
  history: string; // path under public
  industry?: string | null;
  website?: string | null;
  irWebsite?: string | null;
};

export async function fetchCompaniesIndex(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('stock_market_companies')
    .select('symbol, name, sector, market_code, market, profile, logo, history, industry, website, ir_website')
    .order('symbol');

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    symbol: string;
    name?: string | null;
    sector?: string | null;
    market_code?: string | null;
    market?: string | null;
    profile?: string | null;
    logo?: string | null;
    history?: string | null;
    industry?: string | null;
    website?: string | null;
    ir_website?: string | null;
  }>;

  return rows.map((row) => ({
    symbol: row.symbol,
    name: row.name ?? undefined,
    sector: row.sector ?? undefined,
    market: row.market_code ?? row.market ?? undefined,
    profile: row.profile ?? `companies/${row.symbol}/profile.json`,
    logo: row.logo ?? null,
    history: row.history ?? `history/${row.symbol}.json`,
    industry: row.industry ?? null,
    website: row.website ?? null,
    irWebsite: row.ir_website ?? null,
  }));
}

export function marketLabel(mkt?: string): string {
  const code = (mkt || "").toUpperCase();
  if (code === "US") return "New York";
  if (code === "CN") return "Shanghai";
  if (code === "EU") return "Euronext";
  if (code === "JP") return "Tokyo";
  if (code === "SA") return "Saudi Arabia";
  if (code === "CRYPTO") return "Crypto";
  if (code === "FX" || code === "FOREX") return "Forex";
  if (code === "COM") return "Commodities";
  if (code === "IDX") return "Indices";
  return code || "Other";
}
