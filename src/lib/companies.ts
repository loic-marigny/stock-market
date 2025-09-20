// src/lib/companies.ts
export type Company = {
  symbol: string;
  name?: string;
  sector?: string;
  market?: string; // e.g., 'US', 'CN'
  profile: string; // path under public
  logo?: string | null; // path or null
  history: string; // path under public
};

function fromBase(path: string): string {
  const b = (import.meta as any).env?.BASE_URL || "/";
  const base = String(b);
  const p = path.startsWith("/") ? path.slice(1) : path;
  return base.endsWith("/") ? `${base}${p}` : `${base}/${p}`;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return res.json();
}

export async function fetchCompaniesIndex(): Promise<Company[]> {
  const url = fromBase("companies/index.json");
  return fetchJSON<Company[]>(url);
}

export function marketLabel(mkt?: string): string {
  const code = (mkt || "").toUpperCase();
  if (code === "US") return "New York";
  if (code === "CN") return "Shanghai";
  if (code === "EU") return "Euronext";
  if (code === "JP") return "Tokyo";
  if (code === "SA") return "Saudi Arabia";
  return code || "Other";
}
