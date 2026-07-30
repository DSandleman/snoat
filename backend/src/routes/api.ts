import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { supabase } from "../lib/supabase.js";
import { loadOwnedProject, requireAuth, type AuthVariables } from "../middleware/auth.js";
import * as deploy from "../services/deploy.js";
import { DeployError, type Deployment } from "../types.js";
import { githubApi } from "./github.js";

export const api = new Hono<{ Variables: AuthVariables }>();

api.use("*", requireAuth);

/** Repo-velgeren i «Nytt prosjekt». Arver requireAuth fra linjen over. */
api.route("/github", githubApi);

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
      throw new HTTPException(409, { message: error.message });
    }
    throw error;
  }
});

/** Stopper applikasjonen og fjerner ruten, uten å slette prosjektet. */
api.post("/projects/:projectId/stop", async (c) => {
  const project = await loadOwnedProject(c, c.req.param("projectId"));

  if (deploy.isDeploying(project.id)) {
    throw new HTTPException(409, { message: "Prosjektet bygges akkurat nå" });
  }

  await deploy.teardownProject(project);
  return c.json({ stopped: true });
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
