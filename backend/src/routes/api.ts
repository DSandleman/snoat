import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { supabase } from "../lib/supabase.js";
import { loadOwnedProject, requireAuth, type AuthVariables } from "../middleware/auth.js";
import * as analytics from "../services/analytics.js";
import { invalidateHostMap } from "../services/analytics-ingest.js";
import * as deploy from "../services/deploy.js";
import { DeployError, type Deployment, type ErrorDetail } from "../types.js";
import { billing } from "./billing.js";
import { githubApi } from "./github.js";

export const api = new Hono<{ Variables: AuthVariables }>();

api.use("*", requireAuth);

/** Repo-velgeren i «Nytt prosjekt». Arver requireAuth fra linjen over. */
api.route("/github", githubApi);

/**
 * Abonnement, kjøp og kundeportal. Arver også requireAuth.
 *
 * Stripe-webhooken er **ikke** her – den må ligge utenfor auth og monteres før
 * `/api` i `index.ts`, akkurat som GitHub-webhooken.
 */
api.route("/billing", billing);

/**
 * Starter en deployment.
 *
 * Svarer 202 så snart deployment-raden finnes. Selve byggingen kjører videre i
 * bakgrunnen, og dashboardet følger den via Supabase Realtime på `deployments`
 * – ikke ved å polle dette endepunktet.
 */
api.post("/projects/:projectId/deploy", async (c) => {
  const project = await loadOwnedProject(c, c.req.param("projectId"));

  try {
    const deployment = await deploy.startDeployment(project);
    return c.json({ deployment }, 202);
  } catch (error) {
    if (error instanceof DeployError) {
      // En plangrense er ikke en konflikt – ingenting endrer seg om kunden
      // prøver igjen om et minutt. 402 sier det den skal si: dette koster penger.
      // Dashboardet skiller på koden for å vise «Oppgrader»-knappen.
      //
      // `cause` bærer feilkoden videre til `app.onError`, som legger den i
      // JSON-svaret. `message` er norsk og går i loggen; det er koden dashboardet
      // oversetter. Uten dette ville en engelsk bruker fått norsk feiltekst.
      throw new HTTPException(error.step === "plan" ? 402 : 409, {
        message: error.message,
        cause: error.detail ?? undefined,
      });
    }
    throw error;
  }
});

/** Stopper applikasjonen og fjerner ruten, uten å slette prosjektet. */
api.post("/projects/:projectId/stop", async (c) => {
  const project = await loadOwnedProject(c, c.req.param("projectId"));

  if (deploy.isDeploying(project.id)) {
    throw new HTTPException(409, {
      message: "Prosjektet bygges akkurat nå",
      cause: { code: "deploy.building_now" } satisfies ErrorDetail,
    });
  }

  await deploy.teardownProject(project);
  return c.json({ stopped: true });
});

/**
 * Oppdaterer eller fjerner eget domene for et prosjekt.
 * 
 * Verifiserer at domenet er unikt. Er applikasjonen i live, byttes Caddy-ruten
 * umiddelbart slik at domenet fungerer uten en ny deployment.
 */
api.patch("/projects/:projectId/domain", async (c) => {
  const project = await loadOwnedProject(c, c.req.param("projectId"));
  const { custom_domain } = await c.req.json<{ custom_domain: string | null }>();

  // Normaliser domenet
  const normalized = custom_domain ? custom_domain.trim().toLowerCase() : null;

  if (normalized) {
    const { count, error: countError } = await supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("custom_domain", normalized)
      .neq("id", project.id);
      
    if (countError) {
      throw new HTTPException(500, { message: "Kunne ikke verifisere domene: " + countError.message });
    }
    
    if (count && count > 0) {
      throw new HTTPException(409, { message: "Domenet er allerede i bruk av et annet prosjekt" });
    }
  }

  const { error } = await supabase
    .from("projects")
    .update({ custom_domain: normalized })
    .eq("id", project.id);
  
  if (error) throw new HTTPException(500, { message: error.message });

  // Statistikken kobler treff til prosjekt via vertsnavnet, så et nytt eget
  // domene må være kjent for ingesten før den første besøkende kommer.
  invalidateHostMap();

  // Hvis prosjektet kjører, oppdater Caddy atomisk
  if (!project.stopped_at) {
    try {
      const route = await import("../lib/caddy.js").then(m => m.getAppRoute(project.name));
      if (route) {
        await import("../lib/caddy.js").then(m => m.restoreAppRoute(project.name, normalized, route));
      }
    } catch (err) {
      // Vi feiler ikke forespørselen hvis Caddy-oppdateringen feilet, fordi databasen er oppdatert.
      // Neste deployment eller oppstart vil uansett rute riktig.
      const logger = await import("../lib/logger.js").then(m => m.logger);
      logger.error({ project: project.name, err }, "Kunne ikke oppdatere Caddy-rute med nytt domene");
    }
  }

  return c.json({ success: true, custom_domain: normalized });
});

/** Status og logger for én deployment. Dashboardet bruker Realtime i stedet. */
api.get("/deployments/:deploymentId", async (c) => {
  const { data, error } = await supabase
    .from("deployments")
    .select("*, projects(user_id)")
    .eq("id", c.req.param("deploymentId"))
    .maybeSingle();

  if (error) throw new HTTPException(500, { message: error.message });

  const row = data as (Deployment & { projects: { user_id: string } | null }) | null;

  if (!row || row.projects?.user_id !== c.get("userId")) {
    throw new HTTPException(404, { message: "Deploymenten finnes ikke" });
  }

  const { projects, ...deployment } = row;
  return c.json({ deployment });
});

/**
 * All trafikkstatistikk for ett prosjekt, i ett kall.
 *
 * Tidligere var dette tre endepunkter mot Umami. Dashboardet poller hvert
 * halvminutt, så tre ruter ble til tre spørringer per fane per intervall – nå
 * er det én, og den leser ferdig aggregerte rader.
 *
 * Tallene samles inn fra Caddys access-logg (`services/analytics-ingest.ts`).
 * Det er derfor ingenting å konfigurere per prosjekt, og ingen sporingskode i
 * kundens applikasjon.
 */
api.get("/projects/:projectId/analytics", async (c) => {
  const project = await loadOwnedProject(c, c.req.param("projectId"));

  // Tolkes og klamres i servicelaget: vinduet kommer fra nettleseren, og et
  // tiårsvindu i timesoppløsning er en tung aggregering i en delt database.
  const range = analytics.parseRange(c.req.query("from"), c.req.query("to"), c.req.query("unit"));

  return c.json(await analytics.getProjectSummary(project, range));
});

