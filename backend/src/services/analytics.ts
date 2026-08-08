import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import type { AnalyticsSummary, Project } from "../types.js";

/**
 * Lesesiden av trafikkanalysen.
 *
 * Skrivingen skjer i `analytics-ingest.ts`, som tar imot Caddys access-logg.
 * Her hentes de ferdig aggregerte tallene ut igjen. Alt tungt arbeid ligger i
 * `public.analytics_summary()` – ett kall gir nøkkeltall, tidsserie og alle
 * dimensjonene, slik at dashboardet ikke trenger fem spørringer for én visning.
 */

/** Oppløsningen grafen tegnes i. Speiler allowlisten i `analytics_summary()`. */
export type AnalyticsUnit = "hour" | "day" | "month";

const UNITS = new Set<AnalyticsUnit>(["hour", "day", "month"]);

export function parseUnit(raw: string | undefined): AnalyticsUnit {
  return UNITS.has(raw as AnalyticsUnit) ? (raw as AnalyticsUnit) : "day";
}

/**
 * Lengste vindu som kan spørres om.
 *
 * Uten et tak kan en bruker be om ti år i timesoppløsning, og det er en tung
 * aggregering rett i databasen plattformen deler med alt annet. 400 dager
 * dekker «hittil i år» og «samme periode i fjor» med god margin.
 */
const MAX_RANGE_MS = 400 * 24 * 60 * 60 * 1000;

export interface ParsedRange {
  from: Date;
  to: Date;
  unit: AnalyticsUnit;
}

/**
 * Tolker og klamrer tidsvinduet fra spørrestrengen.
 *
 * Tallene kommer fra nettleseren og skal ikke stoles på: et `to` før `from`,
 * en NaN eller et tiårsvindu skal gi et fornuftig svar, ikke en feil eller en
 * spørring som legger databasen ned.
 */
export function parseRange(rawFrom: string | undefined, rawTo: string | undefined, rawUnit: string | undefined): ParsedRange {
  const now = Date.now();

  const toMs = Number.isFinite(Number(rawTo)) && Number(rawTo) > 0 ? Number(rawTo) : now;
  const fromCandidate = Number.isFinite(Number(rawFrom)) && Number(rawFrom) > 0
    ? Number(rawFrom)
    : toMs - 30 * 24 * 60 * 60 * 1000;

  // Et omvendt intervall gir ingen mening – bytt heller enn å svare tomt.
  let from = Math.min(fromCandidate, toMs);
  const to = Math.max(fromCandidate, toMs);

  if (to - from > MAX_RANGE_MS) from = to - MAX_RANGE_MS;

  return { from: new Date(from), to: new Date(to), unit: parseUnit(rawUnit) };
}

/** Tomt svar, slik at dashboardet kan tegne «ingen data» i stedet for å feile. */
const EMPTY: AnalyticsSummary = {
  totals: {
    pageviews: 0,
    visits: 0,
    requests: 0,
    bytes_out: 0,
    errors_4xx: 0,
    errors_5xx: 0,
    bot_requests: 0,
    avg_duration_ms: 0,
  },
  visitors: 0,
  series: [],
  dims: {},
  unit: "day",
};

/**
 * Alt dashboardet trenger for ett prosjekt i ett vindu, i ett databasekall.
 *
 * Eierskapet er allerede verifisert av `loadOwnedProject` i rutelaget – SQL-
 * funksjonen er `security definer` og kan ikke kalles fra nettleseren, så den
 * gjør ingen egen sjekk.
 */
export async function getProjectSummary(
  project: Project,
  range: ParsedRange,
  limit = 10,
): Promise<AnalyticsSummary> {
  const { data, error } = await supabase.rpc("analytics_summary", {
    p_project_id: project.id,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_unit: range.unit,
    p_limit: limit,
    p_tz: config.SNOAT_ANALYTICS_TIMEZONE,
  });

  if (error) {
    // Statistikk som ikke lastes skal ikke gi kunden en feilside – det er
    // dashboardets minst kritiske fane. Vi logger og svarer tomt.
    logger.warn({ err: error.message, project: project.name }, "Kunne ikke hente statistikk");
    return { ...EMPTY, unit: range.unit };
  }

  return (data as AnalyticsSummary | null) ?? { ...EMPTY, unit: range.unit };
}
