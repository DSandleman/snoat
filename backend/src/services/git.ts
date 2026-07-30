import { execa } from "execa";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import * as github from "../lib/github.js";
import { redactCredentials } from "../lib/redact.js";
import { DeployError } from "../types.js";
import type { LogStream } from "./log-stream.js";

/**
 * Tillater kun http(s)-URL-er.
 *
 * Uten denne kunne `repo_url` vært `--upload-pack=...` eller en `ext::`-URL,
 * som får git til å kjøre vilkårlige kommandoer. Verdien kommer fra brukeren,
 * så den valideres før den når git.
 */
export function assertSafeRepoUrl(repoUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw new DeployError("clone", `Ugyldig repository-URL: ${repoUrl}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new DeployError("clone", `Kun http(s)-URL-er støttes, fikk «${parsed.protocol}»`);
  }

  return parsed;
}

/** Katalogen kildekoden for én deployment klones til. */
export function workspaceFor(projectId: string, deploymentId: string): string {
  return path.join(config.SNOAT_WORKSPACE_DIR, projectId, deploymentId);
}

export interface CloneResult {
  directory: string;
  commitHash: string;
}

/**
 * Kloner repoet til arbeidsområdet.
 *
 * `--depth 1` fordi vi bare trenger arbeidstreet for å bygge, ikke historikken.
 */
export async function cloneRepository(
  repoUrl: string,
  projectId: string,
  deploymentId: string,
  logs: LogStream,
  installationId?: number | null,
): Promise<CloneResult> {
  const url = assertSafeRepoUrl(repoUrl);
  const directory = workspaceFor(projectId, deploymentId);

  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  // Er repoet valgt gjennom GitHub App-en, kloner vi med et kortlevd
  // installasjonstoken. Da fungerer private repoer, og tokenet utløper av seg
  // selv en time senere uansett hva som skjer med arbeidsområdet.
  const cloneTarget = installationId
    ? await github.authenticatedCloneUrl(url.toString(), installationId)
    : url.toString();

  logs.step("Kloner repository");
  logs.write(`git clone --depth 1 ${redactCredentials(cloneTarget)}`);

  try {
    const clone = execa("git", ["clone", "--depth", "1", cloneTarget, directory], {
      env: {
        // Ingen interaktiv passordprompt – manglende tilgang skal feile raskt og
        // tydelig i stedet for å henge til build-timeouten slår inn.
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
      },
    });
    clone.stderr?.on("data", (chunk: Buffer) => logs.write(redactCredentials(chunk.toString())));
    await clone;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = message.split("\n")[0] ?? message;
    throw new DeployError(
      "clone",
      installationId
        ? `Kunne ikke klone repositoryet. Har Snoat fortsatt tilgang til det på GitHub? (${redactCredentials(detail)})`
        : `Kunne ikke klone repositoryet. Er det offentlig? (${redactCredentials(detail)})`,
    );
  }

  const { stdout: commitHash } = await execa("git", ["-C", directory, "rev-parse", "HEAD"]);
  logs.write(`Commit: ${commitHash}`);

  return { directory, commitHash: commitHash.trim() };
}

/** Rydder bort kildekoden etter en deployment. Imaget er det vi trenger videre. */
export async function cleanupWorkspace(projectId: string, deploymentId: string): Promise<void> {
  await rm(workspaceFor(projectId, deploymentId), { recursive: true, force: true });
}
