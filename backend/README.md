# Snoat Backend

Bygge-motoren og plattform-API-et. Implementerer deployment-livssyklusen i
`CONTEXT_FOR_AI/03_deployment_flow.md`.

## Ansvar

1. Ta imot deploy-forespørsler (fra dashboardet eller GitHub-webhooks).
2. Klone brukerens repository til `SNOAT_WORKSPACE_DIR`.
3. Bygge et OCI-image med **nixpacks** – ingen Dockerfile kreves fra brukeren.
4. Spinne opp containeren med **dockerode**, med brukerens miljøvariabler.
5. Registrere ruten i **Caddy** via admin-API-et, slik at appen blir live på
   `<prosjekt>.snoat.localhost`.
6. Skrive status og logger til **Supabase** underveis, slik at frontend kan
   følge byggingen live via Realtime.

Se `CONTEXT_FOR_AI/03_deployment_flow.md` for hele flyten og
`CONTEXT_FOR_AI/06_backend_api.md` for endepunktene.

## Struktur

```
src/
  config.ts               Miljøvariabler, validert med zod
  index.ts                Hono-server, CORS, /health, reconcile ved oppstart
  types.ts                Skjematyper + DeployError
  middleware/auth.ts      Verifiserer Supabase-token og eierskap
  routes/api.ts           /api-endepunktene
  services/
    deploy.ts             Orkestrerer pipelinen + reconcile av Caddy-ruter
    git.ts                Kloning og validering av repo-URL
    nixpacks.ts           Bygger image-et
    containers.ts         Oppretter, sjekker og fjerner app-containere
    log-stream.ts         Buffrer byggelogg og skyller til Supabase
  lib/
    caddy.ts              Admin-API-klient: opprett/fjern ruter per prosjekt
    docker.ts             Delt Dockerode-klient + apps-nettverket
    logger.ts             pino
    supabase.ts           service-role-klient (all tilstand ligger her)
vendor/                   Klonet referansekode – ikke vår kode, se vendor/README.md
```

## Kjøre lokalt

Normalt via `docker compose up` fra repo-roten. Backend trenger tre ting fra
verten, som compose setter opp:

- `/var/run/docker.sock` – Dockerode og nixpacks styrer host-daemonen.
- `SNOAT_WORKSPACE_DIR` montert på **samme absolutte sti** inne i containeren.
  Nixpacks sender build-contexten videre til host-daemonen, som løser stien i
  sitt eget filsystem. Ulike stier på hver side gir «context not found».
- Nettverket `snoat_apps`, som Caddy og alle deployede apper deler.

Frittstående (uten compose) – krever at Supabase og Caddy kjører:

```bash
cd backend
npm install
SUPABASE_URL=http://127.0.0.1:8000 \
SUPABASE_SERVICE_ROLE_KEY=... \
SUPABASE_ANON_KEY=... \
CADDY_ADMIN_URL=http://127.0.0.1:2019 \
SNOAT_WORKSPACE_DIR="$PWD/../.snoat/workspaces" \
npm run dev
```

## Helsesjekk

```bash
curl -s http://api.snoat.localhost/health | jq
```

Sjekker Docker-socket, Caddy admin-API, Supabase og at `nixpacks` finnes i
PATH. Svarer 503 med detaljer per avhengighet hvis noe mangler.

## Node-versjon

Containeren kjører Node 22. Frittstående kreves Node ≥ 20.19 – på Node 20 sender
`lib/supabase.ts` inn `ws` som WebSocket-transport, fordi supabase-js
konstruerer Realtime-klienten uansett og den kaster uten en WebSocket-
implementasjon. Backend bruker aldri Realtime selv.

## Sikkerhetsmerknad

Å montere Docker-socketen gir containeren reell root-tilgang på verten. Det er
akseptabelt i utviklingsmiljøet, men i produksjon bør backend enten kjøre
direkte på verten eller gå gjennom en proxy som begrenser hvilke Docker-API-kall
som er tillatt. Se `CONTEXT_FOR_AI/08_security_model.md` for hele bildet.
