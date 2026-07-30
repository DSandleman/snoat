import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  // i18next-browser-languagedetector can sometimes return 'en-US' or 'nb-NO'
  const isNorwegian =
    i18n.language?.startsWith("no") ||
    i18n.language?.startsWith("nb") ||
    i18n.language?.startsWith("nn");

  return (
    <div className="flex items-center">
      {isNorwegian ? (
        <button
          onClick={() => changeLanguage("en")}
          className="flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
          title="Switch to English"
        >
          <img
            src="/flag-en.png"
            alt="British flag"
            className="h-5 w-auto object-cover"
          />
        </button>
      ) : (
        <button
          onClick={() => changeLanguage("no")}
          className="flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
          title="Bytt til Norsk"
        >
          <img
            src="/flag-no.png"
            alt="Norsk flagg"
            className="h-5 w-auto object-cover"
          />
        </button>
      )}
    </div>
  );
}
