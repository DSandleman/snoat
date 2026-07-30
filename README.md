# Snoat

Et helnorsk, selvhostet alternativ til Vercel, driftet på infrastruktur fra
Frostbyte Group AS. Push kode til GitHub – Snoat bygger, containeriserer og
publiserer applikasjonen på et eget subdomene, uten at data forlater Norge.

Arkitektur, designsystem og forretningslogikk er dokumentert i
[`CONTEXT_FOR_AI/`](CONTEXT_FOR_AI/), som er prosjektets source of truth.

## Struktur

```
CONTEXT_FOR_AI/     Arkitektur- og designdokumentasjon (source of truth)
backend/            Bygge-motor og plattform-API (Nixpacks + Dockerode + Caddy)
frontend/           Landingsside og dashboard (TanStack Start)
caddy/config.json   Startkonfigurasjon for reverse proxyen
supabase/           Selvhostet Supabase: gateway-config, roller og migrasjoner
scripts/            bootstrap-env.mjs, vendor-sync.sh
docker-compose.yml  Hele plattform-stacken
```

## Komme i gang

Krever Docker (eller Docker Desktop) og Node.js 20+.

```bash
node scripts/bootstrap-env.mjs   # genererer .env og frontend/.env
docker compose up -d --build     # plattformen: Supabase, Caddy, backend

cd frontend && npm install && npm run dev   # dashboardet på :8080
```

Første oppstart laster ned Supabase-imagene og bygger backend-imaget (med
nixpacks og Docker CLI), så det tar noen minutter.

### Tjenester

| URL | Hva |
| --- | --- |
| http://api.snoat.localhost | Snoat backend-API |
| http://supabase.snoat.localhost | Supabase API-gateway (Kong) |
| http://studio.snoat.localhost | Supabase Studio |
| http://\<prosjekt\>.snoat.localhost | Deployede brukerapplikasjoner |

`*.localhost` løses automatisk til 127.0.0.1 i moderne nettlesere – ingen
oppføringer i `/etc/hosts` er nødvendig. For `curl` må du bruke
`curl -H "Host: api.snoat.localhost" http://127.0.0.1/…`.

Verifiser at alt henger sammen:

```bash
curl -s http://api.snoat.localhost/health | jq
```

### Nyttige kommandoer

```bash
docker compose logs -f backend      # følg bygge-motoren
docker compose down                 # stopp
docker compose down -v              # stopp og slett databasen
./scripts/vendor-sync.sh            # hent referansekode på nytt
```

## Hvordan det henger sammen

```
Nettleser ──▶ Caddy :80 ──┬──▶ backend        (api.snoat.localhost)
                          ├──▶ Kong ──▶ GoTrue / PostgREST / Realtime
                          ├──▶ Studio
                          └──▶ brukerapp-containere  (*.snoat.localhost)

backend ──▶ Docker-daemon   (nixpacks build, dockerode run)
        ──▶ Caddy admin-API (oppretter ruten når containeren er oppe)
        ──▶ Supabase        (all tilstand: prosjekter, deployments, logger)
```

Backend eier ingen egen database. Alt av tilstand ligger i den selvhostede
Supabase-instansen, slik at datasuvereniteten holdes i ett system.

## Konfigurasjon

Alt av hemmeligheter genereres lokalt av `scripts/bootstrap-env.mjs` – vi bruker
bevisst ikke Supabase sine publiserte demo-nøkler, slik at ingen installasjon
deler hemmeligheter med noen andre. `.env.example` dokumenterer feltene.

To variabler er verdt å merke seg:

- **`SNOAT_WORKSPACE_DIR`** må være samme absolutte sti på host og i
  backend-containeren. Nixpacks sender build-contexten videre til
  host-daemonen, som løser stien i sitt eget filsystem.
- **`DOCKER_SOCKET_PATH`** autodetekteres fra `docker context`. Docker Desktop
  på macOS bruker `~/.docker/run/docker.sock` med mindre «Allow the default
  Docker socket to be used» er slått på.

### GitHub OAuth

Registrer en OAuth-app på https://github.com/settings/developers med callback
`http://supabase.snoat.localhost/auth/v1/callback`, og sett `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET` og `GITHUB_OAUTH_ENABLED=true` i `.env`.

## Lisenser for gjenbrukt kode

`backend/vendor/` inneholder en klone av [Dokploy](https://github.com/Dokploy/dokploy)
som vi henter arkitekturmønstre fra. Det meste er Apache 2.0, men kataloger som
heter `proprietary/` er kildeåpne under en lisens som forbyr produksjonsbruk
uten kommersiell avtale – de skal ikke gjenbrukes. Se
[`backend/vendor/README.md`](backend/vendor/README.md).
