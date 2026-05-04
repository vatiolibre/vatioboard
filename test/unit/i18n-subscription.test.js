import { describe, expect, it } from "vitest";

import { setLang, t } from "../../src/i18n.js";

describe("subscription i18n", () => {
  it("translates the save activation CTA in English and Spanish", () => {
    setLang("en");
    expect(t("saveActivateSubscription")).toBe("Activate subscription");

    setLang("es");
    expect(t("saveActivateSubscription")).toBe("Activar suscripción");

    setLang("en");
  });
});
