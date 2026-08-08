#!/usr/bin/env node
/**
 * Henter DB-IP Lite Country-databasen som `lookupCountry()` slår opp i.
 *
 * DB-IP Lite er valgt framfor MaxMind GeoLite2 med vilje: GeoLite2 krever
 * konto og lisensnøkkel for nedlasting, altså nøyaktig den eksterne
 * avhengigheten plattformen er bygget for å slippe. DB-IP Lite lastes ned
 * anonymt under CC-BY 4.0.
 *
 *   node scripts/fetch-geoip.mjs [målfil]
 *
 * Filen er valgfri. Uten den fungerer analytikken som før, men uten landkoder.
 * Kjør på nytt et par ganger i året – databasen oppdateres månedlig.
 *
 * Attribusjonskravet i CC-BY 4.0 oppfylles ved å nevne «IP Geolocation by
 * DB-IP» der landstatistikken vises.
 */

import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";

const target = path.resolve(process.argv[2] ?? "backend/vendor/dbip-country-lite.mmdb");

/** DB-IP publiserer per måned. Nyeste utgave kan mangle de første i måneden. */
function candidateUrls() {
  const urls = [];
  const now = new Date();
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    urls.push(`https://download.db-ip.com/free/dbip-country-lite-${stamp}.mmdb.gz`);
  }
  return urls;
}

async function main() {
  await mkdir(path.dirname(target), { recursive: true });

  for (const url of candidateUrls()) {
    process.stdout.write(`Prøver ${url} … `);
    const res = await fetch(url);

    if (!res.ok || !res.body) {
      console.log(`${res.status}`);
      continue;
    }

    // Skriv til en midlertidig fil først, slik at en avbrutt nedlasting ikke
    // etterlater en halv database som Reader-en vil feile på.
    const tmp = `${target}.partial`;
    await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(tmp));
    await rename(tmp, target);

    const { size } = await stat(target);
    console.log(`ok (${(size / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`\nSkrevet til ${target}`);
    console.log("Sett SNOAT_GEOIP_DB_PATH til denne stien i .env.");
    return;
  }

  console.error("\nFant ingen tilgjengelig utgave. Analytikken fungerer uten, bare uten land.");
  process.exit(1);
}

await main();
