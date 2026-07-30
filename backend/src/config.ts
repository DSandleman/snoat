import { z } from "zod";

/**
 * Valgfri variabel som også tåler tom streng.
 *
 * `.optional()` godtar kun `undefined`, men docker-compose sender `""` for en
 * variabel som ikke er satt (`${FOO:-}`). Uten denne krasjer backend i oppstart
 * med «String must contain at least 1 character» så snart en valgfri integrasjon
 * ikke er konfigurert.
 */
const optionalEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  /** Intern URL til Supabase-gatewayen (Kong). */
  SUPABASE_URL: z.string().url(),
  /** Service-role-nøkkel: omgår RLS. Skal aldri eksponeres mot frontend. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),

  /** Caddy sitt admin-API – her opprettes rutene for deployede apper. */
  CADDY_ADMIN_URL: z.string().url().default("http://caddy:2019"),
  /** Suffikset hvert prosjekt får sitt subdomene under. */
  SNOAT_APP_DOMAIN_SUFFIX: z.string().default(".snoat.localhost"),
  /** Docker-nettverket brukerapplikasjoner kobles til, slik at Caddy når dem. */
  SNOAT_APPS_NETWORK: z.string().default("snoat_apps"),
  /**
   * Absolutt sti der repoer klones og bygges.
   *
   * Må være identisk på host og i containeren: nixpacks sender stien videre til
   * host-maskinens Docker-daemon som build-context, og daemonen løser den i
   * sitt eget filsystem – ikke i vårt.
   */
  SNOAT_WORKSPACE_DIR: z.string().min(1),

  /**
   * Katalogen ferdigbygde statiske sider legges i.
   *
   * Må være det **samme volumet** i backend og i Caddy: backend skriver filene,
   * Caddy serverer dem. I motsetning til SNOAT_WORKSPACE_DIR er det ingen
   * host-daemon inne i bildet her, så et navngitt Docker-volum holder – stien
   * trenger bare være lik i de to containerne.
   */
  SNOAT_SITES_DIR: z.string().min(1).default("/srv/sites"),

  /**
   * Hvor mange tidligere versjoner av en statisk side som beholdes på disk.
   *
   * Filene er små og allerede bygget, så det å beholde noen versjoner er
   * praktisk talt gratis – og det gjør tilbakerulling til et rutebytte i stedet
   * for en ny build.
   */
  SNOAT_STATIC_KEEP_VERSIONS: z.coerce.number().int().positive().default(3),

  DOCKER_HOST: z.string().default("unix:///var/run/docker.sock"),

  /** Origin dashboardet kjører på – eneste tillatte CORS-origin. */
  SNOAT_FRONTEND_ORIGIN: z.string().default("http://localhost:8080"),

  /**
   * Porten brukerapplikasjoner forventes å lytte på inne i containeren.
   * Injiseres som `PORT`, etter samme konvensjon som Heroku og Railway.
   */
  SNOAT_APP_PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Ressurstak per applikasjonscontainer. Dette er mekanismen som gjør
   * gratisplanen mulig uten at ett prosjekt kan spise opp verten
   * (01_vision_and_brand.md).
   */
  SNOAT_APP_MEMORY_MB: z.coerce.number().int().positive().default(512),
  SNOAT_APP_CPUS: z.coerce.number().positive().default(1),

  /**
   * Hvor lenge den forrige containeren får på seg å fullføre forespørsler den
   * holder på, etter at Caddy har flyttet ny trafikk til den nye versjonen
   * (SIGTERM → SIGKILL). Gjør den siste delen av en rullerende utrulling myk.
   */
  SNOAT_APP_STOP_TIMEOUT_S: z.coerce.number().int().nonnegative().default(10),

  /**
   * Maks tid en enkelt build får bruke før den avbrytes.
   *
   * Merk at dette er en timer inne i backend-prosessen. Går hele verten tom for
   * minne, blir også backend utsultet, og timeren fyrer ikke – en vakt som deler
   * skjebne med det den vokter er ingen vakt. Det er `SNOAT_MAX_CONCURRENT_BUILDS`
   * og swap som faktisk hindrer den situasjonen.
   */
  SNOAT_BUILD_TIMEOUT_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),

  /**
   * Hvor mange prosjekter som får bygges samtidig på hele verten.
   *
   * En nix-build tar det minnet den trenger. To samtidige på en liten VPS spiser
   * hele maskinen, og siden Postgres og Caddy står på samme boks, går plattformen
   * ned med dem (`09_production_deployment.md`). Standard er 1 – hev den først
   * når verten har minne å avse.
   */
  SNOAT_MAX_CONCURRENT_BUILDS: z.coerce.number().int().positive().default(1),

  /**
   * Heap-tak for Node under *bygging*, i MB. Injiseres som `NODE_OPTIONS
   * --max-old-space-size` når prosjektet ikke setter den selv.
   *
   * `next build` og `vite build` tar så mye minne de får lov til. Uten et tak er
   * det verten som setter grensen, og da er det for sent. Med taket feiler bygget
   * i stedet med «JavaScript heap out of memory» – en feil som rammer én kunde og
   * står forklart i loggen, i stedet for å ta ned alle.
   *
   * Settes for lavt feiler store prosjekter unødvendig. Tommelfingerregel: rundt
   * 75 % av minnet verten kan avse til én build.
   */
  SNOAT_BUILD_NODE_MEMORY_MB: z.coerce.number().int().positive().default(1536),

  /**
   * Node-versjonen prosjekter bygges med når repoet ikke oppgir en selv.
   *
   * Nixpacks faller tilbake på Node 18, som er ute av vedlikehold og ikke kan
   * bygge moderne Next.js eller Vite. Se `runtime-versions.ts`. Verdien må være
   * et major-nummer Nixpacks kjenner (18, 20, 22, 23) – en ukjent verdi ignoreres
   * av Nixpacks, som da bruker sin egen standard igjen.
   */
  SNOAT_DEFAULT_NODE_VERSION: z.string().min(1).default("22"),

  /**
   * GitHub App – lar brukeren velge repository fra en liste og deploye private
   * repoer. Valgfri: uten disse faller dashboardet tilbake til å lime inn URL,
   * og `/api/github/*` svarer 503.
   *
   * Den private nøkkelen er base64-kodet fordi en PEM inneholder linjeskift som
   * hverken .env eller docker-compose håndterer pent:
   *   base64 -i snoat.<dato>.private-key.pem
   */
  GITHUB_APP_ID: optionalEnv,
  GITHUB_APP_PRIVATE_KEY: optionalEnv,
  /** Slug-en i https://github.com/apps/<slug> – brukes i installasjons-URL-en. */
  GITHUB_APP_SLUG: optionalEnv,
  /** Signerer `state` gjennom installasjonsredirecten. Genereres av bootstrap. */
  GITHUB_APP_STATE_SECRET: optionalEnv,
  /**
   * Webhook-secret for automatisk deploy ved push. Må være den *samme* verdien
   * som står i App-ens webhook-innstillinger på github.com – i motsetning til
   * hemmelighetene over er dette en delt verdi, ikke en vi kan generere fritt.
   *
   * Valgfri, slik at oppsettet kan prøves ut før secreten er på plass. Er den
   * tom, tas webhooks imot uverifisert – og da kan hvem som helst starte builds.
   * Se `CONTEXT_FOR_AI/08_security_model.md`.
   */
  GITHUB_WEBHOOK_SECRET: optionalEnv,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Ugyldig miljøkonfigurasjon:\n${issues}`);
}

export const config = parsed.data;
export type Config = typeof config;
