import type { OHLC, PriceProvider } from './prices';
import { supabase } from './supabaseClient';

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rowToCandle(row: any): OHLC | null {
  const date =
    typeof row?.record_date === 'string'
      ? row.record_date
      : row?.record_date instanceof Date
      ? row.record_date.toISOString().slice(0, 10)
      : null;

  const close = toNumber(row?.close_value ?? row?.record_value);
  if (!date || close === null) return null;

  const openRaw = toNumber(row?.open_value);
  const highRaw = toNumber(row?.high_value);
  const lowRaw = toNumber(row?.low_value);

  const open = openRaw ?? close;
  const high = Math.max(highRaw ?? Number.NEGATIVE_INFINITY, open, close);
  const low = Math.min(lowRaw ?? Number.POSITIVE_INFINITY, open, close);

  return {
    date,
    open,
    high: Number.isFinite(high) ? high : Math.max(open, close),
    low: Number.isFinite(low) ? low : Math.min(open, close),
    close,
  };
}

export const supabasePrices: PriceProvider = {
  async getDailyHistory(symbol) {
    const { data, error } = await supabase
      .from('stock_market_history')
      .select('record_date, open_value, high_value, low_value, close_value, record_value')
      .eq('symbol', symbol)
      .order('record_date', { ascending: true });

    if (error) throw error;
    return (data ?? []).map(rowToCandle).filter((c): c is OHLC => !!c);
  },

  async getLastPrice(symbol) {
    const { data, error } = await supabase
      .from('stock_market_history')
      .select('close_value, record_value')
      .eq('symbol', symbol)
      .order('record_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const value = toNumber(data?.close_value ?? data?.record_value);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  },
};
