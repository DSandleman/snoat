import { useTranslation } from "react-i18next";

/**
 * Marked: valutaen og avgiftsregimet kunden ser priser i.
 *
 * Speiler `backend/src/services/markets.ts`. Backend er fasit – det er den som
 * bestemmer hva som faktisk trekkes – men frontend må kunne utlede *ønsket*
 * marked lokalt for å sende det med i forespørselen.
 *
 * ⚠️ **Marked er ikke det samme som språk**, selv om språket velger det her.
 * Språk er en preferanse brukeren bytter når som helst. Marked er en
 * faktureringsfakta som låses ved første kjøp: Stripe knytter valutaen til
 * kunden, ikke til abonnementet. Derfor kan `/api/billing` svare med et annet
 * marked enn det vi ba om, og da er det svaret som gjelder – se `marketLocked`.
 */
export type MarketId = "no" | "eu";

/**
 * Norsk visning betyr kroner; alt annet betyr euro.
 *
 * Én linje, men det er produktbeslutningen i klartekst. En engelsktalende i
 * Oslo får euro-prisen og faktureres like fullt norsk mva – Stripe Tax går på
 * adressen i kassen, ikke på valutaen.
 */
export function marketForLanguage(language: string | null | undefined): MarketId {
  return /^(no|nb|nn)\b/i.test((language ?? "").trim()) ? "no" : "eu";
}

/** Markedet gjeldende visningsspråk tilsier. Et ønske – backend kan overstyre. */
export function useRequestedMarket(): MarketId {
  const { i18n } = useTranslation();
  return marketForLanguage(i18n.language);
}
