import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enTranslation from "../locales/en/translation.json";
import noTranslation from "../locales/no/translation.json";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslation,
      },
      no: {
        translation: noTranslation,
      },
      nb: {
        translation: noTranslation,
      },
      nn: {
        translation: noTranslation,
      },
    },
    lng: "en",
    fallbackLng: "en",
    debug: false,
    interpolation: {
      escapeValue: false, // React already escapes by default
    },
  });

export default i18n;
