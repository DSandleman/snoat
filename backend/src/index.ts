import { serve } from "@hono/node-server";
import { execa } from "execa";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { config } from "./config.js";
import * as caddy from "./lib/caddy.js";
import * as dockerLib from "./lib/docker.js";
import { logger } from "./lib/logger.js";
import * as supabaseLib from "./lib/supabase.js";
import { api } from "./routes/api.js";
import { githubSetup } from "./routes/github.js";
import { pricing } from "./routes/pricing.js";
import { stripeWebhooks } from "./routes/stripe.js";
import { tlsPermission } from "./routes/tls.js";
import { githubWebhooks } from "./routes/webhooks.js";
import { startAnalyticsIngest } from "./services/analytics-ingest.js";
import { failOrphanedDeployments, reconcileRoutes } from "./services/deploy.js";
import { startSuspensionSweep } from "./services/suspension.js";
import type { ErrorDetail } from "./types.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: config.SNOAT_FRONTEND_ORIGIN.split(",").map((value) => value.trim()),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

type CheckResult = { ok: true; detail?: string } | { ok: false; error: string };

async function check(fn: () => Promise<string | void>): Promise<CheckResult> {
  try {
    const detail = await fn();
    return detail ? { ok: true, detail } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Verifiserer at alle avhengighetene bygge-motoren trenger faktisk er på plass:
 * Docker-socket, Caddy admin-API, Supabase, og at nixpacks-binæren finnes.
 */
app.get("/health", async (c) => {
  const [docker, caddyAdmin, supabase, nixpacks] = await Promise.all([
    check(() => dockerLib.ping()),
    check(() => caddy.ping()),
    check(() => supabaseLib.ping()),
    check(async () => (await execa("nixpacks", ["--version"])).stdout.trim()),
  ]);

  const checks = { docker, caddy: caddyAdmin, supabase, nixpacks };
  const healthy = Object.values(checks).every((result) => result.ok);

  return c.json({ status: healthy ? "ok" : "degraded", checks }, healthy ? 200 : 503);
});

/**
 * GitHub-webhooks – automatisk deploy ved push.
 *
 * **Monteres før `/api` med vilje.** `api` legger `requireAuth` på alt under seg,
 * og GitHub sender ingen Authorization-header. Hono matcher handlere i
 * registreringsrekkefølge, og en handler som svarer stopper kjeden – så denne
 * ruten svarer før auth-middlewaren i `api` rekker å kjøre. Bytter du om på de
 * to linjene, begynner GitHub å få 401.
 *
 * Tilliten hviler på HMAC-signaturen i `x-hub-signature-256` i stedet.
 */
app.route("/api/webhooks", githubWebhooks);

/**
 * Stripe-webhooks – abonnement opprettet, fornyet, feilet eller avsluttet.
 *
 * **Samme grunn til å ligge her som GitHub-webhooken over:** Stripe har ingen
 * Supabase-sesjon, og `api` legger `requireAuth` på alt under `/api`. Flyttes
 * denne linjen under `app.route("/api", api)`, begynner Stripe å få 401 – og
 * symptomet er ikke en feilmelding hos oss, men kunder som betaler uten å få
 * planen sin.
 *
 * Tilliten hviler på signaturen i `stripe-signature`. Uten
 * `STRIPE_WEBHOOK_SECRET` avvises alt med 503; se `routes/stripe.ts`.
 */
app.route("/api/webhooks", stripeWebhooks);

/**
 * Trafikkanalysen har ingen offentlige endepunkter.
 *
 * Tidligere lå det en `/script.js` og en `/api/send` her, som proxiet Umami.
 * De er borte med vilje: statistikken hentes nå ut av Caddys access-logg
 * (`services/analytics-ingest.ts`), som allerede ser hver eneste forespørsel
 * til hver eneste kundeapp. Det fjernet samtidig et åpent, uautentisert
 * skriveendepunkt og en klientkontrollert `X-Forwarded-For` fra angrepsflaten.
 */

/**
 * Plankatalogen for landingssiden – offentlig, og derfor over `/api`.
 *
 * Samme monteringsregel som webhookene: `api` legger `requireAuth` på alt under
 * seg, så denne linjen må stå før den. Se `routes/pricing.ts`.
 */
app.route("/api/pricing", pricing);

app.route("/api", api);

/**
 * Caddys tillatelsessjekk for on-demand TLS.
 *
 * Utenfor `/api` med vilje, av samme grunn som `/github`: Caddy kaller den fra
 * proxy-laget uten Authorization-header, så `requireAuth` ville avvist den.
 * Se `routes/tls.ts` for hvorfor det er trygt at ruten er offentlig lesbar.
 */
app.route("/internal", tlsPermission);

/**
 * GitHub App-installasjonen lander her.
 *
 * Utenfor /api med vilje: dette er en redirect fra nettleseren uten
 * Authorization-header, så `requireAuth` ville avvist den. Tilliten hviler på
 * den HMAC-signerte `state`-parameteren i stedet.
 */
app.route("/github", githubSetup);

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    // `cause` bærer en `ErrorDetail` når feilen er ment for kunden. `error` er
    // fortsatt med: den er norsk, men den er bedre enn ingenting for et eldre
    // dashboard eller et direkte API-kall som ikke kjenner kodene.
    const detail = error.cause as ErrorDetail | undefined;

    return c.json(
      {
        error: error.message,
        ...(detail?.code ? { code: detail.code, params: detail.params ?? {} } : {}),
      },
      error.status,
    );
  }
  logger.error({ err: error, path: c.req.path }, "Ubehandlet feil");
  return c.json({ error: "Intern feil" }, 500);
});

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info(
    {
      port: info.port,
      workspace: config.SNOAT_WORKSPACE_DIR,
      appsNetwork: config.SNOAT_APPS_NETWORK,
    },
    "Snoat backend kjører",
  );
});

/**
 * Klargjør infrastrukturen backend eier, men blokker ikke oppstart på den –
 * health-endepunktet rapporterer hva som eventuelt mangler.
 *
 * Rute-synkroniseringen er viktigst: Caddy startes fra en statisk config-fil og
 * mister dynamiske ruter ved restart, så vi bygger dem opp igjen fra Supabase.
 */
void (async () => {
  try {
    await dockerLib.ensureAppsNetwork();
  } catch (error) {
    logger.warn({ err: error }, "Kunne ikke klargjøre apps-nettverket");
  }

  // Køen lever i minnet til denne prosessen. Startet vi nettopp opp, finnes det
  // ingen som bygger videre på deployments som sto i `queued` eller `building` –
  // de må lukkes, ellers teller dashboardet i det uendelige på en død build.
  try {
    await failOrphanedDeployments();
  } catch (error) {
    logger.warn({ err: error }, "Kunne ikke rydde avbrutte deployments");
  }

  try {
    await reconcileRoutes();
  } catch (error) {
    logger.warn({ err: error }, "Kunne ikke synkronisere Caddy-ruter");
  }

  // Etter reconcile med vilje: sveipet leser hvilke containere som kjører, og
  // skal se verden slik den faktisk er – ikke slik den var før rutene ble
  // gjenopprettet.
  startSuspensionSweep();

  // Caddy kobler seg til denne lytteren for å strømme access-loggen. Den har
  // `soft_start` i loggkonfigurasjonen, så rekkefølgen er ikke kritisk: er vi
  // sene ut, kobler Caddy seg til når vi er oppe.
  startAnalyticsIngest();
})();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "Avslutter");
    server.close(() => process.exit(0));
  });
}
