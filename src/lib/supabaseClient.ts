import { createClient } from '@supabase/supabase-js';

const FALLBACK_SUPABASE_URL = 'https://uwrbfhcqmytcwardffhm.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cmJmaGNxbXl0Y3dhcmRmZmhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgzNTE4NTMsImV4cCI6MjA3MzkyNzg1M30.GJfHK_iCmNrrfz7lLbg8bwetgsuwMBp7q7pI5cYoCNo';

const url =
  import.meta.env.VITE_SUPABASE_URL ??
  (typeof window !== 'undefined' && (window as any).__SUPABASE_URL__) ??
  FALLBACK_SUPABASE_URL;

const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  (typeof window !== 'undefined' && (window as any).__SUPABASE_ANON_KEY__) ??
  FALLBACK_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
