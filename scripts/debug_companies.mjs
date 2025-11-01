import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment.');
}

const supabase = createClient(url, anonKey, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from('stock_market_companies')
  .select('symbol, name, sector, market_code, market, profile, logo, history, industry, website, ir_website')
  .order('symbol')
  .limit(5);

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
