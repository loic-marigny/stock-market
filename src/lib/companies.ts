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

export type CompanyProfile = Company & {
  longBusinessSummary?: string;
  marketCap?: number;
  beta?: number;
  recommendationMean?: number;
  trailingPE?: number;
  trailingEPS?: number;
  totalRevenue?: number;
  totalDebt?: number;
  totalCash?: number;
  freeCashflow?: number;
  operatingCashflow?: number;
  fiftyTwoWeeksHigh?: number;
  fiftyTwoWeeksLow?: number;
  allTimeHigh?: number;
  allTimeLow?: number;
  
  displayName?: string;
  sectorDisplay?: string;
  industryDisp?: string;
};

export async function fetchCompaniesIndex(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('stock_market_companies')
    .select('symbol, name, sector, market_code, market, profile, logo, history, industry, website, ir_website')
    .order('symbol');

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
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
  const labels: Record<string, string> = {
    "US": "New York", "CN": "Shanghai", "EU": "Euronext", "JP": "Tokyo",
    "SA": "Saudi Arabia", "CRYPTO": "Crypto", "FX": "Forex", 
    "FOREX": "Forex", "COM": "Commodities", "IDX": "Indices"
  };
  return labels[code] || code || "Other";
}

const sanitize = (val: any) => (typeof val === 'string' && val.trim() ? val.trim() : undefined);

export async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  try {
    const { data, error } = await supabase
      .from('stock_market_companies')
      .select(`
        *,
        company_fundamentals (*)
      `)
      .eq('symbol', symbol)
      .single();

    if (error) {
      console.warn(`[Supabase] Profile not found for ${symbol}:`, error.message);
      return null;
    }

    const fund = Array.isArray(data.company_fundamentals)
      ? data.company_fundamentals[0]
      : data.company_fundamentals;

    // Mapping DB (snake_case) -> App (camelCase)
    return {
      symbol: data.symbol,
      name: sanitize(data.name),
      displayName: sanitize(data.name),
      sector: sanitize(data.sector),
      sectorDisplay: sanitize(data.sector),
      market: data.market_code ?? data.market,
      profile: data.profile,
      logo: data.logo,
      history: data.history,
      
      industry: sanitize(data.industry),
      industryDisp: sanitize(data.industry),
      website: sanitize(data.website),
      irWebsite: sanitize(data.ir_website),

      longBusinessSummary: sanitize(fund?.long_business_summary),
      marketCap: fund?.market_cap,
      beta: fund?.beta,
      recommendationMean: fund?.recommendation_mean,
      trailingPE: fund?.trailing_pe,
      trailingEPS: fund?.trailing_eps,
      totalRevenue: fund?.total_revenue,
      totalDebt: fund?.total_debt,
      totalCash: fund?.total_cash,
      freeCashflow: fund?.free_cashflow,
      operatingCashflow: fund?.operating_cashflow,
      fiftyTwoWeeksHigh: fund?.fifty_two_week_high,
      fiftyTwoWeeksLow: fund?.fifty_two_week_low,
      allTimeHigh: fund?.all_time_high,
      allTimeLow: fund?.all_time_low,
    };
  } catch (err) {
    console.error('[Supabase] Error fetch profile:', err);
    return null;
  }
}