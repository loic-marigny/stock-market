import type { OHLC, PriceProvider } from './prices';
import { supabase } from './supabaseClient';

function rowToCandle(row: any): OHLC | null {
  const date = typeof row?.record_date === 'string' ? row.record_date : null;
  const close = typeof row?.record_value === 'number' ? row.record_value : Number(row?.record_value);
  if (!date || !Number.isFinite(close)) return null;
  return { date, open: close, high: close, low: close, close };
}

export const supabasePrices: PriceProvider = {
  async getDailyHistory(symbol) {
    const { data, error } = await supabase
      .from('stock_market_history')
      .select('record_date, record_value')
      .eq('symbol', symbol)
      .order('record_date', { ascending: true });

    if (error) throw error;
    return (data ?? []).map(rowToCandle).filter((c): c is OHLC => !!c);
  },

  async getLastPrice(symbol) {
    const { data, error } = await supabase
      .from('stock_market_history')
      .select('record_value')
      .eq('symbol', symbol)
      .order('record_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const value = data?.record_value;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  },
};
