import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    "VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY mangler. Kjør `node scripts/bootstrap-env.mjs` fra repo-roten.",
  );
}

let client: SupabaseClient | null = null;

/**
 * Supabase-klienten, opprettet ved første bruk.
 *
 * Den *må* være lat. `createClient` konstruerer Realtime-klienten med én gang,
 * og den kaster «Node.js 20 detected without native WebSocket support» under
 * SSR. Dashboardet er uansett klient-rendret: all datahenting skjer i effekter
 * og react-query-spørringer som er deaktivert til vi har en sesjon, så denne
 * funksjonen kalles aldri på serveren.
 */
export function getSupabase(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error(
      "getSupabase() ble kalt under SSR. Supabase-kall må skje i nettleseren (useEffect eller react-query med enabled-guard).",
    );
  }

  client ??= createClient(url!, anonKey!, {
    auth: {
      storage: window.localStorage,
      persistSession: true,
      autoRefreshToken: true,
      // Fanger opp `?code=` fra GitHub OAuth-callbacken og bytter den inn i en
      // sesjon automatisk.
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  });

  return client;
}

/** Anon-nøkkelen er offentlig; RLS er det som faktisk beskytter dataene. */
export const supabaseUrl = url;
