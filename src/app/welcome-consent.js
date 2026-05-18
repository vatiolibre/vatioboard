import { t } from "../i18n.js";
import { loadJson, saveJson } from "../shared/storage.js";

export const WELCOME_CONSENT_KEY = "vatioboard.welcome_consent.v1";
export const WELCOME_CONSENT_VERSION = 1;

const LOCATION_CHOICES = new Set(["enabled", "skipped", "not-requested"]);
const TEMP_LOCATION_CONSUMER_ID = "welcome-consent-location";
const DEFAULT_LOCATION_TIMEOUT_MS = 12000;

let activeWelcomePromise = null;
let sessionConsentRecord = null;
let idCounter = 0;

function createEl(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === "className") {
      el.className = value;
    } else if (key === "textContent") {
      el.textContent = value;
    } else {
      el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (typeof child === "string") el.append(document.createTextNode(child));
    else if (child) el.append(child);
  }
  return el;
}

function normalizeConsentRecord(value) {
  if (!value || typeof value !== "object") return null;
  return {
    accepted: value.accepted === true,
    acceptedAtMs: Number.isFinite(Number(value.acceptedAtMs)) ? Number(value.acceptedAtMs) : null,
    locationChoice: LOCATION_CHOICES.has(value.locationChoice) ? value.locationChoice : "not-requested",
    version: Number(value.version) || WELCOME_CONSENT_VERSION,
  };
}

function getFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.disabled && !el.hidden && el.getAttribute("aria-hidden") !== "true");
}

function trapFocus(container, event) {
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function createConsentRecord(locationChoice) {
  return {
    accepted: true,
    acceptedAtMs: Date.now(),
    locationChoice: LOCATION_CHOICES.has(locationChoice) ? locationChoice : "not-requested",
    version: WELCOME_CONSENT_VERSION,
  };
}

function persistConsentRecord(record) {
  sessionConsentRecord = record;
  saveJson(WELCOME_CONSENT_KEY, record);
  return record;
}

function getEventTimestampMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFreshGpsSuccess(snapshot, startedAtMs) {
  const callbackAtMs = getEventTimestampMs(
    snapshot?.lastCallbackAtMs
      ?? snapshot?.normalized?.lastCallbackAtMs
      ?? snapshot?.normalized?.receivedAtMs
      ?? snapshot?.normalized?.timestampMs,
  );
  return snapshot?.status === "active" && callbackAtMs !== null && callbackAtMs >= startedAtMs;
}

function isFreshGpsError(snapshot, startedAtMs) {
  const errorAtMs = getEventTimestampMs(snapshot?.lastError?.receivedAtMs);
  return errorAtMs !== null && errorAtMs >= startedAtMs;
}

export function getWelcomeConsent() {
  if (sessionConsentRecord) return sessionConsentRecord;
  return normalizeConsentRecord(loadJson(WELCOME_CONSENT_KEY, null));
}

export function hasAcceptedWelcomeConsent() {
  return getWelcomeConsent()?.accepted === true;
}

export function shouldDeferWelcomeLocationRequest() {
  const consent = getWelcomeConsent();
  return consent?.accepted === true && consent.locationChoice !== "enabled";
}

export function markWelcomeLocationChoice(locationChoice) {
  const existing = getWelcomeConsent();
  if (!existing?.accepted) return null;
  return persistConsentRecord({
    ...existing,
    locationChoice: LOCATION_CHOICES.has(locationChoice) ? locationChoice : "not-requested",
    version: WELCOME_CONSENT_VERSION,
  });
}

export function saveWelcomeConsent(locationChoice = "not-requested") {
  return persistConsentRecord(createConsentRecord(locationChoice));
}

export function requestWelcomeLocationFeatures({
  gpsService = null,
  timeoutMs = DEFAULT_LOCATION_TIMEOUT_MS,
} = {}) {
  const startedAtMs = Date.now();

  if (gpsService?.startConsumer && gpsService?.subscribe) {
    return new Promise((resolve) => {
      let settled = false;
      let cleanupConsumer = null;
      let unsubscribe = null;
      let unsubscribeAfterAssign = false;
      const timerId = window.setTimeout?.(() => {
        finish({ ok: false, status: "timeout" });
      }, timeoutMs);

      function cleanup() {
        if (timerId) window.clearTimeout?.(timerId);
        try {
          cleanupConsumer?.();
        } catch {
          // Best effort cleanup only.
        }
        if (unsubscribe) unsubscribe();
        else unsubscribeAfterAssign = true;
      }

      function finish(result) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      }

      try {
        cleanupConsumer = gpsService.startConsumer(TEMP_LOCATION_CONSUMER_ID, {
          enableHighAccuracy: true,
          reason: "welcome-consent",
        });
        unsubscribe = gpsService.subscribe((snapshot) => {
          if (settled) return;
          if (isFreshGpsSuccess(snapshot, startedAtMs)) {
            finish({ ok: true, status: "active" });
          } else if (snapshot?.status === "unsupported") {
            finish({ ok: false, status: "unsupported" });
          } else if (isFreshGpsError(snapshot, startedAtMs)) {
            finish({ ok: false, status: snapshot?.status || "error" });
          }
        });
        if (unsubscribeAfterAssign) unsubscribe?.();
      } catch (error) {
        finish({ ok: false, status: "error", error });
      }
    });
  }

  const geolocation = navigator.geolocation;
  if (!geolocation?.getCurrentPosition) {
    return Promise.resolve({ ok: false, status: "unsupported" });
  }

  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        () => resolve({ ok: true, status: "active" }),
        (error) => resolve({ ok: false, status: "error", error }),
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: timeoutMs,
        },
      );
    } catch (error) {
      resolve({ ok: false, status: "error", error });
    }
  });
}

