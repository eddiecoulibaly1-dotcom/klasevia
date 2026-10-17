const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://cyelvzywwqymxnziupxk.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_1QgqF6osZSY042n-OixA6A_aC3GRARs";

function getSupabaseLibrary() {
  if (!window.supabase) {
    throw new Error(
      "Le client Supabase n'est pas chargé. Vérifie le chargement du script Supabase."
    );
  }

  return window.supabase;
}

export const supabase = getSupabaseLibrary().createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

export const supabaseConfig = {
  url: SUPABASE_URL,
  publishableKeyConfigured: Boolean(SUPABASE_PUBLISHABLE_KEY)
};
