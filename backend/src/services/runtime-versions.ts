import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

/**
 * Hvilken språkversjon et prosjekt skal bygges med.
 *
 * Nixpacks velger versjon i denne rekkefølgen: `NIXPACKS_<SPRÅK>_VERSION` fra
 * build-miljøet → repoets eget manifest (`engines.node`) → en versjonsfil
 * (`.nvmrc`) → sin egen innebygde standard. Den innebygde standarden er Node 18,
 * som gikk ut av vedlikehold i april 2025. Next.js 15+, Vite 6+ og
 * `@supabase/supabase-js` krever alle Node 20 eller nyere, så et helt vanlig
 * prosjekt uten `engines`-felt feiler på `npm run build` uten at brukeren har
 * gjort noe galt.
 *
 * Snoat fyller derfor hullet nederst i kjeden: sier repoet ingenting, setter vi
 * en levende versjon. Sier repoet noe – uansett hva – rører vi det ikke.
 * Plattformen skal ha en fornuftig standard, ikke en mening.
 */
export interface RuntimeVersion {
  /** Navnet slik det vises i byggeloggen. */
  label: string;
  /** Variabelen Nixpacks leser versjonen fra. */
  variable: string;
  version: string;
  /** Hvor versjonen kommer fra. Vises i loggen, slik at valget er etterprøvbart. */
  source: string;
  /** Sant når Snoat må sende variabelen til Nixpacks for at versjonen skal gjelde. */
  inject: boolean;
}

/** En versjon repoet har oppgitt selv, og hvor den ble funnet. */
interface Declaration {
  version: string;
  source: string;
}

interface Runtime {
  label: string;
  variable: string;
  /** Filen som avgjør om repoet i det hele tatt er av denne typen. */
  manifest: string;
  /** Leses ved hver build, slik at driftere kan endre standarden uten ny deploy av backend. */
  fallback: () => string;
  /** Leter etter versjonen repoet oppgir selv, i samme rekkefølge som Nixpacks. */
  declaredVersion: (directory: string) => Promise<Declaration | null>;
}

/**
 * Kjøretidene Snoat har en mening om.
 *
 * Kun Node står her nå, fordi det bare er Node-standarden i Nixpacks som har
 * råtnet. Python-standarden (3.11) og Go-standarden er fortsatt i vedlikehold.
 * Når en av dem eldes, er det nok å legge til en rad – resten av flyten er
 * språkuavhengig.
 */
const RUNTIMES: Runtime[] = [
  {
    label: "Node",
    variable: "NIXPACKS_NODE_VERSION",
    manifest: "package.json",
    fallback: () => config.SNOAT_DEFAULT_NODE_VERSION,
    declaredVersion: async (directory) => {
      const declared = enginesNode(await readJson(path.join(directory, "package.json")));
      if (declared) return { version: declared, source: "engines.node i package.json" };

      for (const file of [".nvmrc", ".node-version"]) {
        const pinned = await readVersionFile(path.join(directory, file));
        if (pinned) return { version: pinned, source: file };
      }

      return null;
    },
  },
];

/**
 * Finner hvilke språkversjoner som gjelder for et klonet repo.
 *
 * Returnerer én rad per kjøretid som er relevant for prosjektet. Radene med
 * `inject: true` er de Snoat må sende videre som `--env`; resten er kun til
 * logging, så brukeren ser hvor versjonen kom fra når noe ryker.
 */
export async function resolveRuntimeVersions(directory: string): Promise<RuntimeVersion[]> {
  // Et repo med egen nixpacks-konfigurasjon har tatt over byggeoppsettet selv.
  // `--env` vinner over `[variables]` i den filen, så vi ville overstyrt et
  // bevisst valg i stedet for å fylle et hull.
  if (await hasOwnNixpacksConfig(directory)) return [];

  const resolved: RuntimeVersion[] = [];

  for (const runtime of RUNTIMES) {
    if (!(await exists(path.join(directory, runtime.manifest)))) continue;

    const declared = await runtime.declaredVersion(directory).catch((error: unknown) => {
      // Et uleselig manifest er ikke vår feil å håndtere – Nixpacks gir en
      // bedre feilmelding om det noen linjer senere. Vi lar bare være å gjette.
      logger.warn({ directory, runtime: runtime.label, err: error }, "Kunne ikke lese versjon fra repoet");
      return null;
    });

    resolved.push(
      declared
        ? {
            label: runtime.label,
            variable: runtime.variable,
            version: declared.version,
            source: declared.source,
            inject: false,
          }
        : {
            label: runtime.label,
            variable: runtime.variable,
            version: runtime.fallback(),
            source: "Snoat-standard, repoet oppgir ingen",
            inject: true,
          },
    );
  }

  return resolved;
}

async function hasOwnNixpacksConfig(directory: string): Promise<boolean> {
  for (const file of ["nixpacks.toml", "nixpacks.json"]) {
    if (await exists(path.join(directory, file))) return true;
  }
  return false;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function enginesNode(pkg: Record<string, unknown> | null): string | null {
  const engines = pkg?.engines;
  if (typeof engines !== "object" || engines === null) return null;

  const node = (engines as Record<string, unknown>).node;
  return typeof node === "string" && node.trim() !== "" ? node.trim() : null;
}

/**
 * Leser en versjonsfil som `.nvmrc`.
 *
 * Innholdet brukes ikke til noe annet enn å konkludere med at repoet har
 * bestemt seg, så vi tolker det ikke – `lts/*` og `v20.11.0` er like gyldige
 * svar. Kommentarlinjer hoppes over, ellers ville en fil som starter med `#`
 * sett tom ut.
 */
async function readVersionFile(file: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return null;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) return trimmed;
  }

  return null;
}
