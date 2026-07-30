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
import { githubWebhooks } from "./routes/webhooks.js";
import { failOrphanedDeployments, reconcileRoutes } from "./services/deploy.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: config.SNOAT_FRONTEND_ORIGIN.split(",").map((value) => value.trim()),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
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

app.route("/api", api);

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
    return c.json({ error: error.message }, error.status);
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
})();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "Avslutter");
    server.close(() => process.exit(0));
  });
}
