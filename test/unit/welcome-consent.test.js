import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowserMocks } from "../helpers/browser-mocks.js";
import { flushTasks } from "../helpers/page-smoke.js";
import {
  resetWelcomeConsentForTests,
  showWelcomeConsentIfNeeded,
  WELCOME_CONSENT_KEY,
} from "../../src/app/welcome-consent.js";

function getDialog() {
  return document.querySelector(".vb-welcome-backdrop [role='dialog']");
}

function getCheckbox() {
  return document.querySelector(".vb-welcome-checkbox-input");
}

function getSkipButton() {
  return document.querySelector(".vb-welcome-skip");
}

function getEnableButton() {
  return document.querySelector(".vb-welcome-enable");
}

function checkAcknowledgement() {
  const checkbox = getCheckbox();
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("welcome consent", () => {
  beforeEach(() => {
    resetWelcomeConsentForTests();
    localStorage.removeItem(WELCOME_CONSENT_KEY);
  });

  afterEach(() => {
    resetWelcomeConsentForTests();
    vi.restoreAllMocks();
  });

  it("shows when no consent is stored", async () => {
    const promise = showWelcomeConsentIfNeeded();

    expect(getDialog()).toBeTruthy();
    expect(getDialog()?.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector(".vb-welcome-logo source[srcset='/img/vb_logo_dark.svg']")).toBeTruthy();
    expect(document.querySelector(".vb-welcome-logo source[srcset='/img/vb_logo_light.svg']")).toBeTruthy();
    expect(document.querySelector(".vb-welcome-logo img")?.getAttribute("src")).toBe(
      "/img/vb_logo_light.svg",
    );
    expect(getSkipButton().disabled).toBe(true);
    expect(getEnableButton().disabled).toBe(true);

    checkAcknowledgement();
    getSkipButton().click();
    await expect(promise).resolves.toMatchObject({
      accepted: true,
      locationChoice: "skipped",
    });
  });

  it("does not show when accepted consent is stored", async () => {
    localStorage.setItem(
      WELCOME_CONSENT_KEY,
      JSON.stringify({
        accepted: true,
        acceptedAtMs: Date.now(),
        locationChoice: "enabled",
        version: 1,
      }),
    );

    await expect(showWelcomeConsentIfNeeded()).resolves.toMatchObject({
      accepted: true,
      locationChoice: "enabled",
    });
    expect(getDialog()).toBeNull();
  });

  it("keeps action buttons disabled until the checkbox is checked", () => {
    void showWelcomeConsentIfNeeded();

    expect(getSkipButton().disabled).toBe(true);
    expect(getEnableButton().disabled).toBe(true);

    checkAcknowledgement();

    expect(getSkipButton().disabled).toBe(false);
    expect(getEnableButton().disabled).toBe(false);
  });

  it("continues without location, stores acceptance, and does not call geolocation", async () => {
    const gpsService = {
      startConsumer: vi.fn(() => vi.fn()),
      subscribe: vi.fn(() => vi.fn()),
    };
    const nativeWatchPosition = getBrowserMocks().geolocation.watchPosition;
    const promise = showWelcomeConsentIfNeeded({ gpsService });

    checkAcknowledgement();
    getSkipButton().click();
    const result = await promise;
    const stored = JSON.parse(localStorage.getItem(WELCOME_CONSENT_KEY));

    expect(result).toMatchObject({ accepted: true, locationChoice: "skipped" });
    expect(stored).toMatchObject({ accepted: true, locationChoice: "skipped", version: 1 });
    expect(gpsService.startConsumer).not.toHaveBeenCalled();
    expect(nativeWatchPosition).not.toHaveBeenCalled();
  });

  it("requests location only after the enable-location click", async () => {
    const listeners = [];
    const stopConsumer = vi.fn();
    const unsubscribe = vi.fn();
    const gpsService = {
      startConsumer: vi.fn(() => stopConsumer),
      subscribe: vi.fn((listener) => {
        listeners.push(listener);
        return unsubscribe;
      }),
    };
    const promise = showWelcomeConsentIfNeeded({ gpsService });

    expect(gpsService.startConsumer).not.toHaveBeenCalled();

    checkAcknowledgement();
    getEnableButton().click();
    await promise;

    expect(gpsService.startConsumer).toHaveBeenCalledWith(
      "welcome-consent-location",
      expect.objectContaining({
        enableHighAccuracy: true,
        reason: "welcome-consent",
      }),
    );
    expect(JSON.parse(localStorage.getItem(WELCOME_CONSENT_KEY))).toMatchObject({
      accepted: true,
      locationChoice: "enabled",
    });

    listeners[0]?.({
      status: "active",
      lastCallbackAtMs: Date.now(),
      normalized: { receivedAtMs: Date.now() },
    });
    await flushTasks();

    expect(stopConsumer).toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("handles localStorage errors gracefully", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const promise = showWelcomeConsentIfNeeded();
    expect(getDialog()).toBeTruthy();

    checkAcknowledgement();
    getSkipButton().click();

    await expect(promise).resolves.toMatchObject({
      accepted: true,
      locationChoice: "skipped",
    });
    expect(getDialog()).toBeNull();
  });
});
