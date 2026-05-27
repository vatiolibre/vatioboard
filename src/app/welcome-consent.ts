import { t } from "../i18n.js";
import { loadJson, saveJson } from "../shared/storage.js";
import type { GpsService, GpsSnapshot, Unsubscribe } from "../types/services";

export const WELCOME_CONSENT_KEY = "vatioboard.welcome_consent.v1";
export const WELCOME_CONSENT_VERSION = 1;

export type WelcomeLocationChoice = "enabled" | "skipped" | "not-requested";

export type WelcomeConsentRecord = {
  accepted: boolean;
  acceptedAtMs: number | null;
  locationChoice: WelcomeLocationChoice;
  version: number;
};

export type WelcomeLocationRequestResult = {
  ok: boolean;
  status: string;
  error?: unknown;
};

type WelcomeGpsService = Pick<GpsService, "startConsumer" | "subscribe">;

type WelcomeLocationRequestOptions = {
  gpsService?: WelcomeGpsService | null;
  timeoutMs?: number;
};

type ShowWelcomeConsentOptions = {
  gpsService?: WelcomeGpsService | null;
  mount?: HTMLElement;
  requestLocation?: (options: { gpsService: WelcomeGpsService | null }) => Promise<WelcomeLocationRequestResult>;
};

type AttributeMap = Record<string, string | number | boolean | null | undefined>;
type ChildNodeLike = Node | string | null | undefined;

const LOCATION_CHOICES = new Set<WelcomeLocationChoice>(["enabled", "skipped", "not-requested"]);
const TEMP_LOCATION_CONSUMER_ID = "welcome-consent-location";
const DEFAULT_LOCATION_TIMEOUT_MS = 12000;

let activeWelcomePromise: Promise<WelcomeConsentRecord> | null = null;
let sessionConsentRecord: WelcomeConsentRecord | null = null;
let idCounter = 0;

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: AttributeMap = {},
  children: ChildNodeLike[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === "className") {
      el.className = String(value);
    } else if (key === "textContent") {
      el.textContent = String(value);
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (typeof child === "string") el.append(document.createTextNode(child));
    else if (child) el.append(child);
  }
  return el;
}

function normalizeLocationChoice(value: unknown): WelcomeLocationChoice {
  return typeof value === "string" && LOCATION_CHOICES.has(value as WelcomeLocationChoice)
    ? (value as WelcomeLocationChoice)
    : "not-requested";
}

function normalizeConsentRecord(value: unknown): WelcomeConsentRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    accepted: record.accepted === true,
    acceptedAtMs: Number.isFinite(Number(record.acceptedAtMs)) ? Number(record.acceptedAtMs) : null,
    locationChoice: normalizeLocationChoice(record.locationChoice),
    version: Number(record.version) || WELCOME_CONSENT_VERSION,
  };
}

function getFocusableElements(container: Element): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => {
    const control = el as HTMLElement & { disabled?: boolean };
    return !control.disabled && !el.hidden && el.getAttribute("aria-hidden") !== "true";
  });
}

function trapFocus(container: Element, event: KeyboardEvent): void {
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

function createConsentRecord(locationChoice: unknown): WelcomeConsentRecord {
  return {
    accepted: true,
    acceptedAtMs: Date.now(),
    locationChoice: normalizeLocationChoice(locationChoice),
    version: WELCOME_CONSENT_VERSION,
  };
}

function persistConsentRecord(record: WelcomeConsentRecord): WelcomeConsentRecord {
  sessionConsentRecord = record;
  saveJson(WELCOME_CONSENT_KEY, record);
  return record;
}

function getEventTimestampMs(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFreshGpsSuccess(snapshot: GpsSnapshot | null | undefined, startedAtMs: number): boolean {
  const callbackAtMs = getEventTimestampMs(
    snapshot?.lastCallbackAtMs
      ?? snapshot?.normalized?.lastCallbackAtMs
      ?? snapshot?.normalized?.receivedAtMs
      ?? snapshot?.normalized?.timestampMs,
  );
  return snapshot?.status === "active" && callbackAtMs !== null && callbackAtMs >= startedAtMs;
}

function isFreshGpsError(snapshot: GpsSnapshot | null | undefined, startedAtMs: number): boolean {
  const errorAtMs = getEventTimestampMs(snapshot?.lastError?.receivedAtMs);
  return errorAtMs !== null && errorAtMs >= startedAtMs;
}

export function getWelcomeConsent(): WelcomeConsentRecord | null {
  if (sessionConsentRecord) return sessionConsentRecord;
  return normalizeConsentRecord(loadJson(WELCOME_CONSENT_KEY, null));
}

export function hasAcceptedWelcomeConsent(): boolean {
  return getWelcomeConsent()?.accepted === true;
}

export function shouldDeferWelcomeLocationRequest(): boolean {
  const consent = getWelcomeConsent();
  return consent?.accepted === true && consent.locationChoice !== "enabled";
}

export function markWelcomeLocationChoice(locationChoice: unknown): WelcomeConsentRecord | null {
  const existing = getWelcomeConsent();
  if (!existing?.accepted) return null;
  return persistConsentRecord({
    ...existing,
    locationChoice: normalizeLocationChoice(locationChoice),
    version: WELCOME_CONSENT_VERSION,
  });
}

export function saveWelcomeConsent(locationChoice: unknown = "not-requested"): WelcomeConsentRecord {
  return persistConsentRecord(createConsentRecord(locationChoice));
}

export function requestWelcomeLocationFeatures({
  gpsService = null,
  timeoutMs = DEFAULT_LOCATION_TIMEOUT_MS,
}: WelcomeLocationRequestOptions = {}): Promise<WelcomeLocationRequestResult> {
  const startedAtMs = Date.now();

  if (gpsService?.startConsumer && gpsService?.subscribe) {
    return new Promise((resolve) => {
      let settled = false;
      let cleanupConsumer: Unsubscribe | null = null;
      let unsubscribe: Unsubscribe | null = null;
      let unsubscribeAfterAssign = false;
      const timerId = window.setTimeout?.(() => {
        finish({ ok: false, status: "timeout" });
      }, timeoutMs);

      function cleanup(): void {
        if (timerId) window.clearTimeout?.(timerId);
        try {
          cleanupConsumer?.();
        } catch {
          // Best effort cleanup only.
        }
        if (unsubscribe) unsubscribe();
        else unsubscribeAfterAssign = true;
      }

      function finish(result: WelcomeLocationRequestResult): void {
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
}: ShowWelcomeConsentOptions = {}): Promise<WelcomeConsentRecord> {
  const existing = getWelcomeConsent();
  if (existing?.accepted) return Promise.resolve(existing);
  if (activeWelcomePromise) return activeWelcomePromise;

  activeWelcomePromise = new Promise((resolve) => {
    const triggerElement = document.activeElement as (Element & { focus?: () => void }) | null;
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

    function setActionsEnabled(enabled: boolean): void {
      skipButton.disabled = !enabled;
      enableButton.disabled = !enabled;
    }

    function dismiss(record: WelcomeConsentRecord): void {
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

    function accept(locationChoice: WelcomeLocationChoice): void {
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

export function resetWelcomeConsentForTests(): void {
  activeWelcomePromise = null;
  sessionConsentRecord = null;
}
