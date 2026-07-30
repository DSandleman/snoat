import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { supabase } from "../lib/supabase.js";
import type { Project } from "../types.js";

export interface AuthVariables {
  userId: string;
}

/**
 * Verifiserer Supabase-sesjonen fra dashboardet.
 *
 * Frontend sender access-tokenet sitt som `Authorization: Bearer <jwt>`. Vi lar
 * GoTrue validere det i stedet for å verifisere signaturen selv – da fanger vi
 * også opp tokens som er trukket tilbake, ikke bare utløpte.
 */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    throw new HTTPException(401, { message: "Mangler Authorization-header" });
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new HTTPException(401, { message: "Ugyldig eller utløpt sesjon" });
  }

  c.set("userId", data.user.id);
  await next();
};

/**
 * Henter et prosjekt og bekrefter at det tilhører den innloggede brukeren.
 *
 * Backend bruker service-role-nøkkelen og omgår dermed RLS, så denne sjekken er
 * det eneste som står mellom en bruker og andres prosjekter. Vi svarer 404 – og
 * ikke 403 – for at et ID-gjett ikke skal avsløre at prosjektet finnes.
 */
export async function loadOwnedProject(
  c: Context<{ Variables: AuthVariables }>,
  projectId: string,
): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    throw new HTTPException(500, { message: `Databasefeil: ${error.message}` });
  }

  const project = data as Project | null;

  if (!project || project.user_id !== c.get("userId")) {
    throw new HTTPException(404, { message: "Prosjektet finnes ikke" });
  }

  return project;
}
