# Egne domener og DNS-fanen

Hvert prosjekt får automatisk `<slug><SNOAT_APP_DOMAIN_SUFFIX>` – altså
`min-app.snoat.com` i produksjon og `min-app.snoat.localhost` lokalt. Denne filen
handler om steget videre: at kunden peker sitt **eget** domene mot Snoat.

Statusen i dag er todelt, og det er viktig å holde de to fra hverandre:

| Del | Status |
| --- | --- |
| Veiledningen i dashboardet (hvilke records kunden må sette) | **Implementert** |
| Ruting og sertifikat for det egne domenet i Caddy | **Ikke implementert** |

DNS-fanen lagrer altså ingenting og oppretter ingen rute. Den forteller kunden
hva som skal inn hos registraren. Se «Det som gjenstår» nederst.

## DNS-fanen i prosjektvisningen

`frontend/src/components/DnsSettingsTab.tsx`, montert som fanen `dns` i
`frontend/src/routes/projects.$projectId.tsx`. Fanen er delt i fire steg med
heksagon-markører:

1. **Statusboks** – prosjektets nåværende Snoat-adresse, en Live-indikator basert
   på siste deployment, og hjelpeteksten om at Caddy utsteder SSL automatisk.
2. **Velg domenet ditt** – kunden skriver inn domenet sitt. En veksler mellom
   *Rotdomene* og *Subdomene* avgjør hvilke records som vises.
3. **Records** – ett kort per record, hver med tre kopiknapper.
4. **Leverandørveiledning + verifisering** – steg for steg hos de vanligste
   norske registrarene, og `dig`-kommandoer for å sjekke resultatet.

Inndata normaliseres før den vises: `https://www.Mitt-Domene.no/` blir
`mitt-domene.no`. Det sparer oss for de vanligste feilene (limt inn URL i stedet
for domene, `www.` foran, avsluttende skråstrek).

## Recordene kunden skal sette

**Rotdomene** (`dittdomene.no` + `www`):

| Type | Host | Verdi | Merknad |
| --- | --- | --- | --- |
| `A` | `@` | `SNOAT_SERVER_IP` | Obligatorisk. |
| `CNAME` | `www` | `<slug><SNOAT_APP_DOMAIN_SUFFIX>` | Anbefalt. |

**Subdomene** (`app.dittdomene.no`):

| Type | Host | Verdi | Merknad |
| --- | --- | --- | --- |
| `CNAME` | `app` | `<slug><SNOAT_APP_DOMAIN_SUFFIX>` | Obligatorisk. |

Rotdomenet må være en A-record fordi DNS ikke tillater CNAME på sonens apex –
en apex-CNAME kolliderer med SOA- og NS-recordene som må ligge der. Subdomener
har ikke det problemet, og der er CNAME å foretrekke: peker vi på vertsnavnet
i stedet for IP-en, overlever kunden en framtidig IP-endring uten å røre sonen
sin.

Fanen sier også fra om at gamle `A`/`AAAA`/`CNAME` på samme host må fjernes
først – én host kan ikke ha både en A-record og en CNAME – og at TTL kan stå på
`3600` eller «Auto».

## `SNOAT_SERVER_IP`

IP-en fanen viser fram i A-recorden. Den utledes **ikke** av domenet, siden
serveren kan bytte IP uten at domenet endres:

- `.env`: `SNOAT_SERVER_IP` (skrives av `scripts/bootstrap-env.mjs`, som beholder
  en eksisterende verdi og bare faller tilbake til `127.0.0.1` lokalt /
  `38.87.117.167` i produksjon).
- Frontend: `VITE_SNOAT_SERVER_IP`, bakt inn i bundlen ved build via `build.args`
  i `docker-compose.yml` og `ARG`/`ENV` i `frontend/Dockerfile`.
- Leses i koden av `frontend/src/lib/platform.ts`.

Bytter serveren IP må frontend bygges på nytt – se `09_production_deployment.md`.

## Cloudflare må stå på «DNS only»

Fanen advarer eksplisitt mot den oransje skyen. Det er to grunner, og begge er
prinsipielle for oss:

1. **Sertifikatet.** Med Cloudflare-proxy foran terminerer Cloudflare TLS, og
   Caddys ACME-utfordring når ikke fram til opprinnelsesserveren.
2. **Datasuverenitet.** Proxyet trafikken gjennom Cloudflare, går den innom
   utenlandsk infrastruktur – stikk i strid med hele premisset for Snoat
   (`01_vision_and_brand.md`).

## Slik verifiserer kunden

```bash
dig +short dittdomene.no            # skal svare med SNOAT_SERVER_IP
dig +short www.dittdomene.no CNAME  # skal svare med <slug>.snoat.com.
```

## Det som gjenstår

Caddy svarer i dag **kun** på vertsnavn som ligger i en `host`-matcher.
`upsertAppRoute` i `backend/src/lib/caddy.ts` registrerer nøyaktig ett:
`<slug><SNOAT_APP_DOMAIN_SUFFIX>`. En kunde som peker `dittdomene.no` mot
serveren treffer altså Caddy, men uten en rute for vertsnavnet får hen verken
innhold eller sertifikat.

For å gjøre funksjonen ekte trengs:

1. **Lagring.** En kolonne `custom_domain` (eller en egen `project_domains`-tabell
   for flere domener per prosjekt) i `projects`, med RLS som resten av skjemaet.
   Unikhet på tvers av brukere må håndheves i databasen – to prosjekter kan ikke
   eie samme vertsnavn.
2. **Ruting.** `upsertAppRoute` må ta imot en liste vertsnavn og legge dem alle i
   `match[0].host`. Det atomiske `PATCH /id/<rute>` vi allerede bruker holder for
   dette; ingen ny mekanikk trengs.
3. **Sertifikat.** `caddy/config.json` har ingen `tls`-app, så Caddy kjører med
   standard automatisk HTTPS og utsteder per vertsnavn som står i konfigurasjonen.
   Legges et domene inn før DNS peker riktig, forsøker Caddy utstedelse og feiler
   i loop – og Let's Encrypt har rate limits. Derfor bør enten (a) domenet
   verifiseres før ruten oppdateres, eller (b) on-demand TLS med et `ask`-endepunkt
   mot backend tas i bruk, slik at Caddy spør oss om vertsnavnet er kjent før den
   ber om et sertifikat.
4. **Verifisering i UI.** Et endepunkt som slår opp domenet og sammenligner mot
   `SNOAT_SERVER_IP`, slik at fanen kan vise «Peker riktig ✓» i stedet for å be
   kunden kjøre `dig` selv.

Inntil dette er på plass skal teksten i fanen forbli ærlig på at egne domener
rulles ut trinnvis. Ikke lov kunden noe plattformen ikke leverer.
