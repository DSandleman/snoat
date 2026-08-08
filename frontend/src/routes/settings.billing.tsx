import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DashboardNav } from "@/components/DashboardNav";
import {
  createBillingPortal,
  createCheckout,
  getBilling,
  type BillingState,
  type PlanOption,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { SubscriptionTier } from "@/lib/database.types";
import { useApiErrorMessage } from "@/lib/errors";
import { useFormatters, type Formatters } from "@/lib/format";
import { useRequestedMarket } from "@/lib/market";

export const Route = createFileRoute("/settings/billing")({
  head: () => ({
    meta: [{ title: "Abonnement — Snoat" }, { name: "robots", content: "noindex" }],
  }),
  component: BillingPage,
});

/**
 * Forbruksmåler.
 *
 * Fargen skifter til `text-error` først når grensen er *nådd*, ikke når den
 * nærmer seg: en måler som står rød på 80 % lærer brukeren å ignorere rødt.
 */
function Meter({
  label,
  hint,
  used,
  limit,
}: {
  label: string;
  hint: string;
  used: number;
  limit: number;
}) {
  const share = limit > 0 ? Math.min(used / limit, 1) : 0;
  const maxed = used >= limit;

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-surface-container p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-label text-label-md text-on-surface">{label}</span>
        <span
          className={`font-mono text-label-md ${maxed ? "text-error" : "text-on-surface-variant"}`}
        >
          {used} / {limit}
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-variant"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${maxed ? "bg-error" : "bg-primary"}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">{hint}</p>
    </div>
  );
}

/** Punktlisten under hver plan, utledet av grensene backend håndhever. */
function planFeatures(plan: PlanOption, t: TFunction): string[] {
  const features = [
    t("billing.feature_apps", { count: plan.limits.maxRunningProjects }),
    t("billing.feature_memory", { mb: plan.limits.memoryMb, cpus: plan.limits.cpus }),
    t("billing.feature_build_minutes", { minutes: plan.limits.buildMinutesPerMonth }),
    t("billing.feature_static"),
  ];

  if (plan.limits.queuePriority > 0) features.push(t("billing.feature_priority"));
  if (plan.id === "business") features.push(t("billing.feature_ehf"));

  return features;
}

