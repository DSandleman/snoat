import { readFileSync } from "node:fs";
import { Reader, type CountryResponse } from "mmdb-lib";
import { config } from "../config.js";
import { logger } from "./logger.js";

/**
 * Landoppslag fra IP, uten nettverkskall.
 *
 * Databasen er en lokal MMDB-fil som leses inn i minnet ved oppstart. Det er et
 * bevisst valg framfor et geo-API: et oppslag per forespørsel mot en ekstern
 * tjeneste hadde vært både en ytelsesbrems og nøyaktig den avhengigheten
 * plattformen er bygget for å unngå.
 *
 * **Kun landnivå.** By-nivå kombinert med user-agent og språk begynner å bli
 * kvasi-identifiserende, og vi trenger det ikke for å tegne et kart.
 *
 * Filen er valgfri. Mangler den, returnerer oppslaget `null` og alt annet
 * fungerer som før – land blir bare stående tomt i dashboardet. Se
 * `scripts/fetch-geoip.mjs` for hvordan den hentes.
 */

let reader: Reader<CountryResponse> | null = null;
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;

  const path = config.SNOAT_GEOIP_DB_PATH;
  if (!path) return;

  try {
    reader = new Reader<CountryResponse>(readFileSync(path));
    logger.info({ path }, "GeoIP-database lastet");
  } catch (err) {
    // Ikke en feil som skal stoppe noe: analytikken fungerer uten land.
    logger.warn({ path, err }, "Fant ingen GeoIP-database – land blir ikke registrert");
    reader = null;
  }
}

export function lookupCountry(ip: string): string | null {
  ensureLoaded();
  if (!reader) return null;

  try {
    const found = reader.get(ip);
    const code = found?.country?.iso_code ?? found?.registered_country?.iso_code;
    // Kolonnen er `char(2)`; en avvikende kode ville sprengt den.
    return code && code.length === 2 ? code.toUpperCase() : null;
  } catch {
    // Private adresser og IPv6-former databasen ikke dekker havner her.
    return null;
  }
}
