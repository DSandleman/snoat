import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { SnoatLogo } from "@/components/SnoatLogo";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export const Route = createFileRoute("/forgot-password")({
  validateSearch: (search: Record<string, unknown>): { email?: string } => ({
    email: typeof search.email === "string" ? search.email : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Glemt passord — Snoat" },
      { name: "description", content: "Få tilsendt en lenke for å sette nytt passord." },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const { email: prefill } = Route.useSearch();
  const { t } = useTranslation();

  const [email, setEmail] = useState(prefill ?? "");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError(t("login.err_invalid_email"));
      return;
    }

    setError(null);
    setPending(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (cause) {
      console.error("Password reset request failed:", cause);
      const code = (cause as { code?: string } | null)?.code;
      if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
        setError(t("login.error_rate_limit"));
      } else if (cause instanceof Error && cause.message.includes("Failed to fetch")) {
        setError(t("login.error_network"));
      } else {
        // Alt annet svelges med vilje: å skille «finnes ikke» fra «feilet» her
        // ville gjort skjemaet til et oppslagsverk over registrerte adresser.
        setSent(true);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 z-[-1] flex items-start justify-center opacity-20">
        <div className="mt-[-200px] h-[700px] w-[700px] rounded-full bg-primary blur-[150px] mix-blend-screen" />
      </div>

      <header className="mx-auto w-full max-w-container-max flex items-center justify-between px-margin-mobile py-6 md:px-gutter">
        <Link to="/" className="inline-flex">
          <SnoatLogo />
        </Link>
        <LanguageSwitcher />
      </header>

      <main className="flex flex-grow items-center justify-center px-margin-mobile py-stack-lg">
        <div className="floating-card w-full max-w-md p-8 md:p-10">
          <h1 className="mb-2 font-headline text-headline-lg text-on-surface text-center">
            {t("forgot.title")}
          </h1>

          {sent ? (
            <>
              <p className="mb-stack-md font-body text-body-md text-on-surface-variant text-center">
                {t("forgot.sent_desc", { email })}
              </p>
              <Link
                to="/login"
                className="block w-full text-center font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
              >
                {t("login.back_to_signin")}
              </Link>
            </>
          ) : (
            <>
              <p className="mb-stack-md font-body text-body-md text-on-surface-variant text-center">
                {t("forgot.desc")}
              </p>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <label className="flex flex-col gap-2">
                  <span className="font-label text-label-md text-on-surface-variant">
                    {t("login.email_label")}
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                    placeholder={t("login.email_placeholder")}
                    className="rounded-xl bg-surface-container px-4 py-3 font-body text-body-md text-on-surface outline-none ring-primary/60 placeholder:text-on-surface-variant/40 focus:ring-2 transition-all"
                  />
                </label>

                {error && (
                  <p role="alert" className="font-body text-body-md text-error text-center">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={pending}
                  className="primary-btn mt-2 w-full py-3.5 font-label text-label-md disabled:opacity-50"
                >
                  {pending ? t("login.loading") : t("forgot.btn_send")}
                </button>
              </form>

              <Link
                to="/login"
                className="mt-6 block w-full text-center font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
              >
                {t("login.back_to_signin")}
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
