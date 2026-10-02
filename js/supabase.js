import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export function createSupabaseClient() {
  if (!SUPABASE_URL.startsWith("https://") || SUPABASE_URL.includes("COLE_AQUI")) {
    throw new Error("Configure SUPABASE_URL em js/config.js.");
  }
  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("COLE_AQUI")) {
    throw new Error("Configure SUPABASE_ANON_KEY em js/config.js.");
  }
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}
