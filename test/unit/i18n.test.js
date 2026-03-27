import { beforeEach, describe, expect, it, vi } from "vitest";

describe("shared i18n", () => {
  let i18n;

  beforeEach(async () => {
    localStorage.clear();
    window.__lang = "en";
    document.body.innerHTML = `
      <button data-i18n="calculator"></button>
      <button data-i18n-aria="changeLanguage"></button>
      <button data-i18n-title="foundingSummary"></button>
      <input data-i18n-placeholder="accelNotesPlaceholder" />
    `;
    vi.resetModules();
    i18n = await import("../../src/i18n.js");
  });

  it("applies shared translations to text, aria, title, and placeholder nodes", () => {
    i18n.applyTranslations();

    expect(document.querySelector('[data-i18n="calculator"]').textContent).toBe("Calculator");
    expect(document.querySelector("[data-i18n-aria]").getAttribute("aria-label")).toBe("Change language");
    expect(document.querySelector("[data-i18n-title]").getAttribute("title")).toContain("VatioLibre");
    expect(document.querySelector("[data-i18n-placeholder]").getAttribute("placeholder")).toBe("Example: 90% SOC, flat road");
  });

  it("supports parameter interpolation and accel-specific translations without overwriting shared keys", () => {
    i18n.setLang("es");

    expect(i18n.t("speedometer")).toBe("Velocímetro");
    expect(i18n.t("accelSpeedometer")).toBe("Velocimetro");
    expect(i18n.t("accelOpenBoard")).toBe("Abrir tablero");
    expect(i18n.t("accelFasterBy", { value: "0,5 s" })).toBe("0,5 s mas rapida que la mejor guardada");
  });

  it("toggles language and persists the shared language key", () => {
    expect(i18n.getLang()).toBe("en");

    const next = i18n.toggleLang();

    expect(next).toBe("es");
    expect(localStorage.getItem("vatio_board_lang")).toBe("es");
    expect(document.documentElement.lang).toBe("es");
  });
});
