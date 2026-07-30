import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { SnoatLogo } from "@/components/SnoatLogo";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Nytt passord — Snoat" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

/**
 * Landingspunkt for gjenopprettingslenken.
 *
 * GoTrue sender brukeren hit med en engangskode i URL-en. supabase-js bytter
 * den inn i en midlertidig sesjon (`detectSessionInUrl`), og det er den
 * sesjonen som gir rett til å sette nytt passord. Uten sesjon er lenken
 * utløpt eller allerede brukt.
 */
function ResetPasswordPage() {
  const { user, loading, updatePassword } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /**
   * Sant mens supabase-js bytter engangskoden i URL-en mot en sesjon. Uten
   * denne rekker `loading` å bli false før sesjonen er på plass, og vi ville
   * blinket «lenken virker ikke» til en helt gyldig lenke.
   */
  const [exchangingCode, setExchangingCode] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const description = params.get("error_description") ?? hash.get("error_description");
    if (description) {
      setLinkError(description);
      return;
    }

    const hasCode = params.has("code") || hash.has("access_token");
    if (!hasCode) return;

    setExchangingCode(true);
    // Nødbrems: kommer sesjonen aldri, skal siden lande på «ugyldig lenke»
    // i stedet for å spinne i det uendelige.
    const timer = window.setTimeout(() => setExchangingCode(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (user) setExchangingCode(false);
  }, [user]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError(t("login.error_passwords_dont_match"));
      return;
    }

    setError(null);
    setPending(true);
    try {
      await updatePassword(password);
      await navigate({ to: "/dashboard" });
    } catch (cause) {
      console.error("Password update failed:", cause);
      const code = (cause as { code?: string } | null)?.code;
      if (code === "weak_password") {
        setError(t("reset.error_weak_password"));
      } else if (code === "same_password") {
        setError(t("reset.error_same_password"));
      } else {
        setError(t("login.error_generic"));
      }
    } finally {
      setPending(false);
    }
  };

  const settling = (loading || exchangingCode) && linkError === null;
  const invalidLink = linkError !== null || (!settling && !user);

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
          {settling ? (
            <p className="text-center font-body text-body-md text-on-surface-variant">
              {t("login.loading")}
            </p>
          ) : invalidLink ? (
            <>
              <h1 className="mb-2 font-headline text-headline-lg text-on-surface text-center">
                {t("reset.invalid_title")}
              </h1>
              <p className="mb-stack-md font-body text-body-md text-on-surface-variant text-center">
                {t("reset.invalid_desc")}
              </p>
              <Link
                to="/forgot-password"
                className="primary-btn block w-full py-3.5 text-center font-label text-label-md"
              >
                {t("reset.btn_request_new")}
              </Link>
            </>
          ) : (
            <>
              <h1 className="mb-2 font-headline text-headline-lg text-on-surface text-center">
                {t("reset.title")}
              </h1>
              <p className="mb-stack-md font-body text-body-md text-on-surface-variant text-center">
                {t("reset.desc", { email: user?.email ?? "" })}
              </p>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <label className="flex flex-col gap-2">
                  <span className="font-label text-label-md text-on-surface-variant">
                    {t("reset.new_password_label")}
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="rounded-xl bg-surface-container px-4 py-3 font-body text-body-md text-on-surface outline-none ring-primary/60 focus:ring-2"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="font-label text-label-md text-on-surface-variant">
                    {t("login.confirm_password_label")}
                  </span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="rounded-xl bg-surface-container px-4 py-3 font-body text-body-md text-on-surface outline-none ring-primary/60 focus:ring-2"
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
                  {pending ? t("login.loading") : t("reset.btn_save")}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
