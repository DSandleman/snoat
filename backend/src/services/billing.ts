import type Stripe from "stripe";
import { logger } from "../lib/logger.js";
import { planForSubscription, stripe } from "../lib/stripe.js";
import { supabase } from "../lib/supabase.js";
import type { Subscription, SubscriptionStatus, SubscriptionTier } from "../types.js";

/**
 * Abonnementstilstand: alt som skriver til `subscriptions`.
 *
 * Webhooken tolker eventet, denne filen bestemmer hva raden skal bli. Skillet
 * gjør at hele nedgraderings- og oppgraderingslogikken kan leses ett sted, i
 * stedet for å ligge spredt over fire event-handlere.
 */

/**
 * Stripe sine statuser oversatt til våre.
 *
 * `incomplete_expired` og `paused` finnes ikke i vår enum: begge betyr i praksis
 * «ingen aktiv avtale», og vi lagrer dem som `canceled` framfor å utvide enumen
 * med tilstander ingen kode skiller mellom. `OtherString` i Stripe-typen er
 * grunnen til at defaulten må finnes – de kan legge til nye statuser.
 */
function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "incomplete":
      return "incomplete";
    case "canceled":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    default:
      logger.warn({ status }, "Ukjent Stripe-status – behandles som canceled");
      return "canceled";
  }
}

/**
 * Slutten på perioden det er betalt for.
 *
 * ⚠️ Feltet ligger på **abonnements-linjen**, ikke på abonnementet. Stripe
 * flyttet det dit da fakturering per linje kom, og `subscription.current_period_end`
 * finnes ikke lenger i API-versjonen SDK-en vår bruker. Leser man den gamle
 * plasseringen, får man `undefined` – ingen typefeil, ingen kjøretidsfeil, bare
 * en kolonne som stille blir NULL og en nådefrist som aldri regnes ut riktig.
 */
