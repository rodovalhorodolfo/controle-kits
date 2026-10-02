import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export function createSupabaseClient() {
  if (!SUPABASE_URL?.startsWith("https://")) {
  throw new Error("SUPABASE_URL inválida. Verifique js/config.js.");
  }
  if (!SUPABASE_ANON_KEY?.trim()) {
  throw new Error("SUPABASE_ANON_KEY não configurada. Verifique js/config.js.");
  }
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}
