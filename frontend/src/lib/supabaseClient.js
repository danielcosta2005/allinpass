import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SINGLETON_KEY = '__allinpass_supabase_client__';

function createSupabaseSingleton() {
  if (!url || !key) {
    throw new Error('Supabase env vars are missing. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

if (!globalThis[SUPABASE_SINGLETON_KEY]) {
  globalThis[SUPABASE_SINGLETON_KEY] = createSupabaseSingleton();
}

export const supabase = globalThis[SUPABASE_SINGLETON_KEY];
