// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url) {
  // Ce console.error apparaîtra en prod si jamais l'env n'est pas bien passé
  console.error('VITE_SUPABASE_URL is not defined at build time');
  throw new Error('Supabase URL is missing');
}

if (!anonKey) {
  console.error('VITE_SUPABASE_ANON_KEY is not defined at build time');
  throw new Error('Supabase anon key is missing');
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
});
