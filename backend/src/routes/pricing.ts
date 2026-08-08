import { Hono } from "hono";
import { planCatalogue, resolveMarket } from "../services/markets.js";

/**
 * Plankatalogen, uten innlogging.
 *
 * **Offentlig med vilje.** Landingssiden må kunne vise priser til folk som ikke
 * har konto, og prisene sto tidligere som ferdige strenger i
 * oversettelsesfilene («199 kr / mnd»). Det fusjonerte tre ting i én
 * verdi – tall, valuta og språk – slik at en prisendring ble en
 * oversettelsesoppgave, og en ny valuta var umulig uten å duplisere hele
 * prisseksjonen. Nå kommer tallene fra samme funksjon som dashboardet bruker,
 * og oversettelsene inneholder bare formatet rundt dem.
 *
 * Monteres utenfor `requireAuth`, altså **før** `app.route("/api", api)` i
 * `index.ts` – samme mekanikk som webhookene. Flyttes linjen under, begynner
 * landingssiden å få 401 og prisseksjonen blir stående tom.
 *
 * Ingenting her er hemmelig: det er den samme prislisten som står på nettsiden.
 */
export const pricing = new Hono();

pricing.get("/", (c) => {
  // Ingen `subscription` her – endepunktet er uinnlogget og vet ikke hvem som
  // spør. En innlogget kunde med låst valuta må hente `/api/billing`, som tar
  // hensyn til det.
  const { market } = resolveMarket({
    requested: c.req.query("market"),
    acceptLanguage: c.req.header("accept-language"),
  });

  return c.json({ market, plans: planCatalogue(market.id) });
});