export function showWelcomeConsentIfNeeded({
  gpsService = null,
  mount = document.body,
  requestLocation = requestWelcomeLocationFeatures,
} = {}) {
  const existing = getWelcomeConsent();
  if (existing?.accepted) return Promise.resolve(existing);
  if (activeWelcomePromise) return activeWelcomePromise;

  activeWelcomePromise = new Promise((resolve) => {
    const triggerElement = document.activeElement;
    const uniqueId = ++idCounter;
    const titleId = `vb-welcome-title-${uniqueId}`;
    const bodyId = `vb-welcome-body-${uniqueId}`;
    const checkboxId = `vb-welcome-ack-${uniqueId}`;

    const backdrop = createEl("div", {
      className: "vb-confirm-backdrop vb-welcome-backdrop",
    });
    const card = createEl("section", {
      className: "vb-confirm-card vb-welcome-card",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      "aria-describedby": bodyId,
      tabindex: "-1",
    });
    const title = createEl("h2", {
      id: titleId,
      className: "vb-confirm-title vb-welcome-title",
      textContent: t("welcomeConsentTitle"),
    });
    const logo = createEl("picture", {
      className: "vb-welcome-logo",
      "aria-hidden": "true",
    }, [
      createEl("source", {
        srcset: "/img/vb_logo_dark.svg",
        media: "(prefers-color-scheme: dark)",
      }),
      createEl("source", {
        srcset: "/img/vb_logo_light.svg",
        media: "(prefers-color-scheme: light)",
      }),
      createEl("img", {
        src: "/img/vb_logo_light.svg",
        alt: "",
        width: "757",
        height: "107",
        decoding: "async",
      }),
    ]);
    const brand = createEl("div", {
      className: "vb-welcome-brand",
    }, [logo]);
    const body = createEl("div", {
      id: bodyId,
      className: "vb-welcome-body",
    });

    for (const paragraph of t("welcomeConsentBody").split(/\n\s*\n/)) {
      body.append(createEl("p", { className: "vb-confirm-message", textContent: paragraph }));
    }

    const checkbox = createEl("input", {
      id: checkboxId,
      className: "vb-welcome-checkbox-input",
      type: "checkbox",
    });
    const checkboxLabel = createEl("label", {
      className: "vb-welcome-checkbox",
      for: checkboxId,
    }, [
      checkbox,
      createEl("span", {
        className: "vb-welcome-checkbox-text",
        textContent: t("welcomeConsentCheckbox"),
      }),
    ]);
    const skipButton = createEl("button", {
      type: "button",
      className: "vb-confirm-btn vb-confirm-btn--cancel vb-welcome-skip",
      textContent: t("welcomeConsentSkipLocation"),
      disabled: "",
    });
    const enableButton = createEl("button", {
      type: "button",
      className: "vb-confirm-btn vb-confirm-btn--confirm vb-welcome-enable",
      textContent: t("welcomeConsentEnableLocation"),
      disabled: "",
    });
    const actions = createEl("div", {
      className: "vb-confirm-actions vb-welcome-actions",
    }, [skipButton, enableButton]);

    card.append(brand, title, body, checkboxLabel, actions);
    backdrop.append(card);

    function setActionsEnabled(enabled) {
      skipButton.disabled = !enabled;
      enableButton.disabled = !enabled;
    }

    function dismiss(record) {
      backdrop.classList.add("vb-confirm-exiting");
      card.classList.add("vb-confirm-exiting");

      const cleanup = () => {
        backdrop.remove();
        activeWelcomePromise = null;
        try {
          triggerElement?.focus?.();
        } catch {
          // The trigger may no longer be focusable after boot continues.
        }
        resolve(record);
      };

      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (prefersReducedMotion) {
        cleanup();
      } else {
        backdrop.addEventListener("animationend", cleanup, { once: true });
        window.setTimeout?.(cleanup, 300);
      }
    }

    function accept(locationChoice) {
      if (!checkbox.checked) return;
      const record = saveWelcomeConsent(locationChoice);
      if (locationChoice === "enabled") {
        void requestLocation({ gpsService }).catch(() => {});
      }
      dismiss(record);
    }

    checkbox.addEventListener("change", () => setActionsEnabled(checkbox.checked));
    skipButton.addEventListener("click", () => accept("skipped"));
    enableButton.addEventListener("click", () => accept("enabled"));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        event.preventDefault();
        card.focus();
      }
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        checkbox.focus();
      } else if (event.key === "Tab") {
        trapFocus(card, event);
      }
    });

    mount.append(backdrop);
    backdrop.classList.add("vb-confirm-entering");
    card.classList.add("vb-confirm-entering");
    checkbox.focus();
  });

  return activeWelcomePromise;
}

export function resetWelcomeConsentForTests() {
  activeWelcomePromise = null;
  sessionConsentRecord = null;
}
