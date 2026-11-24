import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'vaultledger.supabase.auth',
      },
    })
  : null;

/**
 * Verifies the owner's password against Supabase Auth using an isolated
 * memory-only client so the main browser client's active AAL2 session is
 * never downgraded or overwritten.
 */
export async function verifyOwnerPassword(email, password) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase configuration is missing.');
  }
  const verifier = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    },
  });

  const { data, error } = await verifier.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;

  // Revoke only this temporary check session so main AAL2 session stays intact
  await verifier.auth.signOut({ scope: 'local' }).catch(() => {});
  return Boolean(data?.user);
}
