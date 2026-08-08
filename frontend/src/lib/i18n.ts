import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enTranslation from "../locales/en/translation.json";
import noTranslation from "../locales/no/translation.json";

/**
 * i18next-oppsettet.
 *
 * ⚠️ **Ingen `LanguageDetector` her, og det er nå et bevisst valg.**
 * `i18next-browser-languagedetector` var tidligere importert, men aldri sendt
 * inn i `.use()` – den så ut til å være i bruk uten å gjøre noe som helst.
 * Deteksjonen ligger i stedet i `routes/__root.tsx`, som kjører den *etter*
 * mount med vilje: leser vi `navigator.language` under serverrenderingen, får
 * server og klient ulikt språk, og React kaster hydration-feil på hver eneste
 * tekst på siden.
 *
 * `lng: "en"` er derfor ikke standardspråket vårt, men **det språket serveren
 * rendrer med**. Det må stemme med `fallbackLng`, ellers bytter markup-en
 * innhold i det klienten tar over.
 */
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: enTranslation },
    // Alle tre norske taggene peker på samme fil. `no` er makrospråket, `nb` og
    // `nn` er det nettlesere faktisk sender.
    no: { translation: noTranslation },
    nb: { translation: noTranslation },
    nn: { translation: noTranslation },
  },
  lng: "en",
  fallbackLng: "en",
  debug: false,
  interpolation: {
    escapeValue: false, // React already escapes by default
  },
});

export default i18n;
