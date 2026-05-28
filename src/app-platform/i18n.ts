import {
  applyTranslations,
  getLang,
  t,
  toggleLang,
} from "../i18n.js";
import type { VatioAppI18n } from "./types";

const I18N_CHANGE_EVENT = "i18n:change";

function applyTranslationsWithin(root: ParentNode) {
  root.querySelectorAll?.("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    element.textContent = t(key || "");
  });

  root.querySelectorAll?.("[data-i18n-aria]").forEach((element) => {
    const key = element.getAttribute("data-i18n-aria");
    element.setAttribute("aria-label", t(key || ""));
  });

  root.querySelectorAll?.("[data-i18n-title]").forEach((element) => {
    const key = element.getAttribute("data-i18n-title");
    element.setAttribute("title", t(key || ""));
  });

  root.querySelectorAll?.("[data-i18n-placeholder]").forEach((element) => {
    const key = element.getAttribute("data-i18n-placeholder");
    element.setAttribute("placeholder", t(key || ""));
  });
}

export function createAppI18n(): VatioAppI18n {
  return {
    getLanguage() {
      return getLang();
    },
    t(key, fallback) {
      const translated = t(key);
      return translated === key && fallback !== undefined ? fallback : translated;
    },
    apply(root) {
      if (root) {
        applyTranslationsWithin(root);
        return;
      }
      applyTranslations();
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      const handleChange = (event: Event) => {
        const detail = (event as CustomEvent<{ lang?: string }>).detail;
        listener(detail?.lang || getLang());
      };
      document.addEventListener(I18N_CHANGE_EVENT, handleChange);
      return () => {
        document.removeEventListener(I18N_CHANGE_EVENT, handleChange);
      };
    },
    toggleLanguage() {
      return toggleLang();
    },
  };
}
