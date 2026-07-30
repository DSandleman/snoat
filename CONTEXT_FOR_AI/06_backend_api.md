# Backend API

Implementert med Hono i `backend/src/routes/api.ts`. Tilgjengelig på
`http://api.snoat.localhost` (i compose) eller `http://127.0.0.1:3100` direkte.

## Autentisering

Alt under `/api` krever brukerens Supabase access-token:

```
Authorization: Bearer <supabase access_token>
```

Tokenet valideres av GoTrue via `supabase.auth.getUser(token)` – ikke ved at vi
verifiserer signaturen selv. Da fanger vi også opp tokens som er trukket
tilbake, ikke bare utløpte.

Frontend henter tokenet fra sesjonen i `frontend/src/lib/api.ts`.

**Ett unntak:** `POST /api/webhooks/github` ligger under `/api`, men utenfor
`requireAuth` – GitHub har ingen Supabase-sesjon. Den er signaturverifisert i
stedet, og monteres før `api` i `index.ts` for å komme foran middlewaren. Er du i
tvil om en rute er beskyttet, er registreringsrekkefølgen i `index.ts` svaret.

**CORS:** kun `SNOAT_FRONTEND_ORIGIN` slipper til (kommaseparert liste støttes).
Webhooken bryr seg ikke – GitHub sender ingen `Origin`-header, og CORS er en
nettleser-mekanisme.

## Endepunkter

### `GET /health`

Åpent. Sjekker de fire avhengighetene bygge-motoren trenger.

```json
{
  "status": "ok",
  "checks": {
    "docker":   { "ok": true },
    "caddy":    { "ok": true },
    "supabase": { "ok": true },
    "nixpacks": { "ok": true, "detail": "nixpacks 1.41.0" }
  }
}
```

Svarer `503` med `"status": "degraded"` og en `error`-streng per avhengighet som
er nede. Dette er førstevalget når noe ikke virker lokalt.

### `POST /api/projects/:projectId/deploy`

Starter en deployment. Svarer **202** så snart raden finnes – byggingen kjører
videre i bakgrunnen, og klienten følger den via Supabase Realtime.

```json
{ "deployment": { "id": "…", "project_id": "…", "status": "queued", … } }
```

| Kode | Betydning |
| --- | --- |
| 202 | Deployment opprettet og startet |
| 401 | Mangler eller ugyldig token |
| 404 | Prosjektet finnes ikke, eller tilhører noen andre |
| 409 | Prosjektet bygges allerede |

### `POST /api/projects/:projectId/stop`

Fjerner Caddy-ruten og stopper **alle** containere prosjektet har. Prosjektet og
historikken beholdes.

```json
{ "stopped": true }
```

Flertallsformen er ikke pedanteri: siden utrullingen er rullerende, kan et
prosjekt ha mer enn én container samtidig – normalt i noen sekunder midt i en
deployment, og varig hvis backend ble drept før oppryddingen. `teardownProject()`
slår derfor opp på labelen `no.snoat.project-id` og tar alt den finner, ikke bare
containeren som svarer til det gamle navnet `snoat-app-<slug>`.

Svarer 409 hvis en build pågår. Låsen er viktigere nå enn før: et `/stop` midt i
en deployment kunne ellers fjernet ruten pipelinen er i ferd med å bytte.

### `GET /api/deployments/:deploymentId`

Status og logger for én deployment.

```json
{ "deployment": { "id": "…", "status": "building", "logs": "…", … } }
```

Finnes for skript og feilsøking. **Dashboardet bruker Realtime i stedet** – ikke
poll dette endepunktet i UI-kode.

### `GET /api/github/status`

Hva dashboardet trenger for å tegne repo-velgeren i «Nytt prosjekt».

```json
{
  "configured": true,
  "connected": true,
  "installations": [{ "installationId": 12345, "accountLogin": "frostbyte", "accountType": "Organization" }],
  "installUrl": "https://github.com/apps/snoat/installations/new?state=…"
}
```

