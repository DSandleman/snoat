import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { config } from "../config.js";
import * as github from "../lib/github.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { AuthVariables } from "../middleware/auth.js";
import type { GithubInstallation } from "../types.js";

/** Dashboardet, dit installasjonsflyten sender brukeren tilbake. */
function dashboardUrl(params: Record<string, string>): string {
  const origin = config.SNOAT_FRONTEND_ORIGIN.split(",")[0]!.trim();
  const url = new URL("/dashboard", origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function installationsFor(userId: string): Promise<GithubInstallation[]> {
  const { data, error } = await supabase
    .from("github_installations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw new HTTPException(500, { message: `Databasefeil: ${error.message}` });

  return (data ?? []) as GithubInstallation[];
}

/**
 * Fjerner en kobling som ikke lenger finnes hos GitHub.
 *
 * Avinstallerer brukeren App-en, får vi 404 på installasjonen. Uten opprydding
 * ville repo-listen feilet for alltid etterpå.
 */
async function forgetStaleInstallation(row: GithubInstallation): Promise<void> {
  github.forgetInstallation(row.installation_id);
  await supabase.from("github_installations").delete().eq("id", row.id);
  logger.info(
    { installationId: row.installation_id },
    "GitHub-installasjon finnes ikke lenger – koblingen er fjernet",
  );
}

// ---------------------------------------------------------------------------
// Autentiserte endepunkter (monteres under /api/github)
// ---------------------------------------------------------------------------

export const githubApi = new Hono<{ Variables: AuthVariables }>();

/**
 * Hva dashboardet trenger for å tegne dialogen: er integrasjonen tilgjengelig,
 * har brukeren koblet til, og hvor sendes vedkommende for å koble til.
 */
githubApi.get("/status", async (c) => {
  if (!github.isConfigured()) {
    return c.json({ configured: false, connected: false, installations: [], installUrl: null });
  }

  const userId = c.get("userId");
  const rows = await installationsFor(userId);

  return c.json({
    configured: true,
    connected: rows.length > 0,
    installations: rows.map((row) => ({
      installationId: row.installation_id,
      accountLogin: row.account_login,
      accountType: row.account_type,
    })),
    installUrl: github.installUrl(userId),
  });
});

/** Repoene brukeren har gitt Snoat tilgang til, på tvers av installasjoner. */
githubApi.get("/repos", async (c) => {
  if (!github.isConfigured()) {
    throw new HTTPException(503, { message: "GitHub-integrasjonen er ikke konfigurert" });
  }

  const rows = await installationsFor(c.get("userId"));
  const repos = [];

  for (const row of rows) {
    try {
      repos.push(...(await github.listRepositories(row.installation_id)));
    } catch (error) {
      // 404 betyr at App-en er avinstallert. Da rydder vi og går videre i
      // stedet for å la én død kobling ta ned hele lista.
      if (error instanceof github.GithubError && error.status === 404) {
        await forgetStaleInstallation(row);
        continue;
      }
      throw error;
    }
  }

  // Sist oppdaterte først – det er nesten alltid det man leter etter.
  repos.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return c.json({ repos });
});

// ---------------------------------------------------------------------------
// Offentlig endepunkt (monteres på /github)
// ---------------------------------------------------------------------------

export const githubSetup = new Hono();

/**
 * Setup-URL-en GitHub sender brukeren tilbake til etter installasjon.
 *
 * Denne treffes av nettleseren, ikke av dashboardet, og har derfor ingen
 * Authorization-header. Tilliten hviler i stedet på `state`, som er
 * HMAC-signert av oss – og på at vi spør GitHub om installasjonen faktisk
 * finnes før vi lagrer noe.
 */
githubSetup.get("/setup", async (c) => {
  if (!github.isConfigured()) {
    return c.redirect(dashboardUrl({ github: "error", reason: "not_configured" }));
  }

  const installationId = Number(c.req.query("installation_id"));
  const state = c.req.query("state") ?? "";

  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    return c.redirect(dashboardUrl({ github: "error", reason: "missing_installation" }));
  }

  const userId = github.verifyState(state);
  if (!userId) {
    return c.redirect(dashboardUrl({ github: "error", reason: "invalid_state" }));
  }

  try {
    const account = await github.getInstallation(installationId);

    const { error } = await supabase.from("github_installations").upsert(
      {
        user_id: userId,
        installation_id: account.installationId,
        account_login: account.accountLogin,
        account_type: account.accountType,
      },
      { onConflict: "user_id,installation_id" },
    );

    if (error) throw new Error(error.message);

    logger.info({ userId, installationId, account: account.accountLogin }, "GitHub App koblet til");
    return c.redirect(dashboardUrl({ github: "connected" }));
  } catch (error) {
    logger.error({ err: error, installationId }, "Kunne ikke fullføre GitHub-installasjonen");
    return c.redirect(dashboardUrl({ github: "error", reason: "setup_failed" }));
  }
});
