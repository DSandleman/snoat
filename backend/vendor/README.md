# Vendor – referansekode

Denne katalogen er **ikke** en del av Snoat sin kjørbare kode. Den inneholder en
lokal, grunn klone (`--depth 1`) av open source-prosjekter vi henter arkitektur
og løsningsmønstre fra. Katalogen er gitignorert; hent den ned på nytt med:

```bash
./scripts/vendor-sync.sh   # fra repo-roten
```

## Dokploy

- Kilde: https://github.com/Dokploy/dokploy
- Lisens: Apache 2.0 for det meste, **men** alt under en `proprietary/`-katalog
  ligger under «Dokploy Source Available License» (DSAL), som forbyr bruk i
  produksjon uten kommersiell avtale.

I denne klonen finnes tre slike kataloger:

```
packages/server/src/services/proprietary
apps/dokploy/components/proprietary
apps/dokploy/server/api/routers/proprietary
```

**Ingenting fra disse tre katalogene skal kopieres inn i Snoat.** Alt vi
faktisk gjenbruker ligger under Apache 2.0.

### Hva vi henter fra Dokploy

| Fil i klonen | Hva vi gjenbruker |
| --- | --- |
| `packages/server/src/utils/builders/nixpacks.ts` | Hvordan `nixpacks build` kalles: argumentbygging, `--env`-injeksjon, `--no-cache` |
| `packages/server/src/utils/builders/index.ts` | Livssyklusen bygg → image → container, og hvordan logger strømmes underveis |
| `packages/server/src/utils/docker/utils.ts` | Ressursgrenser, mounts og miljøvariabel-håndtering mot Docker |
| `packages/server/src/utils/traefik/` | Mønsteret for å skrive proxy-ruter programmatisk per applikasjon |

### Hva vi bevisst ikke gjenbruker

- **Database og ORM.** Dokploy bruker Drizzle mot sin egen Postgres. Snoat
  lagrer all tilstand i selvhostet Supabase (`CONTEXT_FOR_AI/04_database_schema.md`).
- **Auth.** Dokploy har egen brukermodell; vi bruker Supabase Auth (GitHub OAuth).
- **Traefik.** Dokploy skriver Traefik-config som YAML-filer på disk. Snoat
  bruker Caddy sitt REST-API (`CONTEXT_FOR_AI/02_architecture.md`).
- **Docker Swarm.** Dokploy oppretter Swarm-*services*. Snoat kjører vanlige
  containere mot én daemon.
- **Deres frontend** (`apps/dokploy`). Snoat har sitt eget designsystem.

## Nixpacks

- Kilde: https://github.com/railwayapp/nixpacks
- Lisens: MIT

Nixpacks klones ikke – vi bruker den ferdigbygde binæren, som installeres i
backend-imaget (se `backend/Dockerfile`, `ARG NIXPACKS_VERSION`).
