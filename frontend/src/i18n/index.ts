/**
 * i18n scaffolding (ADR 013). v1 ships English only; Tamil and Hindi resource files
 * exist so translators can fill them without code changes. Missing keys fall back to
 * English. Never build sentences by concatenating translated fragments: use one key
 * with {{placeholders}} so word order can change per language.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en/common.json";
import hi from "./locales/hi/common.json";
import ta from "./locales/ta/common.json";

export const SUPPORTED_LANGUAGES = ["en"] as const; // add "ta", "hi" once translated
export const SCAFFOLDED_LANGUAGES = ["en", "ta", "hi"] as const;

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: en },
    ta: { common: ta },
    hi: { common: hi },
  },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: { escapeValue: false }, // React already escapes output
});

export default i18n;
