# 05. Design System & Styling (Stilguide)

Denne filen dokumenterer design- og styling-reglene basert på forsiden. Disse reglene utgjør den overordnede standarden for hele plattformen (inkludert Dashboard, Autentisering og fremtidige komponenter).

## ⚠️ Grunnleggende Prinsipp: Ingen Borders, Kun Skygge
Et av de absolutt viktigste kjennetegnene ved Snoat sitt design er at vi **ikke bruker tradisjonelle borders (kanter)** for å separere elementer eller definere kort. I stedet skaper vi dybde, struktur og hierarki utelukkende ved hjelp av avanserte skygger (box-shadows) og subtile overflatefarger.

1. **Ingen Borders:** I `styles.css` har alle elementer `border-color: transparent;` som standard i `@layer base`. Du skal unngå bruk av Tailwind border-klasser (f.eks. `border`, `border-gray-200`, `border-white/10`) for layout og paneler. 
2. **Lagdelte Skygger:** For å fremheve elementer (som kort, modaler, og sticky headere), bruker vi lagdelte skygger:
   - *Inner shadow (Inset):* Skaper en subtil "edge" eller highlight på toppen av mørke flater, for eksempel: `inset 0 1px 0 0 oklch(1 0 0 / 5%)`.
   - *Outer shadows:* Brukes for å skape myk og organisk dybde. For eksempel, headere eller kort benytter kombinasjoner som `0 2px 8px -2px oklch(...)` og `0 28px 70px -35px oklch(...)`.

## Grunnleggende Byggeklosser
Stilen fra forsiden definerer følgende utilities og designmønstre som skal gjenbrukes:

### Kort og Paneler (`.floating-card`)
Kort og widgets skal føles som om de flyter på bakgrunnen. Vi bruker `.floating-card`-utility-klassen (eller lignende mønstre). 
- Stor border-radius (`rounded-2xl` eller `rounded-3xl`).
- En bakgrunn basert på `surface` (ofte svakt gjennomsiktig via `color-mix` eller `bg-surface/90`).
- Markante skygger (ingen borders!).

### Knapper
- **Primary (`.primary-btn`):** Sterkt avrundet (`rounded-full`), fylt med den isblå/elektriske primærfargen. Skaper sterk kontrast.
- **Ghost (`.ghost-btn`):** Knapper for sekundære handlinger som blender inn i grensesnittet uten rammer, kun med hover-effekter.

### Typografi (Fonter)
- **Overskrifter:** `Space Grotesk` (`font-display`, `font-headline`). Gir plattformen den karakteristiske, moderne "tech-viben".
- **Lese- og brødtekst:** `DM Sans` (`font-body`, `font-label`). Ren, geometrisk og høyst lesbar for tette brukergrensesnitt som dashboards.

### Fargesystem (OKLCH & CSS Variables)
Vi bruker semantiske farger basert på OKLCH for å sikre et levende og konsistent Dark Mode:
- **`--background` / `bg-background`:** Den aller dypeste bakgrunnen (brukes typisk på `body`).
- **`--surface` / `bg-surface`:** Grunnfargen for kort og overflater som ligger ett lag over bakgrunnen.
- **`--surface-container` / `bg-surface-container`:** Elementer inne i kort, for eksempel innholdsbokser eller input-felt-bakgrunner.
- **Tekstfarger:** Bruk `text-on-background`, `text-on-surface` (primærtekst), og `text-on-surface-variant` (dempet/sekundær tekst).

## Mønstre i dashboardet

Forsiden definerer grunnstilen. Dashboardet har i tillegg noen gjentakende
mønstre som skal gjenbrukes framfor å finnes opp på nytt. Referanse-
implementasjonene ligger i `components/DnsSettingsTab.tsx` og
`routes/projects.$projectId.tsx`.

### Kopiering til utklippstavle
Tekniske verdier (IP-er, vertsnavn, kommandoer, tokens) skal kunne kopieres med
ett klikk:

- **Hele feltet er knappen**, ikke et lite ikon ved siden av. Verdien vises i
  `font-mono` på `bg-surface`, med kopi-ikonet til høyre.
- Ved klikk byttes ikonet til **«Kopiert! ✓» i `text-secondary`** (den grønne),
  og faller tilbake etter ~1,8 sekunder.
- Clipboard-API-et krever secure context. Feiler kallet, skal knappen si
  **«Feilet» i `text-error`** – aldri se ut som om den lyktes.
- Statusen dupliseres i en `sr-only`-node med `aria-live="polite"`, og knappen
  har `aria-label` med både etikett og verdi.

### Fargenes rollefordeling
- `text-primary` (isblå, #00F0FF): aksent, handling, aktiv tilstand, lenker.
- `text-secondary` (grønn): bekreftelse og suksess – «Kopiert!», «Live».
- `text-error`: feil.
- `text-on-surface-variant`: alt dempet, inkludert hvilende ikoner.

Blandes disse, mister den isblå fargen betydningen sin. Suksess er aldri blå.

### Heksagon som detalj
Logoens heksagon gjentas som en liten merkevaredetalj – som nummererte
stegmarkører (`HexStep`) og som stor, nesten usynlig vannmerke-polygon i hjørnet
av en statusboks (`text-primary/[0.07]`, `pointer-events-none`). Det er dekor:
alltid `aria-hidden`, aldri bærer av informasjon.

### Segmentert fanelinje
Fanene ligger i en `bg-surface-container`-pille, og den aktive fanen markeres av
et lag som animeres i posisjon (`transition-all` + `cubic-bezier(0.2,0.8,0.2,1)`).
Indikatoren posisjoneres i piksler ut fra den aktive knappen, og **må lese både
`offsetTop`/`offsetHeight` og `offsetLeft`/`offsetWidth`** – med flere faner
brekker raden på mobil, og en indikator som bare kjenner `left` blir liggende
igjen på første linje. Posisjonen regnes på nytt ved `resize`.

Fanene defineres i en `TABS`-liste og rendres i en `map`, ikke som ett
kopiert blokk per fane.

### Innholdsbokser og lister uten skillelinjer
Rader som ellers ville fått en `divide-y`, skal heller være egne kort på
`bg-surface-container` med `gap` imellom. Trekkspill (accordion) bygges på samme
måte: `bg-surface-container`, hover på `bg-surface-variant/30`, og en chevron som
roterer 180°. `aria-expanded` og `aria-controls` skal alltid være på plass.

### Monospace for tekniske verdier
IP-adresser, vertsnavn, kommandoer, miljøvariabler og commit-hasher settes i
`font-mono`. Brødtekst og etiketter forblir DM Sans. Det gjør det umiddelbart
tydelig hva som er noe brukeren skal kopiere ordrett.

## Oppsummering for Utvikling
Når du implementerer nye sider (f.eks. Dashboard-view for prosjekter):
1. **IKKE BRUK BORDERS** for å ramme inn innhold. Bruk skygge og bakgrunnskontrast.
2. Sørg for romslig padding og luft (Nordisk minimalisme).
3. Respekter det mørke temaet – unngå plutselige hvite flater. Alt skal bygges fra `oklch`-fargene definert i `.css`-filen.
