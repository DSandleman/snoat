# Supabase MVP Databasestruktur

Plattformen benytter en relasjonsdatabase (PostgreSQL via Supabase) for å holde styr på brukere, prosjekter og byggeprosesser.

Skjemaet er implementert i `supabase/migrations/0001_snoat_schema.sql`, og
speiles i TypeScript i `backend/src/types.ts` og `frontend/src/lib/database.types.ts`.

## profiles
Håndterer utvidet brukerdata knyttet til Supabase Auth (GitHub).
- **Kolonner:**
  - `id` (PK, refererer `auth.users`)
  - `full_name`
  - `avatar_url`
  - `created_at`

Raden opprettes automatisk av triggeren `on_auth_user_created` på `auth.users`,
som plukker `full_name`/`name`/`user_name` og `avatar_url` ut av GitHub-profilen
GoTrue lagrer i `raw_user_meta_data`.

## projects
Hvert repository som er koblet til plattformen.
- **Kolonner:**
  - `id` (PK)
  - `user_id` (FK -> `profiles`)
  - `name` (URL-vennlig slug)
  - `repo_url`
  - `build_command` (valgfri override)
  - `env_vars` (JSONB for `.env`)
  - `github_installation_id` (valgfri, se under)
  - `created_at`

`name` er subdomenet applikasjonen blir live på, og valideres derfor mot
`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` i databasen. Kombinasjonen
`(user_id, name)` er unik.

`github_installation_id` peker på installasjonen repoet ble valgt gjennom.
Er den satt, kloner backend med et installasjonstoken – det er dette som gjør
private repoer mulige. `NULL` betyr at URL-en ble limt inn for hånd, og repoet
må da være offentlig.

**`repo_url` er ikke bare noe vi kloner fra – den er også nøkkelen webhooks slår
opp på.** Et push-event kjenner bare `owner/repo`, så
`backend/src/routes/webhooks.ts` normaliserer begge sider til `owner/repo` med
små bokstaver før de sammenlignes (`repoIdentity()` i `lib/github.ts`). Kolonnen
har ingen formatvalidering i databasen, og verdiene finnes derfor med og uten
`.git`, med skråstrek til slutt og i vilkårlig case – normaliseringen er det som
gjør at alle variantene likevel treffer. Legger man til en ny måte å registrere
repoer på, er det denne normalformen som må holde, ellers slutter auto-deploy å
finne prosjektet uten at noe annet ser galt ut.

Kombinasjonen `(user_id, repo_url)` er **ikke** unik: flere prosjekter kan peke
på samme repo, og ett push-event starter da en deployment per prosjekt.

## github_installations
Kobling mellom en Snoat-bruker og en GitHub App-installasjon.
- **Kolonner:**
  - `id` (PK)
  - `user_id` (FK -> `profiles`)
  - `installation_id` (`bigint` – GitHub sine ID-er går utenfor int4)
  - `account_login`, `account_type`
  - `created_at`

**Vi lagrer aldri et GitHub-token.** Installasjons-ID-en er nok: backend bytter
den inn i et kortlevd token (én time) via App-ens private nøkkel når det trengs.
Lekker databasen, følger det ingen tilgang til brukerens kode med den.

`(user_id, installation_id)` er unik. Samme installasjon kan kobles til flere
Snoat-kontoer – to kolleger i samme organisasjon – men ikke to ganger til én.

## deployments
En historikk over hver gang et prosjekt bygges.
- **Kolonner:**
  - `id` (PK)
  - `project_id` (FK -> `projects`)
  - `status` (`queued`, `building`, `success`, `failed`)
  - `commit_hash`
  - `logs` (tekst eller JSON-strøm)
  - `url` (slutt-URL for deploymenten)
  - `created_at`

`status` er en Postgres-enum (`public.deployment_status`). `logs` skrives som ren
tekst av backend, som holder hele loggen i minnet og skriver den komplette
teksten ved hver flush – det gjør skrivingen idempotent og hindrer at to
samtidige flush-er mister linjer.

## Row Level Security

RLS er på for alle tabellene. Policyene er eier-scopet:

| Tabell | Policy |
| --- | --- |
| `profiles` | Bruker kan lese og oppdatere sin egen rad. |
| `projects` | Bruker har full tilgang til egne prosjekter (`for all`). |
| `deployments` | Bruker kan **lese** deployments for egne prosjekter. Skriving skjer kun fra backend. |
| `github_installations` | Bruker kan **kun lese** egne koblinger. Skriving skjer kun fra backend, etter at GitHub har bekreftet installasjonen – en klient som kunne skrive her, kunne knyttet seg til en annens repoer. |

Backend bruker service-role-nøkkelen og **omgår RLS**. Derfor må den verifisere
eierskap selv – det gjør `loadOwnedProject()` i `backend/src/middleware/auth.ts`.
Det er den eneste kontrollen som står mellom en bruker og andres prosjekter, og
den svarer 404 (ikke 403) slik at et ID-gjett ikke avslører at raden finnes.

Frontend filtrerer aldri på `user_id` i spørringene sine – det gjør databasen.

## Realtime

`deployments` er lagt til publikasjonen `supabase_realtime` og har
`replica identity full`, slik at dashboardet kan filtrere på `id` ved UPDATE.
Dette er kanalen byggestatus og live logger går over; frontend poller ikke.

## Migrasjoner

`supabase/migrations/*.sql` kjøres av `db-migrate`-tjenesten i
`docker-compose.yml`, ikke av postgres sitt initdb. Årsaken er at `profiles` har
en fremmednøkkel til `auth.users`, som GoTrue først oppretter når den kjører
sine egne migrasjoner. `db-migrate` venter derfor på at `auth` er healthy.

Migrasjonene kjøres på nytt ved hver oppstart og **må være idempotente**
(`create ... if not exists`, `drop policy if exists`, guards rundt `create type`).

`supabase/db/init/zzz-01-snoat-roles.sql` er noe annet: det kjøres av postgres
sitt initdb og setter passord på tjenesterollene. Det tar kun effekt på en tom
datakatalog – endrer du `POSTGRES_PASSWORD` eller `JWT_SECRET` må du kjøre
`docker compose down -v`.