function periodEnd(subscription: Stripe.Subscription): string | null {
  const seconds = subscription.items.data[0]?.current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

/**
 * Faktureringslandet, hentet fra kunden abonnementet hører til.
 *
 * Adressen ligger på **kunden**, ikke på abonnementet, og den er samlet inn i
 * kassen (`billing_address_collection: "required"`). Det er den Stripe Tax
 * regner avgift etter, så det er den vi lagrer – ikke noe vi utleder av språk
 * eller valuta. En kunde kan godt betale i euro og holde til i Norge.
 *
 * Kunden er ekspandert av `syncById()` i `routes/stripe.ts`. Er den ikke det –
 * for eksempel fordi eventet kom en annen vei – svarer vi null i stedet for å
 * gjøre et ekstra API-kall i en webhook som skal svare raskt.
 */
function billingCountry(subscription: Stripe.Subscription): string | null {
  const customer = subscription.customer;
  if (typeof customer === "string" || customer.deleted) return null;
  return customer.address?.country ?? null;
}

/**
 * Om kunden oppga et mva-/organisasjonsnummer i kassen.
 *
 * Skillet betyr penger i EU: en bedrift med gyldig mva-nummer faktureres uten
 * mva (omvendt avgiftsplikt), en forbruker med. Stripe avgjør dette selv i
 * kassen – vi lagrer det bare, slik at dashboardet kan si «eks. mva» til en
 * bedrift uten å lyve for en forbruker.
 */
function customerKind(subscription: Stripe.Subscription): "individual" | "business" | null {
  const customer = subscription.customer;
  if (typeof customer === "string" || customer.deleted) return null;
  return customer.tax_ids?.data?.length ? "business" : "individual";
}

/** Bruker-ID-en et Stripe-abonnement tilhører, eller null hvis vi ikke kjenner den. */
async function userIdForSubscription(subscription: Stripe.Subscription): Promise<string | null> {
  // Metadata er den primære koblingen: den settes når vi oppretter checkout-
  // sesjonen, og følger abonnementet resten av livet.
  const fromMetadata = subscription.metadata?.snoat_user_id;
  if (fromMetadata) return fromMetadata;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const { data, error } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Kunne ikke slå opp kunden ${customerId}: ${error.message}`);
  }

  return (data as { user_id: string } | null)?.user_id ?? null;
}

/**
 * Skriver abonnementet slik Stripe beskriver det nå.
 *
 * **Hele tilstanden skrives hver gang, fra subscription-objektet.** Det er
 * bevisst, og det er forskjellen på denne og en handler per event: Stripe
 * garanterer ikke rekkefølgen på leveringene. Kom `customer.subscription.updated`
 * fram før `checkout.session.completed`, ville en inkrementell oppdatering latt
 * den eldre meldingen skrive over den nyere tilstanden. Ved å hente alt fra
 * objektet vi nettopp fikk, konvergerer raden mot sannheten uansett rekkefølge.
 */
export async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const userId = await userIdForSubscription(subscription);

  if (!userId) {
    // Kan skje hvis abonnementet ble opprettet direkte i Stripe-dashboardet på
    // en kunde vi ikke kjenner. Vi lager ingen rad på magefølelse.
    logger.warn(
      { subscription: subscription.id, customer: subscription.customer },
      "Stripe-abonnement uten kjent Snoat-bruker – hoppet over",
    );
    return;
  }

  const status = mapStatus(subscription.status);
  const plan = planForSubscription(subscription);

  if (!plan) {
    logger.error(
      { subscription: subscription.id, userId },
      "Fant ingen Snoat-plan for abonnementet – sett snoat_plan i metadata på produktet i Stripe",
    );
    return;
  }

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  // Et abonnement som er borte gir ingen rettigheter, uansett hvilken price det
  // pekte på. `canceled` her betyr «perioden er faktisk over» – en oppsigelse
  // som løper ut måneden er `active` med cancel_at_period_end.
  const effectivePlan: SubscriptionTier = status === "canceled" ? "free" : plan;

  const current: Pick<Subscription, "delinquent_since" | "currency"> | null = await supabase
    .from("subscriptions")
    .select("delinquent_since, currency")
    .eq("user_id", userId)
    .maybeSingle()
    .then(({ data }) => data as Pick<Subscription, "delinquent_since" | "currency"> | null);

  const delinquent = status === "past_due" || status === "unpaid";

  const country = billingCountry(subscription);
  const kind = customerKind(subscription);

  // ⚠️ Valutaen kommer fra abonnementet, ikke fra vår antakelse om markedet.
  // Stripe låser den til kunden ved første faktura, så dette er fasiten – og
  // det er den `resolveMarket()` leser for å slippe å vise euro-priser til en
  // kunde som faktureres i kroner.
  const currency = subscription.currency ?? current?.currency ?? null;

  if (current?.currency && currency && current.currency !== currency) {
    // Skal ikke kunne skje: Stripe tillater ikke at en kunde bytter valuta.
    // Skjer det likevel, er det verdt å vite om – da har kunden fått en ny
    // Stripe-kunde et sted, og vi kjenner bare det ene abonnementet.
    logger.warn(
      { userId, from: current.currency, to: currency, subscription: subscription.id },
      "Abonnementet byttet valuta – kontroller om brukeren har to Stripe-kunder",
    );
  }

  await write(userId, {
    plan: effectivePlan,
    status,
    source: "stripe",
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    current_period_end: periodEnd(subscription),
    cancel_at_period_end: subscription.cancel_at_period_end,
    delinquent_since: delinquent
      ? (current?.delinquent_since ?? new Date().toISOString())
      : null,
    // Bare skriv når vi faktisk vet noe. Kunden er ikke alltid ekspandert, og
    // «hele tilstanden skrives hver gang» skal ikke bety at et manglende
    // ekspanderingsfelt nuller ut et land vi allerede har lagret.
    ...(currency ? { currency } : {}),
    ...(country ? { billing_country: country } : {}),
    ...(kind ? { customer_kind: kind } : {}),
  });

  const projectId = subscription.metadata?.snoat_project_id;
  if (projectId) {
    const { error: projError } = await supabase
      .from("projects")
      .update({ plan: effectivePlan })
      .eq("id", projectId);
    if (projError) {
      logger.error({ projectId, plan: effectivePlan, err: projError }, "Kunne ikke oppdatere prosjektplan");
    } else {
      logger.info({ projectId, plan: effectivePlan }, "Prosjektplan oppdatert fra Stripe-webhook");
    }
  }

  logger.info(
    { userId, projectId, plan: effectivePlan, status, subscription: subscription.id },
    "Abonnement synkronisert fra Stripe",
  );
}

/** Nedgraderer til gratisplanen. Brukes når abonnementet er slettet hos Stripe. */
export async function downgradeToFree(subscription: Stripe.Subscription): Promise<void> {
  const userId = await userIdForSubscription(subscription);
  if (!userId) return;

  // `currency` og `billing_country` røres ikke. Stripe låser valutaen til
  // *kunden*, ikke til abonnementet, så den gjelder fortsatt om kunden tegner
  // et nytt abonnement senere. Nullet vi den her, ville hen fått tilbudt euro
  // etter å ha sagt opp et kroneabonnement, og checkout ville feilet.
  await write(userId, {
    plan: "free",
    status: "canceled",
    stripe_subscription_id: null,
    current_period_end: periodEnd(subscription),
    cancel_at_period_end: false,
    delinquent_since: null,
  });

  const projectId = subscription.metadata?.snoat_project_id;
  if (projectId) {
    await supabase.from("projects").update({ plan: "free" }).eq("id", projectId);
  }

  logger.info({ userId, projectId, subscription: subscription.id }, "Abonnement avsluttet – nedgradert til Free");
}

/** Felles skriving, slik at `updated_at` aldri glemmes. */
async function write(userId: string, fields: Partial<Subscription>): Promise<void> {
  const { error } = await supabase
    .from("subscriptions")
    .upsert(
      { user_id: userId, ...fields, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

  if (error) {
    // Kastes videre slik at webhooken svarer 500 og Stripe prøver igjen. Å svare
    // 200 på et event vi ikke klarte å lagre er den ene feilen som gir varig
    // avvik mellom Stripe og oss.
    throw new Error(`Kunne ikke lagre abonnementet for ${userId}: ${error.message}`);
  }
}

/**
 * Stripe-kunden for en Snoat-bruker, opprettet ved behov.
 *
 * ID-en lagres med én gang, slik at et avbrutt kjøp ikke etterlater en løs kunde
 * i Stripe som vi lager en ny av neste gang. `snoat_user_id` i metadata gjør at
 * vi finner tilbake til brukeren fra Stripe-dashboardet.
 */
export async function ensureCustomer(userId: string, email: string | undefined): Promise<string> {
  const existing = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle()
    .then(({ data }) => (data as { stripe_customer_id: string | null } | null)?.stripe_customer_id);

  if (existing) return existing;

  const customer = await stripe().customers.create(
    {
      email,
      metadata: { snoat_user_id: userId },
    },
    // Nøkkelen er stabil per bruker med vilje. Feiler kallet etter at Stripe har
    // opprettet kunden – et nettverksbrudd på svaret er nok – ville et nytt
    // forsøk ellers laget kunde nummer to, og da har brukeren to abonnementer
    // hos Stripe og vi kjenner bare det ene.
    { idempotencyKey: `customer:${userId}` },
  );

  await write(userId, { stripe_customer_id: customer.id });

  return customer.id;
}

/**
 * Registrerer at eventet er behandlet. Returnerer `false` hvis det var det fra før.
 *
 * Innsettingen *er* låsen: primærnøkkelen er Stripe sin event-id, så to samtidige
 * leveringer av samme event kan ikke begge vinne. Stripe leverer «at least once»,
 * og gjentakelser er normalt – ikke et symptom på noe galt.
 */
export async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const { error } = await supabase
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });

  if (!error) return true;

  // 23505 = unique_violation: eventet er behandlet før.
  if (error.code === "23505") return false;

  throw new Error(`Kunne ikke registrere Stripe-eventet: ${error.message}`);
}

/**
 * Frigir et event som ble hentet ut av `claimEvent()`, men ikke behandlet.
 *
 * Uten dette blir låsen en felle: vi tar eventet, behandlingen feiler, vi svarer
 * 500 – og når Stripe prøver på nytt, ser låsen at eventet er «behandlet» og
 * hopper over det. Betalingen ville da aldri blitt registrert, og retry-en fra
 * Stripe hadde vært helt uten effekt.
 */
export async function releaseEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from("stripe_events").delete().eq("id", eventId);

  if (error) {
    logger.error({ event: eventId, err: error }, "Kunne ikke frigi Stripe-eventet for ny levering");
  }
}
