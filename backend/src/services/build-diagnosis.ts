import { config } from "../config.js";

/**
 * Oversetter en feilet byggelogg til en forklaring brukeren kan handle på.
 *
 * Et mislykket `nixpacks build` etterlater flere hundre linjer BuildKit-output.
 * Nederst står som regel én linje som forklarer alt, men den drukner i
 * lagnedlastinger, nix-stier og cache-mounts. Snoat sa derfor lenge bare «se
 * loggen over for detaljer», som er å be en kunde lete etter noe de ikke vet
 * hvordan ser ut.
 *
 * Her kjenner vi igjen de feilene som faktisk oppstår, og sier hva de betyr og
 * hva brukeren gjør videre. Treffer ingen signatur, faller vi tilbake til den
 * generelle meldingen – en gjetning som er feil er verre enn ingen gjetning.
 *
 * Signaturene er bevisst konservative. De matcher tekst verktøyene skriver ut
 * ordrett, ikke omskrivninger, slik at en oppdatering av npm eller Next
 * i verste fall gir tilbakefall til den generelle meldingen framfor feil svar.
 */
export interface BuildDiagnosis {
  /** Kort diagnose. Første linje brukeren ser. */
  title: string;
  /** Hva brukeren gjør for å komme videre. */
  advice: string;
  /** Stedet i koden feilen peker på, når loggen oppgir et. */
  location?: string;
  /** Feilteksten fra verktøyet, når den er kort nok til å gjengis ordrett. */
  detail?: string;
}

interface Signature {
  /** Kjenner igjen feilen. Kjøres mot logg uten ANSI-koder. */
  match: RegExp;
  /** Bygger diagnosen. Får hele den rensede loggen for å hente ut detaljer. */
  diagnose: (output: string) => BuildDiagnosis;
}

const GENERIC_FAILURE = "Nixpacks klarte ikke å bygge prosjektet. Se loggen over for detaljer.";

/**
 * Rekkefølgen er ikke tilfeldig: den mest spesifikke signaturen må stå først.
 *
 * Et bygg som går tom for minne kan rive med seg moduler på vei ned og skrive
 * «Cannot find module» som bieffekt, og en typefeil på en manglende pakke
 * nevner både «Type error» og «Cannot find module». Den bredeste signaturen
 * står derfor nederst og fanger bare det ingen andre tok.
 */
