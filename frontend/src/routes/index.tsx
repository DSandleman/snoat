import { createFileRoute, Link } from "@tanstack/react-router";
import { SnoatLogo } from "@/components/SnoatLogo";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Snoat — norsk skyinfrastruktur for moderne apper" },
      {
        name: "description",
        content:
          "Deploy nettside på ett klikk — 100% GDPR-vennlig på norsk infrastruktur.",
      },
      { property: "og:title", content: "Snoat — norsk skyinfrastruktur for moderne apper" },
      {
        property: "og:description",
        content: "Deploy nettside på ett klikk — 100% GDPR-vennlig på norsk infrastruktur.",
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
    titleKey: "features.data_sovereignty.title",
    bodyKey: "features.data_sovereignty.body",
    wide: true,
  },
  {
    icon: "speed",
    tone: "text-secondary",
    titleKey: "features.performance.title",
    bodyKey: "features.performance.body",
    watermark: "bolt",
  },
  {
    icon: "security",
    tone: "text-error",
    titleKey: "features.security.title",
    bodyKey: "features.security.body",
  },
  {
    icon: "code",
    tone: "text-primary",
    titleKey: "features.dx.title",
    bodyKey: "features.dx.body",
  },
  {
    icon: "database",
    tone: "text-secondary-fixed",
    titleKey: "features.backend.title",
    bodyKey: "features.backend.body",
  },
];

function Index() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  const signedIn = !loading && Boolean(user);

  const currentYear = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <header className="fixed inset-x-0 top-0 z-50 bg-background/70 shadow-[0_8px_30px_-20px_oklch(0_0_0/0.9)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-container-max items-center justify-between px-margin-mobile py-4 md:px-gutter">
          <SnoatLogo />
          <nav className="hidden items-center gap-8 md:flex">
            <a
              href="#funksjoner"
              className="font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
            >
              {t("nav.features")}
            </a>
            <a
              href="#prising"
              className="font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
            >
              {t("nav.pricing")}
            </a>
          </nav>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <div className="flex items-center gap-2">
              {signedIn ? (
                <Link to="/dashboard" className="primary-btn px-5 py-2.5 font-label text-label-md">
                  {t("nav.my_projects")}
                </Link>
              ) : (
                <>
                  <Link to="/login" className="ghost-btn px-4 py-2.5 font-label text-label-md">
                    {t("nav.login")}
                  </Link>
                  <Link to="/login" className="primary-btn px-5 py-2.5 font-label text-label-md">
                    {t("nav.register")}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow pt-32">
        {/* Hero */}
        <section className="relative mx-auto mb-24 max-w-container-max px-margin-mobile py-stack-lg text-center md:px-gutter">
          <div className="pointer-events-none absolute inset-0 z-[-1] flex items-center justify-center opacity-20">
            <div className="h-[800px] w-[800px] rounded-full bg-primary blur-[150px] mix-blend-screen" />
          </div>

          <h1 className="mx-auto mb-stack-md max-w-4xl font-display text-display text-on-background">
            {t("hero.title")}
          </h1>
          <p className="mx-auto mb-stack-lg max-w-2xl font-body text-body-lg text-on-surface-variant">
            {t("hero.description")}
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              to={signedIn ? "/dashboard" : "/login"}
              className="primary-btn w-full px-8 py-4 text-center font-label text-label-md sm:w-auto"
            >
              {signedIn ? t("hero.cta_go_to_projects") : t("hero.cta_register")}
            </Link>
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
                key={f.titleKey}
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
                    {t(f.titleKey)}
                  </h3>
                  <p className="max-w-md font-body text-body-md text-on-surface-variant">
                    {t(f.bodyKey)}
                  </p>
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
          <h2 className="mb-12 font-headline text-headline-lg text-on-background">{t("pricing.title")}</h2>
          <div className="flex flex-col justify-center gap-8 md:flex-row">
            {/* Hobby */}
            <div className="floating-card flex w-full max-w-sm flex-col p-8 text-left">
              <h3 className="mb-2 font-headline text-headline-md text-on-surface">{t("pricing.hobby.title")}</h3>
              <p className="mb-4 font-display text-display text-on-background">{t("pricing.hobby.price")}</p>
              <p className="font-body text-body-md text-on-surface-variant">
                {t("pricing.hobby.description")}
              </p>
            </div>

            {/* Standard */}
            <div className="floating-card flex w-full max-w-sm flex-col p-8 text-left">
              <h3 className="mb-2 font-headline text-headline-md text-on-surface">{t("pricing.standard.title")}</h3>
              <p className="mb-4 font-display text-display text-on-background">{t("pricing.standard.price")}</p>
              <p className="font-body text-body-md text-on-surface-variant">
                {t("pricing.standard.description")}
              </p>
            </div>

            {/* Enterprise */}
            <div className="floating-card flex w-full max-w-sm flex-col p-8 text-left">
              <h3 className="mb-2 font-headline text-headline-md text-on-surface">{t("pricing.enterprise.title")}</h3>
              <p className="mb-4 font-display text-display text-on-background">{t("pricing.enterprise.price")}</p>
              <p className="font-body text-body-md text-on-surface-variant">
                {t("pricing.enterprise.description")}
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer id="sikkerhet" className="shadow-[0_-8px_30px_-24px_oklch(0_0_0/0.9)]">
        <div className="mx-auto flex max-w-container-max flex-col items-center justify-between gap-4 px-margin-mobile py-10 text-center md:flex-row md:px-gutter md:text-left">
          <SnoatLogo />
          <p className="font-body text-body-md text-on-surface-variant">
            {t("footer.copyright", { year: currentYear })}
          </p>
        </div>
      </footer>
    </div>
  );
}
