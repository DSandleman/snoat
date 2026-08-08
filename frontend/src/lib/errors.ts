import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ApiError } from "./api";

/**
 * Oversetter en feil fra backend til noe kunden kan lese på sitt eget språk.
 *
 * Backend sender to ting: en norsk `message` for loggen, og en `code` for oss.
 * Koden slås opp i `errors`-seksjonen av oversettelsene, med `params`
 * interpolert inn – slik at «Du har brukt 100 av 100 byggeminutter» blir «You
 * have used 100 of 100 build minutes» uten at backend trenger å vite hvilket
 * språk den som trykket på knappen leser.
 *
 * ⚠️ **Faller tilbake på den norske meldingen når koden mangler.** Det er ikke
 * pent, men det er riktig: bare feil som er ment for kunden har kode. En
 * byggefeil fra Nixpacks er diagnostikk blandet med verktøy-output, og en
 * halvoversatt versjon av den ville vært verre enn originalen. Feil uten kode
 * skal legges til `errors` i oversettelsene først når de faktisk vises til noen.
 */
export function translateApiError(t: TFunction, error: unknown): string {
  if (error instanceof ApiError && error.code) {
    // `defaultValue` gjør at en kode vi ikke har oversatt ennå viser
    // backend-teksten i stedet for selve nøkkelen. En bruker som ser
    // «plan.apps_limit_reached» har fått en dårligere feilmelding enn ingen.
    return t(`errors.${error.code}`, { ...error.params, defaultValue: error.message });
  }

  if (error instanceof Error) return error.message;

  return t("errors.unknown");
}

/** `translateApiError` bundet til gjeldende språk. */
export function useApiErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation();
  return (error: unknown) => translateApiError(t, error);
}

/**
 * Er dette en plangrense?
 *
 * 402 er valgt med vilje i backend: 409 sier «prøv igjen senere», 402 sier
 * «dette koster penger». Dashboardet viser oppgraderingsknappen på 402.
 */
export function isPlanLimit(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402;
}
