# Konsept og Målsetning
Snoat (snoat.com) er en helnorsk, selvhostet hosting- og distribusjonsplattform bygget som et direkte alternativ til Vercel. Plattformen opererer på infrastruktur levert av Frostbyte Group AS. Hovedformålet er å tilby en moderne, sømløs utvikleropplevelse, kombinert med ufravikelige krav til personvern, sikkerhet og nasjonal kontroll.

## Målgruppe
- Norske utviklere og tech-leads.
- Norske bedrifter, etater og kommuner med strenge krav til GDPR og datasikkerhet.

## Kjerneargumenter (USPs)
- **Datasuverenitet:** All data, både kildekode og sluttbrukerdata (via selvhostet Supabase), forblir fysisk i Norge.
- **Lynrask ytelse:** Lokale servere sikrer markant lavere latens for norske og nordiske brukere sammenlignet med amerikanske skytjenester.
- **Utrulling uten nedetid:** En ny versjon starter ved siden av den som kjører, og trafikken flyttes over først når den nye er bekreftet oppe. Brukerne merker ingen nedetid, og en deployment som feiler lar den kjørende versjonen stå – appen kan ikke gå ned av at noen deployer noe som ikke virker. Se `03_deployment_flow.md`.
- **Sikkerhet:** Plattformen har innebygd DDoS-beskyttelse, hastighetsbegrensninger (rate limiting), en robust omvendt proxy og muligheter for automatiserte sikkerhetsanalyser.
- **Økonomi og "Free Plan":** Overskuddskapasitet på eksisterende infrastruktur benyttes for å tilby en gratisplan for hobbyprosjekter, kontrollert med ressurs- og båndbreddegrenser for å unngå overbelastning. Vårt selskap, Frostbyte Group AS, fungerer som MVA-registrert kjøper i oppstartsfasen for å holde byråkrati nede.

## Merkevare og Design
- **Identitet:** Navnet "Snoat" er kort, unikt og fungerer som et blankt lerret i tech-bransjen (merk: avstand tas fra "SNote", en eksisterende notatapp, ved å ha et rendyrket hosting-fokus).
- **Visuell profil:** Nordisk minimalisme med en profesjonell "tech-vibe". Dark Mode er standard.
- **Logo:** Et wordmark basert på et geometrisk heksagon (symboliserer containere, byggeklosser og stabilitet). Heksagonet former den første bokstaven ("S"), med resten av navnet ("noat") i en ren sans-serif skrifttype. En isblå/elektrisk aksentfarge (#00F0FF) og en statusprikk på slutten indikerer lav latens, kulde og at systemet er operativt.