`configured: false` betyr at GitHub App-en ikke er satt opp på denne
installasjonen. Dashboardet skjuler da velgeren og viser kun URL-feltet.

### `GET /api/github/repos`

Repoene brukeren har gitt Snoat tilgang til, på tvers av installasjoner, sortert
med sist oppdaterte først.

```json
{ "repos": [{ "id": 1, "fullName": "frostbyte/api", "private": true, "cloneUrl": "…", "installationId": 12345 }] }
```

Er en installasjon fjernet på GitHub-siden, svarer GitHub 404. Da slettes den
foreldede raden vår og listen bygges videre fra de øvrige installasjonene –
én død kobling skal ikke ta ned hele velgeren.

Svarer `503` når App-en ikke er konfigurert.

### `POST /api/webhooks/github`

**Utenfor `requireAuth`, selv om den ligger under `/api`.** GitHub kaller denne
ved push, og har ingen Supabase-sesjon å sende med. Tilliten hviler på
HMAC-signaturen i `x-hub-signature-256`, verifisert mot `GITHUB_WEBHOOK_SECRET`.
Ruten monteres derfor **før** `/api` i `index.ts` – se `03_deployment_flow.md`.

Starter en deployment av hvert prosjekt hvis `repo_url` peker på repoet i
payloaden, forutsatt at pushen gikk til hovedgrenen.

```json
{
  "received": true,
  "repository": "frostbyte/api",
  "branch": "main",
  "message": "frostbyte/api@main: 1 deployment startet",
  "results": [{ "projectId": "…", "project": "api", "status": "deploying", "deploymentId": "…" }]
}
```

| Kode | Betydning |
| --- | --- |
| 200 | Mottatt, men ingenting å gjøre (`ping`, annet event, tag, annen gren, ukjent repo) |
| 202 | Minst ett prosjekt matchet. `results[]` sier `deploying` eller `already_building` per prosjekt |
| 400 | Payloaden kunne ikke tolkes, eller mangler `repository.full_name` |
| 401 | Ugyldig eller manglende signatur |
| 413 | Body over 5 MB |
| 500 | Databasen svarte ikke – bruk «Redeliver» hos GitHub |

Merk at et prosjekt som allerede bygges gir **202**, ikke 409: en push under en
pågående build er forventet, og skal ikke se ut som en leveringsfeil hos GitHub.

Er `GITHUB_WEBHOOK_SECRET` tom, tas forespørselen imot **uten** signaturkontroll,
med en advarsel i loggen. Se `08_security_model.md`.

### `GET /github/setup`

**Utenfor `/api`, og uten `requireAuth`.** GitHub sender nettleseren hit etter
en installasjon, uten Authorization-header. Tilliten hviler på `state`, som er
HMAC-signert av oss og inneholder bruker-ID-en, og på at vi spør GitHub om
installasjonen faktisk finnes før koblingen lagres.

Svarer alltid med en redirect til dashboardet: `?github=connected` eller
`?github=error&reason=…`.

## Feilformat

Alle feil svarer med samme form:

```json
{ "error": "Prosjektet bygges allerede. Vent til den kjørende buildet er ferdig." }
```

Meldingene er på norsk og ment å vises direkte til brukeren.

## Ikke implementert

- **`installation`-eventet.** Webhook-mottaket håndterer kun `push`. Blir App-en
  avinstallert, oppdager vi det fortsatt ikke før neste gang repo-listen hentes
  og GitHub svarer 404 (`08_security_model.md`).
- **Sletting av prosjekt.** Frontend sletter raden direkte via Supabase (RLS),
  men da blir containerne og ruten hengende igjen – og uten raden finnes ikke
  lenger prosjekt-ID-en labelene peker på, så de må ryddes for hånd. Bruk `/stop`
  først, eller la et fremtidig `DELETE /api/projects/:id` gjøre begge deler.
- **Rate limiting.** Ingenting hindrer en bruker i å trigge mange builds på rad
  utover `409`-låsen per prosjekt.