const SIGNATURES: Signature[] = [
  {
    // Minnetaket vi selv setter i nixpacks.ts. Slår som regel inn i `next build`
    // eller `vite build` på store prosjekter.
    match: /JavaScript heap out of memory|Reached heap limit Allocation failed/,
    diagnose: () => ({
      title: "Bygget gikk tom for minne.",
      advice:
        `Byggingen fikk bruke ${config.SNOAT_BUILD_NODE_MEMORY_MB} MB heap og traff taket. ` +
        `Store prosjekter kan trenge mer – sett NODE_OPTIONS=--max-old-space-size=<MB> som ` +
        `miljøvariabel på prosjektet for å overstyre. Går det fortsatt tomt, er det som regel ` +
        `noe i bygget som laster inn for mye på én gang, ikke størrelsen på prosjektet i seg selv.`,
    }),
  },
  {
    // Next, Nuxt, Vite og rå `tsc` skriver alle typefeil ut på hver sin måte.
    // Vi kjenner igjen alle tre, og henter ut sted og melding når de finnes.
    match: /Failed to type check|Type error:|error TS\d+/,
    diagnose: (output) => ({
      title: "Typefeil i koden – bygget stoppet på TypeScript-sjekken.",
      location: firstMatch(output, /((?:\.\/|\/)?[\w./-]+\.(?:tsx?|jsx?|mts|cts|mjs|cjs)[:(]\d+[:,]\d+)/),
      detail:
        firstMatch(output, /Type error:\s*(.+)/) ?? firstMatch(output, /(error TS\d+:\s*.+)/),
      advice:
        `Produksjonsbygget kjører typesjekk, så en typefeil stopper hele deployen. Kjør ` +
        `\`npx tsc --noEmit\` lokalt for å se den samme feilen, rett den, og push på nytt. ` +
        `Skal prosjektet bygges selv om typene ikke går opp, må det settes i prosjektets egen ` +
        `konfigurasjon – Snoat skrur ikke av typesjekking for deg, fordi feilen som regel er ekte.`,
    }),
  },
  {
    // `npm ci` krever at låsefilen er i takt med package.json. Oppstår typisk
    // når noen redigerer package.json for hånd, eller merger uten å låse på nytt.
    match: /can only install packages when your package\.json and package-lock\.json .{0,40}in sync|npm (?:ERR!|error) code EUSAGE/,
    diagnose: () => ({
      title: "package-lock.json er ikke i takt med package.json.",
      advice:
        `Snoat installerer med \`npm ci\`, som krever at låsefilen stemmer nøyaktig med ` +
        `package.json. Kjør \`npm install\` lokalt, commit den oppdaterte package-lock.json, ` +
        `og push. Ligger package-lock.json i .gitignore, må den tas ut derfra – uten låsefil ` +
        `i repoet kan ingen bygge prosjektet reproduserbart.`,
    }),
  },
  {
    // Merk at dette kun matcher den harde feilen. `npm warn EBADENGINE` er en
    // advarsel bygget lever fint med, og skal ikke gi diagnose.
    match: /npm (?:ERR!|error) code EBADENGINE/,
    diagnose: (output) => ({
      title: "En pakke krever en annen Node-versjon enn bygget kjører.",
      detail: label("Pakken krever", firstMatch(output, /required:\s*(\{.+\})/)),
      advice:
        `Sett hvilken Node-versjon prosjektet trenger i "engines".node i package.json, eller i ` +
        `en .nvmrc-fil. Snoat respekterer begge, og bruker bare sin egen standard (Node ` +
        `${config.SNOAT_DEFAULT_NODE_VERSION}) når repoet ikke sier noe selv.`,
    }),
  },
  {
    match: /(?:ERR!|error) code ERESOLVE|unable to resolve dependency tree/,
    diagnose: () => ({
      title: "Avhengighetene i prosjektet er i konflikt.",
      advice:
        `To pakker krever uforenlige versjoner av den samme avhengigheten. Kjør \`npm install\` ` +
        `lokalt for å se konflikten i detalj. Løsningen er å oppdatere den ene pakken, eller ` +
        `legge inn "overrides" i package.json – og så committe den nye package-lock.json.`,
    }),
  },
  {
    match: /npm (?:ERR!|error) 404\s+Not Found/,
    diagnose: (output) => ({
      title: "En pakke i package.json finnes ikke i npm-registeret.",
      detail: label("Pakke", firstMatch(output, /404\s+'([^']+)' is not in this registry/)),
      advice:
        `Sjekk at pakkenavnet er stavet riktig. Ligger pakken i et privat register, må ` +
        `tilgangen legges inn – Snoat bygger uten dine lokale npm-innstillinger, så en pakke ` +
        `du har tilgang til på egen maskin er ikke automatisk tilgjengelig her.`,
    }),
  },
  {
    match: /npm (?:ERR!|error) Missing script:/,
    diagnose: (output) => ({
      title: "Byggekommandoen finnes ikke i package.json.",
      detail: label("Script som mangler", firstMatch(output, /Missing script:\s*("[^"]+")/)),
      advice:
        `Nixpacks kjører \`npm run build\` som standard. Mangler det scriptet, legg det inn ` +
        `under "scripts" i package.json – eller sett en egen byggekommando på prosjektet i Snoat ` +
        `hvis det skal bygges på en annen måte.`,
    }),
  },
  {
    // Bundler-varianten. Nesten alltid enten en glemt avhengighet eller feil
    // bokstavstørrelse i en import – den siste finnes kun i bygget, aldri på en Mac.
    match: /Module not found: (?:Error: )?Can't resolve/,
    diagnose: (output) => ({
      title: "En import peker på noe som ikke finnes.",
      detail: label("Fant ikke", firstMatch(output, /Can't resolve '([^']+)'/)),
      advice:
        `Enten mangler pakken i package.json, eller så stemmer ikke stien. Vær spesielt obs på ` +
        `store og små bokstaver: macOS skiller ikke mellom "Button" og "button" i filnavn, men ` +
        `byggeserveren gjør det. En import som virker lokalt kan derfor feile her.`,
    }),
  },
  {
    match: /Cannot find module '([^']+)'/,
    diagnose: (output) => ({
      title: "En modul bygget trenger er ikke installert.",
      detail: label("Fant ikke", firstMatch(output, /Cannot find module '([^']+)'/)),
      advice:
        `Pakken brukes i koden, men står ikke i package.json – da finnes den på maskinen din, ` +
        `men ikke her. Kjør \`npm install <pakke>\` lokalt og commit både package.json og ` +
        `package-lock.json. Er det en byggetids-avhengighet, må den ligge i "dependencies" ` +
        `eller "devDependencies", ikke bare være installert globalt.`,
    }),
  },
];

/**
 * Finner ut hvorfor et bygg feilet, hvis vi kjenner igjen feilen.
 *
 * `output` er halen av byggeloggen. Returnerer `null` når ingen signatur
 * treffer, slik at kalleren kan si det ærlige «se loggen» i stedet.
 */
export function diagnoseBuildFailure(output: string): BuildDiagnosis | null {
  const cleaned = stripAnsi(output);

  for (const signature of SIGNATURES) {
    if (signature.match.test(cleaned)) return signature.diagnose(cleaned);
  }

  return null;
}

/**
 * Feilmeldingen som havner i byggeloggen når `nixpacks build` gir opp.
 *
 * Diagnosen står øverst og rådet nederst, med detaljene mellom, slik at en
 * bruker som bare leser første linje likevel får vite hva som er galt.
 */
export function describeBuildFailure(output: string): string {
  const diagnosis = diagnoseBuildFailure(output);
  if (!diagnosis) return GENERIC_FAILURE;

  const lines = [diagnosis.title, ""];

  if (diagnosis.location) lines.push(`Sted: ${diagnosis.location}`);
  if (diagnosis.detail) lines.push(diagnosis.detail);
  if (diagnosis.location ?? diagnosis.detail) lines.push("");

  lines.push(diagnosis.advice);

  return lines.join("\n");
}

/**
 * Fjerner fargekoder før matching.
 *
 * Next skriver kodeutdraget rundt en typefeil med ANSI-farger midt inne i
 * teksten. Uten dette ville et uttrykk som `Type error:\s*(.+)` fanget
 * escape-sekvenser i stedet for melding.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*[A-Za-z]/g, "");
}

/**
 * Første treff på et uttrykk, uten omkringliggende blanktegn.
 *
 * BuildKit setter `#12 61.43 ` foran hver linje, så uttrykkene her er aldri
 * forankret til linjestart – de leter etter mønsteret hvor som helst i linja.
 */
/**
 * Setter merkelapp på en detalj, når detaljen finnes.
 *
 * En rå verdi som `./components/Button` alene i loggen sier ikke hva den er.
 * Fant vi ingenting, faller hele linja bort – en merkelapp uten verdi er verre
 * enn ingen linje.
 */
function label(prefix: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${prefix}: ${value}`;
}

function firstMatch(output: string, pattern: RegExp): string | undefined {
  const found = pattern.exec(output);
  if (!found) return undefined;

  const captured = (found[1] ?? found[0]).trim();
  return captured === "" ? undefined : captured;
}
