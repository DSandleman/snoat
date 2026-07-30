import { createClient, type SupabaseClientOptions } from "@supabase/supabase-js";
import WebSocketImpl from "ws";
import { config } from "../config.js";

type RealtimeOptions = NonNullable<SupabaseClientOptions<"public">["realtime"]>;

/**
 * Supabase-klient med service-role-nøkkel.
 *
 * Denne omgår RLS og er backendens eneste vei til tilstand – vi holder ingen
 * egen database (dette er det vi erstatter Dokploy sin Drizzle/Postgres-modell
 * med). Nøkkelen skal aldri sendes til frontend.
 */

/**
 * Backend bruker aldri Realtime, men `createClient` konstruerer Realtime-
 * klienten uansett, og den kaster hvis den ikke finner en WebSocket-
 * implementasjon. Node 22 (som containeren kjører) har `WebSocket` globalt;
 * Node 20 har det ikke, og backend skal også kunne kjøres frittstående. Vi
 * sender derfor inn `ws` når det globale objektet mangler.
 */
// Castet er nødvendig fordi `ws` erklærer `address` som nullable der
// supabase-js krever `string | URL`. Runtime-kontrakten er den samme.
const transport =
  typeof globalThis.WebSocket === "undefined"
    ? (WebSocketImpl as unknown as RealtimeOptions["transport"])
    : undefined;

export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  ...(transport ? { realtime: { transport } } : {}),
});

export async function ping(): Promise<void> {
  const { error } = await supabase.from("projects").select("id", { head: true, count: "exact" });
  if (error) throw new Error(error.message);
}
