import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Norsk skyinfrastruktur for moderne apper" },
      {
        name: "description",
        content:
          "Deploy appene dine på helnorsk infrastruktur. Lynrask ytelse, full datasuverenitet og sømløs utvikleropplevelse.",
      },
      { property: "og:title", content: "Norsk skyinfrastruktur for moderne apper" },
      {
        property: "og:description",
        content: "Lynrask ytelse, full datasuverenitet og sømløs utvikleropplevelse.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const features = [
  {
    icon: "shield_lock",
    tone: "text-primary",
    title: "Datasuverenitet",
    body: "All data i Norge. 100% GDPR-compliant. Trygt, sikkert og lokalt.",
    wide: true,
  },
  {
    icon: "speed",
    tone: "text-secondary",
    title: "Lynrask ytelse",
    body: "Lokale servere gir lavere latens.",
    watermark: "bolt",
  },
  {
    icon: "security",
    tone: "text-error",
    title: "Sikkerhet først",
    body: "DDoS-beskyttelse og automatisk analyse.",
  },
  {
    icon: "code",
    tone: "text-primary",
    title: "Utvikleropplevelse",
    body: "GitHub-integrasjon og Next.js-støtte.",
  },
  {
    icon: "database",
    tone: "text-secondary-fixed",
    title: "Trygg Backend",
    body: "Integrert selvhostet Supabase i Norge.",
  },
];

function Index() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <header className="fixed inset-x-0 top-0 z-50 bg-background/70 shadow-[0_8px_30px_-20px_oklch(0_0_0/0.9)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-container-max items-center justify-between px-margin-mobile py-4 md:px-gutter">
          <SnoatLogo />
          <nav className="hidden items-center gap-8 md:flex">
            <a href="#funksjoner" className="font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface">
              Funksjoner
            </a>
            <a href="#prising" className="font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface">
              Prising
            </a>
            <a href="#sikkerhet" className="font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface">
              Sikkerhet
            </a>
          </nav>
          <button className="primary-btn px-5 py-2.5 font-label text-label-md">Bli med i beta</button>
        </div>
      </header>

      <main className="flex-grow pt-32">
        {/* Hero */}
        <section className="relative mx-auto mb-24 max-w-container-max px-margin-mobile py-stack-lg text-center md:px-gutter">
          <div className="pointer-events-none absolute inset-0 z-[-1] flex items-center justify-center opacity-20">
            <div className="h-[800px] w-[800px] rounded-full bg-primary blur-[150px] mix-blend-screen" />
          </div>

          <h1 className="mx-auto mb-stack-md max-w-4xl font-display text-display text-on-background">
            Norges lynraske infrastruktur for moderne apper
          </h1>
          <p className="mx-auto mb-stack-lg max-w-2xl font-body text-body-lg text-on-surface-variant">
            Deploy appene dine på helnorsk infrastruktur. Lynrask ytelse, full datasuverenitet og
            sømløs utvikleropplevelse.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button className="primary-btn w-full px-8 py-4 font-label text-label-md sm:w-auto">
              Bli med i lukket beta
            </button>
            <button className="ghost-btn flex w-full items-center justify-center gap-2 px-8 py-4 font-label text-label-md sm:w-auto">
              Les om sikkerhet
              <span className="material-symbols-outlined icon-sm">arrow_forward</span>
            </button>
          </div>
        </section>

        {/* Trusted by */}
        <section className="mx-auto mb-24 max-w-container-max px-margin-mobile py-stack-lg text-center opacity-60 md:px-gutter">
          <p className="mb-8 font-label text-label-md uppercase tracking-widest text-on-surface-variant">
            Utviklet for norske utviklere og IT-ledere
          </p>
          <div className="flex flex-wrap items-center justify-center gap-12 grayscale">
            <div className="h-8 w-24 rounded bg-surface-container" />
            <div className="h-8 w-32 rounded bg-surface-container" />
            <div className="h-8 w-20 rounded bg-surface-container" />
            <div className="h-8 w-28 rounded bg-surface-container" />
          </div>
        </section>

        {/* Features */}
        <section
          id="funksjoner"
          className="mx-auto mb-24 max-w-container-max px-margin-mobile py-stack-lg md:px-gutter"
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className={`floating-card group relative flex min-h-[300px] flex-col justify-end overflow-hidden p-8 ${
                  f.wide ? "md:col-span-2" : ""
                }`}
              >
                {f.wide && (
                  <div className="absolute inset-0 z-0 bg-gradient-to-br from-surface-container to-transparent opacity-50" />
                )}
                {f.watermark && (
                  <div className="absolute right-0 top-0 p-8 opacity-20 transition-opacity duration-500 group-hover:opacity-40">
                    <span className="material-symbols-outlined icon-xl text-secondary">
                      {f.watermark}
                    </span>
                  </div>
                )}
                <div className="relative z-10">
                  <span className={`material-symbols-outlined icon-lg mb-4 ${f.tone}`}>
                    {f.icon}
                  </span>
                  <h3
                    className={`mb-2 font-headline text-on-surface ${
                      f.wide ? "text-headline-lg" : "text-headline-md"
                    }`}
                  >
                    {f.title}
                  </h3>
                  <p className="max-w-md font-body text-body-md text-on-surface-variant">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section
          id="prising"
          className="mx-auto mb-24 max-w-container-max px-margin-mobile py-stack-lg text-center md:px-gutter"
        >
          <h2 className="mb-12 font-headline text-headline-lg text-on-background">Enkel prising</h2>
          <div className="flex flex-col justify-center gap-8 md:flex-row">
            <div className="floating-card w-full max-w-sm p-8 text-left">
              <h3 className="mb-2 font-headline text-headline-md text-on-surface">Hobby</h3>
              <p className="mb-4 font-display text-display text-on-background">Gratis</p>
              <p className="mb-8 font-body text-body-md text-on-surface-variant">
                For testprosjekter og porteføljer.
              </p>
              <button className="ghost-btn w-full border border-outline py-3 font-label text-label-md">
                Start gratis
              </button>
            </div>
            <div className="floating-card relative w-full max-w-sm overflow-hidden p-8 text-left">
              <div className="absolute inset-0 z-0 bg-primary/5" />
              <div className="relative z-10">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-surface-variant px-3 py-1 text-on-surface-variant">
                  <span className="font-label text-label-md">Anbefalt for bedrifter</span>
                </div>
                <h3 className="mb-2 font-headline text-headline-md text-on-surface">Pro</h3>
                <p className="mb-4 font-display text-display text-on-background">Ta kontakt</p>
                <p className="mb-8 font-body text-body-md text-on-surface-variant">
                  Skalerbar ytelse og dedikert support.
                </p>
                <button className="primary-btn w-full py-3 font-label text-label-md">
                  Kontakt salg
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer id="sikkerhet" className="border-t border-border">
        <div className="mx-auto flex max-w-container-max flex-col items-center justify-between gap-4 px-margin-mobile py-10 text-center md:flex-row md:px-gutter md:text-left">
          <span className="font-display text-headline-md text-on-surface">nordsky</span>
          <p className="font-body text-body-md text-on-surface-variant">
            Bygget i Norge. Data lagret i Norge. © {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}
