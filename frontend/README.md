# Snoat Frontend

Landingsside og dashboard. Bygget med TanStack Start (React 19 på Vite) og
Tailwind CSS v4, etter designsystemet i `CONTEXT_FOR_AI/05_design_system.md`.

## Ruter

| Rute | Hva |
| --- | --- |
| `/` | Landingssiden. Innloggingsknappene tilpasser seg om du har sesjon. |
| `/login` | GitHub OAuth + e-post/passord. Samme skjema for innlogging og registrering. |
| `/auth/callback` | Landingspunkt etter OAuth. supabase-js bytter `?code=` inn i en sesjon. |
| `/dashboard` | «Mine prosjekter». Krever sesjon, sender ellers til `/login`. |

Dashboardet trigger deployments via `lib/api.ts` og følger byggingen over
Supabase Realtime — det poller aldri backend. `useDeploymentsRealtime` holder
prosjektlisten synkron, og `DeploymentLogsDialog` viser byggeloggen live mens
den skrives.

## Designsystemet

Reglene fra `05_design_system.md` gjelder i hele dashboardet:

- **Ingen borders.** Dybde skapes med `.floating-card` og lagdelte skygger.
- **Space Grotesk** på overskrifter (`font-display`, `font-headline`),
  **DM Sans** på brødtekst (`font-body`, `font-label`).
- Semantiske OKLCH-farger: `bg-surface`, `bg-surface-container`,
  `text-on-surface`, `text-on-surface-variant`.
- `.primary-btn` (fylt, `rounded-full`) og `.ghost-btn` for sekundære valg.

Alt er definert i [src/styles.css](src/styles.css). Den geometriske
heksagon-logoen ligger i [src/components/SnoatLogo.tsx](src/components/SnoatLogo.tsx)
og brukes både på landingssiden og i dashboard-navbaren.

## Supabase

`src/lib/supabase.ts` eksporterer `getSupabase()` – ikke en ferdig klient.

Klienten **må** opprettes lat. `createClient` konstruerer Realtime-klienten med
én gang, og den kaster «Node.js 20 detected without native WebSocket support»
under SSR. Dashboardet er klient-rendret: all datahenting skjer i effekter og i
react-query-spørringer som er deaktivert til vi har en sesjon, så `getSupabase()`
kalles aldri på serveren. Kaller du den under SSR får du en tydelig feilmelding.

Sesjonen håndteres av `src/lib/auth.tsx` (`<AuthProvider>` + `useAuth()`), som
er montert i `__root.tsx`.

Spørringene filtrerer ikke på `user_id` – det gjør RLS i databasen.

## Miljøvariabler

`frontend/.env` genereres av `scripts/bootstrap-env.mjs` i repo-roten, slik at
nøklene aldri divergerer fra det Supabase-stacken faktisk kjører med:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SNOAT_API_URL
```

## Kjøre lokalt

```bash
npm install
npm run dev      # http://localhost:8080
npm run build
npm run lint
```

Innlogging krever at Supabase-stacken kjører (`docker compose up -d` i roten).
GitHub OAuth krever i tillegg at `GITHUB_OAUTH_ENABLED=true` er satt i rot-`.env`;
e-post/passord fungerer uten videre oppsett siden `ENABLE_EMAIL_AUTOCONFIRM` er på
i utviklingsmiljøet.
