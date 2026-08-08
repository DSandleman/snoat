import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type Stripe from "stripe";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { constructEvent, isStripeConfigured, stripe } from "../lib/stripe.js";
import { claimEvent, downgradeToFree, releaseEvent, syncSubscription } from "../services/billing.js";

/**
 * Webhook-mottak fra Stripe: abonnement opprettet, fornyet, feilet eller avsluttet.
 *
 * Endepunktet er **offentlig**. Det ligger under `/api/webhooks`, men utenfor
 * `requireAuth` – Stripe har ingen Supabase-sesjon. Tilliten hviler på
 * signaturen i `stripe-signature`, verifisert mot `STRIPE_WEBHOOK_SECRET`.
 * Rekkefølgen på monteringen i `index.ts` er det som gjør det mulig; se
 * kommentaren der.
 *
 * ⚠️ **Én forskjell fra GitHub-webhooken:** uten secret svarer vi 503 og avviser
 * alt. GitHub-varianten tar imot uverifisert med en advarsel i loggen, fordi det
 * verste som skjer er et uønsket bygg. Her er det verste at hvem som helst kan
 * POST-e seg til Business-planen. Fail closed er eneste forsvarlige valg.
 */
export const stripeWebhooks = new Hono();

/** Stripe-payloader er små. Taket er der fordi ruten er åpen for alle. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Abonnementet en faktura gjelder.
 *
 * ⚠️ `invoice.subscription` finnes ikke lenger på Invoice-objektet i API-versjonen
 * SDK-en vår bruker – det ligger under `parent.subscription_details`. Den gamle
 * plasseringen gir ingen typefeil hvis man caster, bare `undefined`, og da ville
 * hver eneste feilede betaling blitt stille ignorert.
 */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

/**
 * Henter abonnementet ferskt fra Stripe og skriver hele tilstanden.
 *
 * Faktura-eventene sier «noe skjedde med betalingen», men det er abonnementet
 * som vet hva tilstanden ble. Å utlede status fra selve faktura-eventet ville
 * gjettet – `payment_failed` betyr ikke nødvendigvis `past_due`, det kan være
 * første av flere forsøk.
 *
 * `expand` på produktet gjør at `planForSubscription()` finner `snoat_plan` i
 * produkt-metadata, ikke bare i price-metadata.
 *
 * `customer` og `customer.tax_ids` er ekspandert av samme grunn: adressen og
 * mva-nummeret ligger på **kunden**, ikke på abonnementet, og uten dem blir
 * `billing_country` og `customer_kind` stille stående som NULL. Ingen feil,
 * ingen advarsel – bare et dashboard som ikke vet hvilket land kunden hører
 * til, og en katalog som viser feil valuta neste gang hen logger inn.
 */
async function syncById(subscriptionId: string): Promise<void> {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product", "customer", "customer.tax_ids"],
  });
  await syncSubscription(subscription);
}

stripeWebhooks.post(
  "/stripe",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "Payloaden er for stor" }, 413),
  }),
  async (c) => {
    const log = logger.child({ webhook: "stripe" });

    if (!isStripeConfigured() || !config.STRIPE_WEBHOOK_SECRET) {
      log.warn("Webhook mottatt, men Stripe er ikke konfigurert");
      return c.json({ error: "Betaling er ikke konfigurert" }, 503);
    }

    const signature = c.req.header("stripe-signature");
    if (!signature) {
      return c.json({ error: "Mangler stripe-signature" }, 401);
    }

    // Råkroppen, ordrett. Signaturen er regnet over nøyaktig disse bytene, så
    // en tur innom JSON.parse og tilbake ville brutt den.
    const body = await c.req.text();

    let event: Stripe.Event;
    try {
      event = await constructEvent(body, signature);
    } catch (error) {
      log.warn({ err: error }, "Avviste webhook: signaturen stemmer ikke");
      return c.json({ error: "Ugyldig signatur" }, 401);
    }

    // Stripe leverer «at least once». Uten denne låsen kunne en gjentatt
    // `customer.subscription.deleted` nedgradert en kunde som allerede hadde
    // abonnert på nytt.
    try {
      if (!(await claimEvent(event))) {
        log.info({ event: event.id, type: event.type }, "Event behandlet fra før – hoppet over");
        return c.json({ received: true, duplicate: true });
      }
    } catch (error) {
      log.error({ err: error, event: event.id }, "Kunne ikke registrere eventet");
      return c.json({ error: "Kunne ikke registrere eventet" }, 500);
    }

    try {
      switch (event.type) {
        // Kilden til sannhet for planen. Alle tre skriver hele tilstanden fra
        // objektet, slik at rekkefølgen på leveringene ikke betyr noe.
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.paused":
        case "customer.subscription.resumed":
          await syncById(event.data.object.id);
          break;

        case "customer.subscription.deleted":
          await downgradeToFree(event.data.object);
          break;

        // Kjøpet er fullført. Abonnementet finnes allerede – dette er
        // beltet-og-bukseselene for tilfellet der `subscription.created` skulle
        // kommet fram, men ikke gjorde det.
        case "checkout.session.completed": {
          const session = event.data.object;
          const subscription =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id;

          if (subscription) await syncById(subscription);
          break;
        }

        // Betalingen gikk gjennom eller feilet: hent abonnementet og les statusen
        // derfra i stedet for å gjette ut fra fakturaen.
        case "invoice.payment_succeeded":
        case "invoice.payment_failed": {
          const subscription = subscriptionIdFromInvoice(event.data.object);
          if (subscription) await syncById(subscription);
          break;
        }

        default:
          // Endepunktet abonnerer på et utvalg events, men Stripe kan sende
          // flere. Det er ikke en feil – de er bare ikke vårt bord.
          log.debug({ type: event.type }, "Ignorerer event");
          return c.json({ received: true, ignored: true });
      }
    } catch (error) {
      // Låsen må frigis før vi ber Stripe prøve igjen. Ellers ville retry-en
      // sett eventet som allerede behandlet og hoppet over det – og da hadde
      // 500-svaret vårt vært en garanti for at det *aldri* ble behandlet.
      await releaseEvent(event.id);

      // 500 får Stripe til å prøve igjen. Å svare 200 på noe vi ikke klarte å
      // lagre er den ene feilen som gir varig avvik mellom Stripe og oss – og
      // den oppdages først når en kunde klager på feil plan.
      log.error({ err: error, event: event.id, type: event.type }, "Kunne ikke behandle Stripe-eventet");
      return c.json({ error: "Kunne ikke behandle eventet" }, 500);
    }

    log.info({ event: event.id, type: event.type }, "Stripe-event behandlet");
    return c.json({ received: true });
  },
);