function PlanCard({
  plan,
  billing,
  onSelect,
  pending,
  format,
}: {
  plan: PlanOption;
  billing: BillingState;
  onSelect: (plan: "pro" | "business") => void;
  pending: boolean;
  format: Formatters;
}) {
  const { t } = useTranslation();
  const isCurrent = billing.billedPlan === plan.id;

  return (
    <div
      className={`floating-card flex flex-col gap-5 p-6 ${isCurrent ? "shadow-[0_0_0_2px_var(--color-primary)_inset]" : ""}`}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h3 className="font-display text-title-lg text-on-surface">
            {t(`billing.plan_${plan.id}`)}
          </h3>
          {isCurrent && (
            <span className="rounded-full bg-primary/15 px-3 py-1 font-label text-label-sm text-primary">
              {t("billing.current")}
            </span>
          )}
        </div>

        {plan.price === 0 ? (
          <p className="font-display text-headline-sm text-on-surface">{t("billing.free_price")}</p>
        ) : (
          <>
            <p className="font-display text-headline-sm text-on-surface">
              {format.money(plan.price, plan.currency)}
              <span className="font-body text-body-md text-on-surface-variant">
                {" "}
                {t("billing.per_month")}
              </span>
            </p>
            {/* Prisopplysningsforskriften: pris mot forbruker skal vises inkl.
                mva. Mange av kundene våre er soloutviklere, altså forbrukere.

                ⚠️ Bare når satsen er kjent. `priceIncludingVat` er null i
                euro-markedet fordi satsen avhenger av kundeland og forsvinner
                helt ved omvendt avgiftsplikt – da sier vi at avgiften beregnes
                i kassen, framfor å vise et tall som er feil for alle utenom ett
                land. Det er samme forskrift som krever begge deler. */}
            {plan.priceIncludingVat !== null ? (
              <p className="font-body text-body-sm text-on-surface-variant">
                {t("billing.incl_vat", {
                  price: format.money(plan.priceIncludingVat, plan.currency),
                })}
              </p>
            ) : (
              <p className="font-body text-body-sm text-on-surface-variant">
                {t("billing.vat_at_checkout")}
              </p>
            )}
          </>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {planFeatures(plan, t).map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2.5 font-body text-body-sm text-on-surface-variant"
          >
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-auto">
        {isCurrent ? (
          <p className="font-body text-body-sm text-on-surface-variant">
            {t("billing.current_hint")}
          </p>
        ) : plan.id === "free" ? (
          <p className="font-body text-body-sm text-on-surface-variant">
            {t("billing.downgrade_hint")}
          </p>
        ) : plan.purchasable ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSelect(plan.id as "pro" | "business")}
            className="primary-btn w-full px-6 py-3 font-label text-label-md disabled:opacity-50"
          >
            {pending ? t("billing.opening") : t("billing.upgrade")}
          </button>
        ) : (
          <p className="font-body text-body-sm text-on-surface-variant">
            {t("billing.not_purchasable")}
          </p>
        )}
      </div>
    </div>
  );
}

function BillingPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const format = useFormatters();
  const errorMessage = useApiErrorMessage();
  // Markedet visningsspråket tilsier. Et *ønske* – har kunden et abonnement,
  // er valutaen låst hos Stripe, og svaret fra backend sier hva som faktisk
  // gjelder (`state.market`).
  const requestedMarket = useRequestedMarket();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/login" });
  }, [loading, user, navigate]);

  // Stripe sender kunden tilbake hit med ?checkout=. Planen settes av webhooken,
  // ikke av denne redirecten – derfor kan raden fortsatt si «free» et øyeblikk
  // etter et vellykket kjøp, og teksten lover ingenting annet.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("checkout");
    if (!result) return;

    setNotice(result === "ok" ? t("billing.checkout_ok") : t("billing.checkout_canceled"));
    window.history.replaceState(null, "", window.location.pathname);
  }, [t]);

  const billing = useQuery({
    // Markedet er med i nøkkelen: bytter brukeren språk, skal katalogen hentes
    // på nytt i den andre valutaen i stedet for å vise en cachet kroneliste.
    queryKey: ["billing", user?.id, requestedMarket],
    queryFn: () => getBilling(requestedMarket),
    enabled: Boolean(user),
    // Webhooken kan komme noen sekunder etter at kunden er tilbake fra Stripe.
    refetchOnWindowFocus: true,
  });

  const checkout = useMutation({
    mutationFn: (plan: "pro" | "business") => createCheckout(plan, requestedMarket),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (mutationError: unknown) => setError(errorMessage(mutationError)),
  });

  const portal = useMutation({
    mutationFn: createBillingPortal,
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (mutationError: unknown) => setError(errorMessage(mutationError)),
  });

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="font-body text-body-md text-on-surface-variant">{t("login.loading")}</p>
      </div>
    );
  }

  const state = billing.data;

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />

      <main className="mx-auto w-full max-w-container-max flex-grow px-margin-mobile py-stack-lg md:px-gutter">
        <div className="mb-stack-md flex flex-col gap-2">
          <Link
            to="/dashboard"
            className="font-label text-label-md text-on-surface-variant transition-opacity hover:opacity-70"
          >
            ← {t("billing.back")}
          </Link>
          <h1 className="font-display text-headline-lg text-on-background">{t("billing.title")}</h1>
          <p className="font-body text-body-md text-on-surface-variant">{t("billing.subtitle")}</p>
        </div>

        {notice && (
          <div
            role="status"
            className="mb-stack-md rounded-xl bg-surface-container px-5 py-4 animate-in fade-in-50 slide-in-from-top-2 duration-300"
          >
            <p className="font-body text-body-md text-on-surface-variant">{notice}</p>
          </div>
        )}

        {error && (
          <div role="alert" className="mb-stack-md rounded-xl bg-error/10 px-5 py-4">
            <p className="font-body text-body-md text-error">{error}</p>
          </div>
        )}

        {billing.isLoading && (
          <p className="font-body text-body-md text-on-surface-variant">{t("billing.loading")}</p>
        )}

        {billing.isError && (
          <div role="alert" className="rounded-xl bg-error/10 px-5 py-4">
            <p className="font-body text-body-md text-error">{errorMessage(billing.error)}</p>
          </div>
        )}

        {state && (
          <div className="flex flex-col gap-stack-md">
            {/* Betalingen har feilet. Skal stå øverst og si hva som skjer når. */}
            {(state.status === "past_due" || state.status === "unpaid") && (
              <div role="alert" className="floating-card flex flex-col gap-3 p-6 md:p-8">
                <h2 className="font-display text-title-lg text-error">
                  {t("billing.payment_failed_title")}
                </h2>
                <p className="font-body text-body-md text-on-surface-variant">
                  {state.downgraded
                    ? t("billing.downgraded_body", { plan: t(`billing.plan_${state.billedPlan}`) })
                    : t("billing.grace_body", {
                        plan: t(`billing.plan_${state.billedPlan}`),
                        date: format.date(state.graceEndsAt),
                      })}
                </p>
                {state.portalAvailable && (
                  <button
                    type="button"
                    disabled={portal.isPending}
                    onClick={() => portal.mutate()}
                    className="primary-btn self-start px-6 py-3 font-label text-label-md disabled:opacity-50"
                  >
                    {t("billing.fix_payment")}
                  </button>
                )}
              </div>
            )}

            {/* Nåværende plan og forbruk */}
            <section className="floating-card flex flex-col gap-6 p-6 md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                    {t("billing.current_plan")}
                  </span>
                  <span className="font-display text-headline-sm text-on-surface">
                    {t(`billing.plan_${state.billedPlan}`)}
                  </span>

                  {state.cancelAtPeriodEnd && state.currentPeriodEnd ? (
                    <span className="font-body text-body-sm text-on-surface-variant">
                      {t("billing.cancels_on", { date: format.date(state.currentPeriodEnd) })}
                    </span>
                  ) : state.currentPeriodEnd && state.billedPlan !== "free" ? (
                    <span className="font-body text-body-sm text-on-surface-variant">
                      {t("billing.renews_on", { date: format.date(state.currentPeriodEnd) })}
                    </span>
                  ) : null}

                  {state.source === "invoice" && (
                    <span className="font-body text-body-sm text-on-surface-variant">
                      {t("billing.invoiced")}
                    </span>
                  )}
                </div>

                {state.portalAvailable && (
                  <button
                    type="button"
                    disabled={portal.isPending}
                    onClick={() => portal.mutate()}
                    className="ghost-btn px-5 py-2.5 font-label text-label-md disabled:opacity-50"
                  >
                    {portal.isPending ? t("billing.opening") : t("billing.manage")}
                  </button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Meter
                  label={t("billing.usage_apps")}
                  hint={t("billing.usage_apps_hint")}
                  used={state.usage.runningProjects}
                  limit={state.limits.maxRunningProjects}
                />
                <Meter
                  label={t("billing.usage_build_minutes")}
                  hint={t("billing.usage_build_minutes_hint")}
                  used={state.usage.buildMinutesUsed}
                  limit={state.limits.buildMinutesPerMonth}
                />
              </div>

              <p className="font-body text-body-sm text-on-surface-variant">
                {t("billing.usage_static", { count: state.usage.staticProjects })}
              </p>
            </section>

            {/* Planvalg */}
            <section className="flex flex-col gap-4">
              <h2 className="font-display text-title-lg text-on-surface">{t("billing.plans")}</h2>

              {!state.stripeConfigured && (
                <p className="rounded-xl bg-surface-container px-5 py-4 font-body text-body-md text-on-surface-variant">
                  {t("billing.stripe_missing")}
                </p>
              )}

              <div className="grid gap-4 md:grid-cols-3">
                {state.plans.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    billing={state}
                    format={format}
                    pending={checkout.isPending}
                    onSelect={(selected: Exclude<SubscriptionTier, "free">) => {
                      setError(null);
                      checkout.mutate(selected);
                    }}
                  />
                ))}
              </div>

              {/* Noten er markedsspesifikk. Den norske sier «norske kroner,
                  norsk mva»; euro-noten kan ikke love en sats, bare at Stripe
                  regner den i kassen etter kundens land. */}
              <p className="font-body text-body-sm text-on-surface-variant">
                {t(`billing.vat_note_${state.market.id}`)}
              </p>

              {/* Valutaen er låst av et eksisterende abonnement, så språkbyttet
                  endret ikke prisene. Uten denne linjen ser det ut som en feil. */}
              {state.marketLocked && (
                <p className="font-body text-body-sm text-on-surface-variant">
                  {t("billing.currency_locked", {
                    currency: state.market.currency.toUpperCase(),
                  })}
                </p>
              )}
            </section>

            {/* Fakturering utenom kort.

                EHF er en norsk standard og et tilbud som bare gir mening for
                norske bedrifter og offentlig sektor. En kunde i Berlin skal ha
                e-postfaktura-varianten, ikke en oppfordring om å sende
                organisasjonsnummeret sitt til Peppol. `invoiceChannel` kommer
                fra markedet i backend, ikke fra en test på språket her. */}
            <section className="floating-card flex flex-col gap-3 p-6 md:p-8">
              <h2 className="font-display text-title-lg text-on-surface">
                {t(`billing.invoice_${state.market.invoiceChannel}_title`)}
              </h2>
              <p className="font-body text-body-md text-on-surface-variant">
                {t(`billing.invoice_${state.market.invoiceChannel}_body`)}
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
