import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/**
 * Tall-, dato- og valutaformatering som følger visningsspråket.
 *
 * Før dette lå `new Intl.NumberFormat("nb-NO", { currency: "NOK" })` og
 * `toLocaleString("nb-NO")` spredt utover komponentene. En engelsk bruker fikk
 * altså norsk formatering: «1 234,56» og «7. august 2026». Det er ikke bare
 * stygt – «08.07.2026» leses som 8. juli av en amerikaner og 7. august av en
 * nordmann, og en dato for når abonnementet faller bort skal ikke være tvetydig.
 *
 * ⚠️ **Valutaen kommer fra data, ikke fra språket.** Den sendes inn per kall,
 * fordi den er en egenskap ved beløpet og ikke ved leseren: en kunde med et
 * kroneabonnement skal se kroner selv om hen leser engelsk. Locale styrer
 * *hvordan* tallet skrives, `currency` styrer *hva* som skrives.
 */

/** Lokalet et i18next-språk skal formateres med. */
export function localeForLanguage(language: string | null | undefined): string {
  const lang = (language ?? "").trim();
  if (/^(no|nb|nn)\b/i.test(lang)) return "nb-NO";

  // en-IE og ikke en-US: engelsk med europeisk datoformat og euro. En kunde i
  // Berlin som leser engelsk skal ha «7 August 2026», ikke «August 7, 2026».
  if (/^en\b/i.test(lang)) return "en-IE";

  // Ukjent språk formateres etter seg selv hvis Intl kjenner det. Slår det feil,
  // faller vi tilbake på en-IE i `safeLocale()` under.
  return lang || "en-IE";
}

/**
 * Lokalet, men garantert godtatt av `Intl`.
 *
 * i18next kan stå med hva som helst i `language` – en lagret verdi fra
 * localStorage, en rar `navigator.language`. `Intl` kaster `RangeError` på
 * ugyldige tagger, og en formateringsfeil skal ikke ta ned betalingssiden.
 */
function safeLocale(locale: string): string {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale])[0] ?? "en-IE";
  } catch {
    return "en-IE";
  }
}

export interface Formatters {
  /** Locale-taggen som brukes. Nyttig for `Intl` direkte i en komponent. */
  locale: string;
  /**
   * Et beløp i **minste enhet** (øre, cent) skrevet som penger.
   *
   * Minste enhet hele veien fra `PLAN_PRICES` i backend: heltall i øre kan
   * legges sammen uten avrundingsfeil, `1.99` kan ikke.
   */
  money: (minorUnits: number, currency: string) => string;
  /** ISO-dato skrevet langt: «7. august 2026». Tom streng for null. */
  date: (value: string | null | undefined) => string;
  /** Dato og klokkeslett, for deployment-lister. */
  dateTime: (value: string | null | undefined) => string;
  /** Et vanlig tall med tusenskille. */
  number: (value: number) => string;
}

export function useFormatters(): Formatters {
  const { i18n } = useTranslation();

  // i18n.language endres når brukeren bytter språk, så memoen felles og
  // formatterne bygges på nytt. `Intl`-objekter er dyre nok til at det er verdt
  // å ikke lage dem per rad i en tabell.
  return useMemo(() => build(localeForLanguage(i18n.language)), [i18n.language]);
}

/** Formattere uten React, for kall utenfor komponenter. */
export function formattersFor(language: string | null | undefined): Formatters {
  return build(localeForLanguage(language));
}

function build(requested: string): Formatters {
  const locale = safeLocale(requested);

  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const dateTimeFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  });

  const numberFormat = new Intl.NumberFormat(locale);

  // Én formatter per valuta, bygget ved behov. Katalogen viser bare én valuta om
  // gangen, men en kunde med låst valuta kan se en annen enn den språket tilsier.
  const money = new Map<string, Intl.NumberFormat>();

  return {
    locale,

    money(minorUnits, currency) {
      const key = currency.toUpperCase();
      let formatter = money.get(key);

      if (!formatter) {
        formatter = new Intl.NumberFormat(locale, {
          style: "currency",
          currency: key,
          // Priser er runde tall i begge markeder (199 kr, 19 €), så desimalene
          // ville bare vært støy. Beløp fra Stripe med ører vises avrundet – det
          // er kvitteringen fra Stripe som er fasit på kronen, ikke denne siden.
          maximumFractionDigits: 0,
        });
        money.set(key, formatter);
      }

      return formatter.format(minorUnits / 100);
    },

    date: (value) => (value ? dateFormat.format(new Date(value)) : ""),
    dateTime: (value) => (value ? dateTimeFormat.format(new Date(value)) : ""),
    number: (value) => numberFormat.format(value),
  };
}
