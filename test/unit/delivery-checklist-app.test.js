import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import deliveryChecklistTemplate from "../../src/apps/delivery-checklist/delivery-checklist-template.js";
import { mountDeliveryChecklistRoute } from "../../src/apps/delivery-checklist/delivery-checklist-app.js";
import {
  BACKEND_AUTH_REQUEST_EVENT,
  BACKEND_AUTH_STATE_EVENT,
} from "../../src/shared/backend-auth.js";
import {
  DELIVERY_CHECKLIST_SESSIONS_KEY,
  DELIVERY_CHECKLIST_STORAGE_PREFIX,
} from "../../src/apps/delivery-checklist/delivery-checklist-storage.js";
import { deliveryChecklistTranslations } from "../../src/apps/delivery-checklist/delivery-checklist-translations.js";

function createRoot() {
  const root = document.createElement("main");
  root.innerHTML = deliveryChecklistTemplate;
  document.body.append(root);
  return root;
}

function createRouteContext({
  root,
  authService = null,
  appRuntime = null,
  mediaDevices = null,
  vinOcrRecognizer = null,
} = {}) {
  return {
    root,
    context: {},
    cleanup: {
      add: vi.fn(),
    },
    signal: new AbortController().signal,
    authService,
    appStorage: null,
    settingsService: null,
    appRuntime,
    mediaDevices,
    vinOcrRecognizer,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createI18nRuntime(initialLanguage = "en") {
  let language = initialLanguage;
  const listeners = new Set();
  const translate = (key, fallback) => deliveryChecklistTranslations[language]?.[key] || fallback || key;
  const apply = (root = document) => {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = translate(element.getAttribute("data-i18n"), element.textContent);
    });
    root.querySelectorAll("[data-i18n-aria]").forEach((element) => {
      element.setAttribute("aria-label", translate(element.getAttribute("data-i18n-aria"), element.getAttribute("aria-label")));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      element.setAttribute("title", translate(element.getAttribute("data-i18n-title"), element.getAttribute("title")));
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.setAttribute("placeholder", translate(element.getAttribute("data-i18n-placeholder"), element.getAttribute("placeholder")));
    });
  };

  return {
    i18n: {
      getLanguage: () => language,
      t: translate,
      apply,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      toggleLanguage() {
        language = language === "en" ? "es" : "en";
        for (const listener of listeners) listener(language);
        return language;
      },
    },
  };
}

function readStoredSession() {
  const stored = JSON.parse(
    localStorage.getItem(`${DELIVERY_CHECKLIST_STORAGE_PREFIX}${DELIVERY_CHECKLIST_SESSIONS_KEY}`),
  );
  return stored.sessions[0];
}

function completeActiveSection() {
  let button = document.querySelector('.delivery-item-row[data-status="unchecked"] .delivery-status-control-pass');
  while (button) {
    button.click();
    button = document.querySelector('.delivery-item-row[data-status="unchecked"] .delivery-status-control-pass');
  }
}

function advancePastVinStep() {
  if (document.querySelector("#deliverySectionTitle").textContent === "Read windshield VIN") {
    document.querySelector("#deliveryNextStep").click();
  }
}

function advanceToRecords() {
  advancePastVinStep();
  if (document.querySelector("#deliverySectionTitle").textContent === "Vehicle details") {
    const manualButton = document.querySelector("#deliveryUseManual");
    if (manualButton?.getAttribute("aria-pressed") !== "true") {
      manualButton?.click();
    }
    document.querySelector("#deliveryNextStep").click();
  }
}

function advanceToFinalReview() {
  let guard = 0;
  while (document.querySelector("#deliverySectionTitle").textContent !== "Final Review" && guard < 20) {
    if (document.querySelector("#deliverySectionTitle").textContent === "Read windshield VIN") {
      document.querySelector("#deliveryNextStep").click();
      guard += 1;
      continue;
    }
    if (document.querySelector("#deliverySectionTitle").textContent === "Vehicle details") {
      const manualButton = document.querySelector("#deliveryUseManual");
      if (manualButton?.getAttribute("aria-pressed") !== "true") {
        manualButton?.click();
      }
    }
    if (document.querySelector("#deliverySectionTitle").textContent !== "Vehicle details") {
      completeActiveSection();
    }
    document.querySelector("#deliveryNextStep").click();
    guard += 1;
  }
}

describe("delivery checklist app", () => {
  let originalIndexedDb;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: originalIndexedDb,
    });
    document.body.innerHTML = "";
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a manual offline session, persists an issue note, and generates a report", async () => {
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root }));

    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Read windshield VIN");
    expect(document.querySelector("#deliveryStepKicker").textContent).toBe("Step 1 of 10");
    expect(document.querySelector("#deliveryVinStepPanel").hidden).toBe(false);
    expect(document.querySelector("#deliverySetupPanel").hidden).toBe(true);
    expect(document.querySelector("#deliveryNextStep").textContent).toContain("Next: Vehicle");

    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Vehicle details");
    expect(document.querySelector("#deliveryStepKicker").textContent).toBe("Step 2 of 10");
    expect(document.querySelector("#deliverySetupPanel").hidden).toBe(false);
    expect(document.querySelector("#deliverySetupDetailsPanel").hidden).toBe(true);
    expect(document.querySelector("#deliveryReviewToggle")).toBeNull();

    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Vehicle details");
    expect(document.querySelector("#deliveryNextStep").textContent).toContain("Choose setup");
    expect(document.querySelector(".delivery-setup-choice--attention")).not.toBeNull();

    advanceToRecords();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Records");
    expect(document.querySelector("#deliveryStepKicker").textContent).toBe("Step 3 of 10");
    expect(document.querySelector("#deliveryUseManual").getAttribute("aria-pressed")).toBe("true");

    document.querySelector(".delivery-item-row .delivery-status-control-issue").click();
    const note = document.querySelector(".delivery-note-wrap textarea");
    note.focus();
    note.value = "VIN plate and app VIN need advisor confirmation.";
    note.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.activeElement).toBe(note);
    expect(note.isConnected).toBe(true);

    advanceToFinalReview();

    const session = readStoredSession();

    expect(session.itemState["records-vin-match"]).toMatchObject({
      status: "issue",
      note: "VIN plate and app VIN need advisor confirmation.",
    });
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Final Review");
    expect(document.querySelector("#deliveryReviewPanel").hidden).toBe(false);
    expect(document.querySelector("#deliveryReportText").value).toContain("VIN plate and app VIN");

    await flushPromises();
    expect(document.querySelector(".delivery-photo-button")).toBeNull();

    mounted.unmount();
  });

  it("saves a windshield VIN locally in manual setup without comparison warnings", async () => {
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root }));

    expect(document.querySelector("#deliveryVinScanStatus")).not.toBeNull();
    expect(document.querySelector("#deliveryVinScanStatus").dataset.state).toBe("not-scanned");

    document.querySelector("#deliveryEnterVinManual").click();
    const windshieldInput = document.querySelector("#deliveryManualWindshieldVin");
    expect(document.querySelector("#deliveryManualWindshieldVinWrap").hidden).toBe(false);
    windshieldInput.value = "5yjygdee0rf000001";
    windshieldInput.dispatchEvent(new Event("input", { bubbles: true }));

    let session = readStoredSession();
    expect(session.metadata).toMatchObject({
      windshieldVin: "5YJYGDEE0RF000001",
      windshieldVinScanSource: "manual",
    });
    expect(document.querySelector("#deliveryWindshieldVinValue").textContent).toBe("5YJYGDEE0RF000001");

    document.querySelector("#deliveryUseManual").click();
    expect(document.querySelector("#deliveryVin").value).toBe("5YJYGDEE0RF000001");
    expect(document.querySelector("#deliveryWindshieldVinCompare").textContent).toContain("Manual setup");
    expect(document.querySelector("#deliveryWindshieldVinCompare").textContent).not.toContain("Does not match");

    session = readStoredSession();
    expect(session.metadata.vin).toBe("5YJYGDEE0RF000001");
    expect(document.querySelector("#deliveryReportText").value).toContain("Windshield VIN: 5YJYGDEE0RF000001");
    expect(document.querySelector("#deliveryReportText").value).toContain("Windshield VIN comparison: Manual/local only");

    mounted.unmount();
  });

  it("switches delivery checklist copy between English and Spanish without remounting", async () => {
    const root = createRoot();
    const appRuntime = createI18nRuntime();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, appRuntime }));

    expect(document.querySelector(".delivery-rail-label").textContent).toBe("Guided flow");
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Read windshield VIN");

    document.querySelector("#deliveryLangToggle").click();

    expect(document.querySelector("#deliveryLangToggle").textContent).toBe("ES");
    expect(document.querySelector(".delivery-rail-label").textContent).toBe("Flujo guiado");
    expect(document.querySelector("#deliveryStatus").textContent).toBe("Guardado localmente en este navegador.");
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Leer VIN del parabrisas");
    expect(document.querySelector("#deliveryStepKicker").textContent).toBe("Paso 1 de 10");
    expect(document.querySelector("#deliveryNextStep").textContent).toContain("Siguiente: Vehículo");
    expect(document.querySelector("#deliveryReadVinOcr").textContent).toContain("Leer VIN");

    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Detalles del vehículo");
    expect(document.querySelector("#deliveryUseManual").textContent).toContain("Continuar manualmente");

    document.querySelector("#deliveryUseManual").click();
    expect(document.querySelector("#deliveryStatus").textContent).toBe("Configuración manual local seleccionada.");
    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Registros");
    expect(document.querySelector(".delivery-item-row h3").textContent).toContain("El VIN coincide");

    document.querySelector(".delivery-status-control-issue").click();
    completeActiveSection();
    let guard = 0;
    while (document.querySelector(".delivery-checklist-app").dataset.activeStep !== "final-review" && guard < 20) {
      document.querySelector("#deliveryNextStep").click();
      completeActiveSection();
      guard += 1;
    }

    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Revisión final");
    expect(document.querySelector("#deliveryReviewPanel h2").textContent).toBe("Revisión");
    expect(document.querySelector("#deliveryReviewSummary").textContent).toContain("1 incidencia");
    expect(document.querySelector("#deliveryReportText").value).toContain("Lista de entrega Tesla:");
    expect(document.querySelector("#deliveryReportText").value).toContain("Incidencias: 1");
    expect(document.querySelector("#deliveryReportText").value).toContain("El VIN coincide");

    document.querySelector("#deliveryLangToggle").click();
    expect(document.querySelector("#deliveryLangToggle").textContent).toBe("EN");
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Final Review");
    expect(document.querySelector("#deliveryReviewPanel h2").textContent).toBe("Review");
    expect(document.querySelector("#deliveryReportText").value).toContain("Tesla Delivery Checklist:");

    mounted.unmount();
  });

  it("validates the active section before moving to the next guided step", async () => {
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root }));

    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Vehicle details");
    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Vehicle details");
    expect(document.querySelector("#deliveryStatus").textContent).toContain("manual vehicle details");

    document.querySelector("#deliveryUseManual").click();
    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Records");

    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Records");
    expect(document.querySelector(".delivery-item-row--attention")).not.toBeNull();
    expect(document.querySelector("#deliveryStatus").textContent).toContain("highlighted checklist item");

    for (let index = 0; index < 5; index += 1) {
      document.querySelector('.delivery-item-row[data-status="unchecked"] .delivery-status-control-pass').click();
    }
    expect(readStoredSession().itemState["records-vin-match"].status).toBe("pass");
    expect(document.querySelector("#deliveryNextStep").textContent).toContain("Next: Locked");
    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Locked Exterior");
    expect(document.querySelector("#deliveryStepKicker").textContent).toBe("Step 4 of 10");

    document.querySelector("#deliveryPrevStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Records");
    expect(document.querySelector(".delivery-status-control-pass").getAttribute("aria-pressed")).toBe("true");

    await flushPromises();
    mounted.unmount();
  });

  it("compares a scanned windshield VIN against VatioLibre metadata after import", async () => {
    const authService = {
      getTeslaConnectionStatus: vi.fn(async () => ({
        authenticated: true,
        connected: true,
        isGuest: false,
        localOnly: false,
      })),
      listTeslaOrders: vi.fn(async () => ({
        connected: true,
        orders: [
          {
            reference_number: "RNMATCH",
            model_code: "my",
            vin: "5YJYGDEE0RF000001",
          },
        ],
      })),
      listTeslaVehicles: vi.fn(),
      getTeslaVehicleData: vi.fn(),
    };
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, authService }));

    document.querySelector("#deliveryEnterVinManual").click();
    const windshieldInput = document.querySelector("#deliveryManualWindshieldVin");
    windshieldInput.value = "5YJYGDEE0RF000001";
    windshieldInput.dispatchEvent(new Event("input", { bubbles: true }));

    document.querySelector("#deliveryUseVatioLibre").click();
    await flushPromises();
    await flushPromises();

    expect(document.querySelector("#deliveryVinScanStatus").dataset.state).toBe("match");
    expect(document.querySelector("#deliveryWindshieldVinCompare").textContent).toContain("Matches VatioLibre VIN");
    expect(document.querySelector("#deliverySetupModelSwitch").hidden).toBe(true);
    expect(document.querySelector("#deliveryReportText").value).toContain("Windshield VIN comparison: Match");

    mounted.unmount();
  });

  it("warns when the scanned windshield VIN differs from the VatioLibre VIN", async () => {
    const authService = {
      getTeslaConnectionStatus: vi.fn(async () => ({
        authenticated: true,
        connected: true,
        isGuest: false,
        localOnly: false,
      })),
      listTeslaOrders: vi.fn(async () => ({
        connected: true,
        orders: [
          {
            reference_number: "RNMISMATCH",
            model_code: "ct",
            vin: "7G2CEHED0RA000001",
          },
        ],
      })),
      listTeslaVehicles: vi.fn(),
      getTeslaVehicleData: vi.fn(),
    };
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, authService }));

    document.querySelector("#deliveryEnterVinManual").click();
    const windshieldInput = document.querySelector("#deliveryManualWindshieldVin");
    windshieldInput.value = "5YJYGDEE0RF000001";
    windshieldInput.dispatchEvent(new Event("input", { bubbles: true }));

    document.querySelector("#deliveryUseVatioLibre").click();
    await flushPromises();
    await flushPromises();

    expect(document.querySelector("#deliveryVinScanStatus").dataset.state).toBe("mismatch");
    expect(document.querySelector("#deliveryWindshieldVinCompare").textContent).toContain("Does not match");
    expect(document.querySelector("#deliveryWindshieldVinCompare").textContent).toContain("7G2CEHED0RA000001");
    expect(document.querySelector("#deliveryReportText").value).toContain("Windshield VIN comparison: Mismatch");

    mounted.unmount();
  });

  it("falls back to upload and manual options when camera OCR is unavailable", async () => {
    const mediaDevices = {
      getUserMedia: vi.fn(async () => {
        throw new Error("Camera rejected");
      }),
    };
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, mediaDevices }));

    await flushPromises();
    document.querySelector("#deliveryReadVinOcr").click();
    await flushPromises();

    expect(mediaDevices.getUserMedia).toHaveBeenCalled();
    expect(document.querySelector("#deliveryVinScannerSheet").hidden).toBe(false);
    expect(document.querySelector("#deliveryVinScannerCapture").textContent).toBe("Take photo");
    expect(document.querySelector("#deliveryVinScannerFallbackActions").hidden).toBe(false);
    expect(document.querySelector("#deliveryVinScannerUpload")).not.toBeNull();
    expect(document.querySelector("#deliveryManualWindshieldVinWrap").hidden).toBe(true);
    expect(document.querySelector("#deliveryStatus").textContent).toContain("Camera OCR is unavailable");
    const nativeInput = document.querySelector("#deliveryVinNativeCaptureInput");
    nativeInput.click = vi.fn();
    document.querySelector("#deliveryVinScannerCapture").click();
    expect(nativeInput.click).toHaveBeenCalled();
    document.querySelector("#deliveryVinScannerFallback").click();
    expect(document.querySelector("#deliveryVinScannerSheet").hidden).toBe(true);
    expect(document.querySelector("#deliveryManualWindshieldVinWrap").hidden).toBe(false);

    mounted.unmount();
  });

  it("shows section rail progress and issue counts for the active checklist", async () => {
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root }));

    advanceToRecords();
    document.querySelector(".delivery-status-control-issue").click();
    const vinStep = document.querySelector("[data-section='windshield-vin']");
    const recordsStep = document.querySelector("[data-section='records']");
    const setupStep = document.querySelector("[data-section='vehicle-setup']");

    expect(vinStep.textContent).toContain("VIN");
    expect(vinStep.textContent).toContain("Optional");
    expect(setupStep.textContent).toContain("Vehicle");
    expect(setupStep.textContent).toContain("Manual");
    expect(recordsStep.textContent).toContain("1/5");
    expect(recordsStep.textContent).toContain("1 issue");
    expect(recordsStep.dataset.status).toBe("issue");
    expect(document.querySelector("#deliveryIssueCount").textContent).toContain("1/5");

    await flushPromises();
    mounted.unmount();
  });

  it("imports a single VatioLibre vehicle after setup choice without waking sleeping vehicles", async () => {
    const authService = {
      getTeslaConnectionStatus: vi.fn(async () => ({
        authenticated: true,
        connected: true,
        isGuest: false,
        localOnly: false,
      })),
      listTeslaOrders: vi.fn(async () => ({
        connected: true,
        orders: [],
      })),
      listTeslaVehicles: vi.fn(async () => ({
        connected: true,
        vehicles: [
          {
            id: 987654321,
            id_s: "987654321",
            vin: "7G2CEHED0RA000001",
            display_name: "Cybertruck",
            car_type: "ct",
            state: "asleep",
          },
        ],
      })),
      getTeslaVehicleData: vi.fn(async () => ({
        ok: false,
        skippedWake: true,
        vehicleState: "asleep",
      })),
    };
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, authService }));

    await flushPromises();
    expect(authService.getTeslaConnectionStatus).not.toHaveBeenCalled();

    document.querySelector("#deliveryUseVatioLibre").click();
    await flushPromises();
    await flushPromises();

    expect(authService.getTeslaVehicleData).toHaveBeenCalledWith({
      vehicleId: "987654321",
      skipWake: true,
    });
    expect(document.querySelector("#deliveryVin").value).toBe("7G2CEHED0RA000001");
    expect(document.querySelector("[data-model='cybertruck']").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("#deliverySetupModelSwitch").hidden).toBe(true);
    expect(document.querySelector("#deliverySetupModelLock").textContent).toContain("Cybertruck");
    expect(document.querySelector("#deliveryImportSelect").hidden).toBe(true);
    expect(document.querySelector("#deliveryImportSummary").textContent).toContain("only matching");

    mounted.unmount();
  });

  it("shows a setup selector for multiple VatioLibre candidates without auto-applying", async () => {
    const authService = {
      getTeslaConnectionStatus: vi.fn(async () => ({
        authenticated: true,
        connected: true,
        isGuest: false,
        localOnly: false,
      })),
      listTeslaOrders: vi.fn(async () => ({
        connected: true,
        orders: [
          { reference_number: "RN111", model_code: "m3", vin: "VIN111" },
          { reference_number: "RN222", model_code: "my", vin: "VIN222" },
        ],
      })),
      listTeslaVehicles: vi.fn(),
      getTeslaVehicleData: vi.fn(),
    };
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, authService }));

    await flushPromises();
    expect(authService.getTeslaConnectionStatus).not.toHaveBeenCalled();

    document.querySelector("#deliveryUseVatioLibre").click();
    await flushPromises();
    await flushPromises();

    expect(document.querySelector("#deliveryImportPanel").hidden).toBe(false);
    expect(document.querySelector("#deliveryImportSelect").hidden).toBe(false);
    expect(document.querySelector("#deliveryImportSelect").options).toHaveLength(2);
    expect(document.querySelector("#deliveryVin").value).toBe("");
    expect(authService.getTeslaVehicleData).not.toHaveBeenCalled();

    document.querySelector("#deliveryApplyImport").click();
    await flushPromises();
    expect(document.querySelector("#deliveryOrderReference").value).toBe("RN111");

    mounted.unmount();
  });

  it("shows a login CTA for unauthenticated users and requests backend auth", async () => {
    const authService = {
      getTeslaConnectionStatus: vi.fn(async () => ({
        authenticated: false,
        connected: false,
        isGuest: true,
        localOnly: false,
      })),
    };
    const requests = [];
    const listener = (event) => requests.push(event.detail);
    window.addEventListener(BACKEND_AUTH_REQUEST_EVENT, listener);
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, authService }));

    await flushPromises();
    expect(authService.getTeslaConnectionStatus).not.toHaveBeenCalled();

    document.querySelector("#deliveryUseVatioLibre").click();
    await flushPromises();
    expect(document.querySelector("#deliveryLogin").hidden).toBe(false);
    document.querySelector("#deliveryLogin").click();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      authPromptMode: "required",
      source: "delivery-checklist",
    });

    window.removeEventListener(BACKEND_AUTH_REQUEST_EVENT, listener);
    mounted.unmount();
  });

  it("refreshes VatioLibre import after a successful backend login event", async () => {
    const authService = {
      getTeslaConnectionStatus: vi.fn()
        .mockResolvedValueOnce({
          authenticated: false,
          connected: false,
          isGuest: true,
          localOnly: false,
        })
        .mockResolvedValue({
          authenticated: true,
          connected: true,
          isGuest: false,
          localOnly: false,
        }),
      listTeslaOrders: vi.fn(async () => ({
        connected: true,
        orders: [
          {
            reference_number: "RNLOGIN",
            model_code: "my",
            vin: "5YJYGDEE0RF000001",
            status: "scheduled",
          },
        ],
      })),
      listTeslaVehicles: vi.fn(),
      getTeslaVehicleData: vi.fn(),
    };
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, authService }));

    document.querySelector("#deliveryUseVatioLibre").click();
    await flushPromises();
    expect(document.querySelector("#deliveryLogin").hidden).toBe(false);

    window.dispatchEvent(new CustomEvent(BACKEND_AUTH_STATE_EVENT, {
      detail: {
        authenticated: true,
        isGuest: false,
        pendingLogout: false,
        user: "oscar@example.com",
      },
    }));
    await flushPromises();
    await flushPromises();

    expect(authService.listTeslaOrders).toHaveBeenCalled();
    expect(document.querySelector("#deliveryOrderReference").value).toBe("RNLOGIN");
    expect(document.querySelector("[data-model='modely']").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("#deliverySetupModelSwitch").hidden).toBe(true);

    mounted.unmount();
  });

  it("keeps the guided shell constrained for mobile and Tesla browser layouts", () => {
    const stylesheet = readFileSync(
      join(process.cwd(), "src/apps/delivery-checklist/delivery-checklist.less"),
      "utf8",
    );

    expect(stylesheet).toContain("--delivery-touch: var(--vb-touch-target-min, 44px)");
    expect(stylesheet).toContain("min-height: var(--delivery-touch)");
    expect(stylesheet).toContain("overflow-x: clip");
    expect(stylesheet).toContain(".delivery-checklist-app .brand-logo");
    expect(stylesheet).toContain("order: 3");
    expect(stylesheet).toContain(".delivery-toolbar-strip");
    expect(stylesheet).toContain(".delivery-export-menu");
    expect(stylesheet).toContain(".delivery-setup-choice");
    expect(stylesheet).toContain(".delivery-setup-details-panel");
    expect(stylesheet).toContain(".delivery-setup-model-switch");
    expect(stylesheet).toContain(".delivery-vin-scan-card");
    expect(stylesheet).toContain(".delivery-vin-scanner-sheet");
    expect(stylesheet).toContain(".delivery-vin-video-wrap");
    expect(stylesheet).toContain(".delivery-vin-scan-frame");
    expect(stylesheet).toContain("inline-size: min(55%, 420px)");
    expect(stylesheet).toContain("inline-size: min(55cqw, 420px)");
    expect(stylesheet).not.toContain("inline-size: min(88%, 620px)");
    expect(stylesheet).not.toContain("inline-size: min(88cqw, 620px)");
    expect(stylesheet).toContain("block-size: auto");
    expect(stylesheet).toContain(".delivery-vin-scanner-actions");
    expect(stylesheet).toContain(".delivery-vin-scanner-fallback-actions");
    expect(stylesheet).toContain(".delivery-vin-crop-editor");
    expect(stylesheet).toContain(".delivery-vin-crop-wrap");
    expect(stylesheet).toContain(".delivery-vin-crop-actions");
    expect(stylesheet).toContain("touch-action: none");
    expect(stylesheet).toContain("touch-action: pan-y");
    expect(stylesheet).toContain(".delivery-vin-ocr-diagnostics");
    expect(stylesheet).toContain(".delivery-vin-ocr-preview");
    expect(stylesheet).toContain(".delivery-vin-ocr-actions");
    expect(stylesheet).toContain("position: relative");
    expect(stylesheet).not.toContain(".scan-region-highlight");
    expect(stylesheet).not.toContain("#deliveryModelSwitch");
    expect(stylesheet).toContain("env(safe-area-inset-bottom");
    expect(stylesheet).toContain(".delivery-bottom-nav");
    expect(stylesheet).toContain("scroll-margin-bottom");
    const getBlocks = (selector) =>
      Array.from(stylesheet.matchAll(new RegExp(`(?:^|\\n)${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "g")))
        .map((match) => match[1]);
    const checklistMainBlock = getBlocks("\\.delivery-checklist-main").at(0) || "";
    expect(checklistMainBlock).toContain("display: grid;");
    expect(checklistMainBlock).toContain("grid-template-columns: minmax(0, 1fr);");
    const statusBlock = getBlocks("\\.delivery-status").at(-1) || "";
    expect(statusBlock).toContain("grid-column: 1 / -1;");
    const guidedLayoutBlock = getBlocks("\\.delivery-guided-layout").at(0) || "";
    expect(guidedLayoutBlock).toContain("grid-column: 1 / -1;");
    const bottomNavBlock = stylesheet.match(/\.delivery-bottom-nav\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    expect(bottomNavBlock).not.toContain("position: fixed");
    expect(bottomNavBlock).toContain("border-top");

    const root = createRoot();
    expect(root.querySelector(".delivery-checklist-header .delivery-checklist-overview")).not.toBeNull();
    expect(root.querySelector("main > .delivery-checklist-overview")).toBeNull();
    expect(root.querySelector(".delivery-vin-scan-card")).not.toBeNull();
    expect(root.querySelector("#deliveryVinStepPanel")).not.toBeNull();
    expect(root.querySelector("#deliveryVinScannerSheet")).not.toBeNull();
    expect(root.querySelector("#deliveryVinScannerFallbackActions").hidden).toBe(true);
    expect(root.querySelector(".delivery-vin-video-wrap .delivery-vin-scan-frame")).not.toBeNull();
    expect(root.querySelector("#deliveryVinScannerCapture")).not.toBeNull();
    expect(root.querySelector("#deliveryVinScannerUpload")).not.toBeNull();
    expect(root.querySelector("#deliveryVinImageInput")).not.toBeNull();
    expect(root.querySelector("#deliveryVinNativeCaptureInput")).not.toBeNull();
    expect(root.querySelector("#deliveryVinCropCanvas")).not.toBeNull();
    expect(root.querySelector("#deliveryVinCropZoom")).not.toBeNull();
    expect(root.querySelector("#deliveryVinCropRead")).not.toBeNull();
    expect(root.querySelector("#deliveryVinOcrDiagnostics")).not.toBeNull();
    root.remove();
  });

  it("exports PDF, JSON, and text from the single toolbar download menu", async () => {
    const root = createRoot();
    const createdBlobs = [];
    const downloads = [];
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
      downloads.push({
        download: this.download,
        href: this.href,
      });
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn((blob) => {
        createdBlobs.push(blob);
        return `blob:delivery-export-${createdBlobs.length}`;
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root }));

    document.querySelector("#deliveryExport").click();
    expect(document.querySelector("#deliveryExportMenu").hidden).toBe(false);
    document.querySelector("#deliveryExportPdf").click();
    document.querySelector("#deliveryExport").click();
    document.querySelector("#deliveryExportJson").click();
    document.querySelector("#deliveryExport").click();
    document.querySelector("#deliveryExportText").click();

    expect(downloads.map((entry) => entry.download.split(".").pop())).toEqual(["pdf", "json", "txt"]);
    expect(createdBlobs.map((blob) => blob.type)).toEqual([
      "application/pdf",
      "application/json",
      "text/plain;charset=utf-8",
    ]);
    await expect(createdBlobs[0].text()).resolves.toMatch(/^%PDF/);

    clickSpy.mockRestore();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: originalRevokeObjectUrl,
    });
    mounted.unmount();
  });

  it("saves an OCR-read windshield VIN from the scanner sheet", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: vi.fn(() => [{ stop: stopTrack }]),
    };
    const mediaDevices = {
      getUserMedia: vi.fn(async () => stream),
    };
    const vinOcrRecognizer = vi.fn(async () => ({
      vin: "7SAYGAEE3RF178432",
      rawText: "YEZ7SAYGAEE3RF178432",
      attempts: 1,
    }));
    const root = createRoot();
    const video = root.querySelector("#deliveryVinScannerVideo");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1920 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1080 });
    video.style.objectFit = "cover";
    video.style.objectPosition = "50% 50%";
    video.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      width: 574,
      height: 323,
      top: 0,
      left: 0,
      right: 574,
      bottom: 323,
      toJSON: vi.fn(),
    }));
    root.querySelector(".delivery-vin-scan-frame").getBoundingClientRect = vi.fn(() => ({
      x: 44,
      y: 54,
      width: 492,
      height: 76,
      top: 54,
      left: 44,
      right: 536,
      bottom: 130,
      toJSON: vi.fn(),
    }));
    video.play = vi.fn(async () => {});
    video.pause = vi.fn();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, mediaDevices, vinOcrRecognizer }));

    document.querySelector("#deliveryReadVinOcr").click();
    await flushPromises();
    expect(document.querySelector("#deliveryVinScannerSheet").hidden).toBe(false);
    expect(mediaDevices.getUserMedia).toHaveBeenCalled();
    expect(document.querySelector("#deliveryVinScannerCapture").textContent).toBe("Capture frame");
    expect(document.querySelector("#deliveryVinScannerStatus").textContent).toContain("Step back until the VIN fits");
    expect(document.querySelector("#deliveryVinScannerFallbackActions").hidden).toBe(true);

    document.querySelector("#deliveryVinScannerCapture").click();
    await flushPromises();
    expect(stopTrack).toHaveBeenCalled();
    expect(document.querySelector("#deliveryVinCropEditor").hidden).toBe(false);
    expect(document.querySelector("#deliveryVinLivePane").hidden).toBe(true);
    expect(Number(document.querySelector("#deliveryVinCropZoom").value)).toBeGreaterThan(1);
    expect(vinOcrRecognizer).not.toHaveBeenCalled();

    document.querySelector("#deliveryVinCropZoom").value = "1";
    document.querySelector("#deliveryVinCropZoom").dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#deliveryVinCropReset").click();
    expect(Number(document.querySelector("#deliveryVinCropZoom").value)).toBeGreaterThan(1);

    document.querySelector("#deliveryVinCropRead").click();
    await flushPromises();

    expect(vinOcrRecognizer).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), expect.objectContaining({
      mode: "frame",
      debug: true,
      debugLabel: "delivery-checklist-camera-crop",
      regions: expect.arrayContaining([
        expect.objectContaining({ role: "vin-text", regionSource: "manual-crop" }),
        expect.objectContaining({ role: "full-band", regionSource: "manual-crop" }),
      ]),
      onProgress: expect.any(Function),
      onDebugArtifact: expect.any(Function),
      onDebugReport: expect.any(Function),
    }));
    expect(document.querySelector("#deliveryVinScannerSheet").hidden).toBe(true);
    expect(document.querySelector("#deliveryWindshieldVinValue").textContent).toBe("7SAYGAEE3RF178432");
    expect(readStoredSession().metadata).toMatchObject({
      windshieldVin: "7SAYGAEE3RF178432",
      windshieldVinScanSource: "ocr",
    });

    mounted.unmount();
  });

  it("loads an uploaded VIN image into the crop editor before OCR", async () => {
    const mediaDevices = {
      getUserMedia: vi.fn(async () => {
        throw new Error("Camera unavailable");
      }),
    };
    const source = document.createElement("canvas");
    source.width = 1600;
    source.height = 900;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => source));
    const vinOcrRecognizer = vi.fn(async () => ({
      vin: "7SAYGAEE3RF178432",
      rawText: "7SAYGAEE3RF178432",
      attempts: 1,
    }));
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, mediaDevices, vinOcrRecognizer }));

    document.querySelector("#deliveryReadVinOcr").click();
    await flushPromises();
    expect(document.querySelector("#deliveryVinScannerFallbackActions").hidden).toBe(false);
    document.querySelector("#deliveryVinScannerUpload").click();
    const input = document.querySelector("#deliveryVinImageInput");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File([new Blob(["vin"])], "vin.png", { type: "image/png" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    expect(globalThis.createImageBitmap).toHaveBeenCalled();
    expect(document.querySelector("#deliveryVinCropEditor").hidden).toBe(false);
    expect(document.querySelector("#deliveryVinLivePane").hidden).toBe(true);
    const cropCanvas = document.querySelector("#deliveryVinCropCanvas");
    cropCanvas.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      width: 480,
      height: 100,
      top: 0,
      left: 0,
      right: 480,
      bottom: 100,
      toJSON: vi.fn(),
    }));
    cropCanvas.setPointerCapture = vi.fn();
    cropCanvas.releasePointerCapture = vi.fn();
    const pointerDown = new Event("pointerdown", { bubbles: true });
    Object.assign(pointerDown, { clientX: 20, clientY: 20, pointerId: 1 });
    const pointerMove = new Event("pointermove", { bubbles: true });
    Object.assign(pointerMove, { clientX: 44, clientY: 26, pointerId: 1 });
    const pointerUp = new Event("pointerup", { bubbles: true });
    Object.assign(pointerUp, { clientX: 44, clientY: 26, pointerId: 1 });
    cropCanvas.dispatchEvent(pointerDown);
    cropCanvas.dispatchEvent(pointerMove);
    cropCanvas.dispatchEvent(pointerUp);
    const zoom = document.querySelector("#deliveryVinCropZoom");
    zoom.value = "1.5";
    zoom.dispatchEvent(new Event("input", { bubbles: true }));
    expect(cropCanvas.setPointerCapture).toHaveBeenCalledWith(1);
    expect(zoom.value).toBe("1.5");

    document.querySelector("#deliveryVinCropRead").click();
    await flushPromises();

    expect(vinOcrRecognizer).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), expect.objectContaining({
      regions: expect.arrayContaining([
        expect.objectContaining({ regionSource: "manual-crop" }),
      ]),
    }));
    expect(document.querySelector("#deliveryWindshieldVinValue").textContent).toBe("7SAYGAEE3RF178432");

    mounted.unmount();
  });

  it("shows OCR diagnostics after a failed windshield VIN read", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: vi.fn(() => [{ stop: stopTrack }]),
    };
    const mediaDevices = {
      getUserMedia: vi.fn(async () => stream),
    };
    const debug = {
      id: "debug-1",
      label: "delivery-checklist-camera-crop",
      startedAt: "2026-06-15T00:00:00.000Z",
      endedAt: "2026-06-15T00:00:01.000Z",
      mode: "frame",
      sourceSize: { width: 960, height: 200 },
      displaySize: { width: 960, height: 200 },
      regions: [{ x: 0, y: 0, width: 960, height: 200, regionSource: "manual-crop" }],
      attempts: [{
        attempt: 1,
        regionIndex: 0,
        region: { x: 0, y: 0, width: 960, height: 200, regionSource: "manual-crop" },
        variant: "gray",
        rawText: "TESLA",
        confidence: 41,
        candidates: [],
        selectedVin: "",
      }],
      selectedVin: "",
      confidence: 0,
      rawText: "TESLA",
      failureReason: "No OCR attempt produced a valid VIN.",
    };
    const vinOcrRecognizer = vi.fn(async (_source, options) => {
      options.onDebugArtifact?.({
        name: "ocr-region-overlay.png",
        kind: "source",
        mimeType: "image/png",
        blob: new Blob(["combined"], { type: "image/png" }),
        width: 960,
        height: 200,
        overlayRole: "combined",
        regionSources: ["manual-crop"],
      });
      options.onDebugArtifact?.({
        name: "manual-crop-text.png",
        kind: "region",
        mimeType: "image/png",
        blob: new Blob(["target"], { type: "image/png" }),
        width: 960,
        height: 200,
        regionIndex: 0,
        region: { x: 0, y: 0, width: 960, height: 200, regionSource: "manual-crop" },
      });
      options.onDebugArtifact?.({
        name: "ocr-search-overlay.png",
        kind: "source",
        mimeType: "image/png",
        blob: new Blob(["search"], { type: "image/png" }),
        width: 1920,
        height: 1080,
        overlayRole: "search",
        regionSources: ["fallback"],
      });
      options.onDebugReport?.(debug);
      return {
        vin: "",
        rawText: "TESLA",
        attempts: 1,
        debug,
      };
    });
    const root = createRoot();
    const video = root.querySelector("#deliveryVinScannerVideo");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1920 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1080 });
    video.style.objectFit = "cover";
    video.style.objectPosition = "50% 50%";
    video.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      width: 574,
      height: 323,
      top: 0,
      left: 0,
      right: 574,
      bottom: 323,
      toJSON: vi.fn(),
    }));
    root.querySelector(".delivery-vin-video-wrap").getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      width: 574,
      height: 323,
      top: 0,
      left: 0,
      right: 574,
      bottom: 323,
      toJSON: vi.fn(),
    }));
    root.querySelector(".delivery-vin-scan-frame").getBoundingClientRect = vi.fn(() => ({
      x: 44,
      y: 54,
      width: 492,
      height: 76,
      top: 54,
      left: 44,
      right: 536,
      bottom: 130,
      toJSON: vi.fn(),
    }));
    video.play = vi.fn(async () => {});
    video.pause = vi.fn();
    navigator.clipboard.writeText.mockClear();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, mediaDevices, vinOcrRecognizer }));

    document.querySelector("#deliveryReadVinOcr").click();
    await flushPromises();
    document.querySelector("#deliveryVinScannerCapture").click();
    await flushPromises();
    document.querySelector("#deliveryVinCropRead").click();
    await flushPromises();
    document.querySelector("#deliveryVinOcrWiderScan").click();
    await flushPromises();

    expect(document.querySelector("#deliveryVinScannerSheet").hidden).toBe(false);
    expect(document.querySelector("#deliveryVinOcrDiagnostics").hidden).toBe(false);
    expect(document.querySelector("#deliveryVinScannerFallbackActions").hidden).toBe(false);
    expect(document.querySelector("#deliveryVinOcrCopyDebug")).not.toBeNull();
    expect(document.querySelector("#deliveryVinOcrDownloadDebug")).not.toBeNull();
    expect(document.querySelector("#deliveryVinOcrWiderScan")).not.toBeNull();
    expect(document.querySelector("#deliveryVinOcrPreview img").alt).toBe("manual-crop-text.png");
    expect(document.querySelector("#deliveryStatus").textContent).toContain("No valid VIN");
    expect(vinOcrRecognizer).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), expect.objectContaining({
      mode: "search",
    }));
    document.querySelector("#deliveryVinOcrCopyDebug").click();
    await flushPromises();
    const copiedPayload = JSON.parse(navigator.clipboard.writeText.mock.calls.at(-1)[0]);
    expect(copiedPayload.cameraRoi.frameHint).toMatchObject({
      sourceSize: { width: 1920, height: 1080 },
      objectFit: "cover",
      objectPosition: "50% 50%",
      videoRect: { width: 574, height: 323 },
      frameRect: { x: 44, y: 54, width: 492, height: 76 },
    });
    expect(copiedPayload.cameraRoi.mappedFrameRegion).toMatchObject({
      regionSource: "mapped-frame",
      role: "full-band",
    });
    expect(copiedPayload.cameraRoi.expandedSourceRegion).toMatchObject({
      regionSource: "mapped-frame-expanded",
    });
    expect(copiedPayload.cameraRoi.croppedCanvasSize.width).toBeGreaterThan(0);

    mounted.unmount();
  });

  it("renders local photo thumbnails and review previews without changing session schema", async () => {
    vi.resetModules();
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const blob = new Blob(["photo"], { type: "image/png" });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:delivery-photo-1"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    vi.doMock("../../src/apps/delivery-checklist/delivery-checklist-photo-store.js", () => ({
      createDeliveryChecklistPhotoId: vi.fn(() => "photo-1"),
      detectDeliveryChecklistPhotoStorage: vi.fn(async () => ({
        available: true,
        indexedDbWritable: true,
      })),
      getDeliveryChecklistPhoto: vi.fn(async (id) => ({
        id,
        sessionId: "session",
        itemId: "records-vin-match",
        name: "delivery.png",
        type: "image/png",
        size: blob.size,
        createdAt: 1,
        blob,
      })),
      saveDeliveryChecklistPhoto: vi.fn(async ({ id, sessionId, itemId, name }) => ({
        id,
        sessionId,
        itemId,
        name,
        type: "image/png",
        size: blob.size,
        createdAt: 1,
        blob,
      })),
    }));

    const [{ default: freshTemplate }, { mountDeliveryChecklistRoute: freshMount }] = await Promise.all([
      import("../../src/apps/delivery-checklist/delivery-checklist-template.js"),
      import("../../src/apps/delivery-checklist/delivery-checklist-app.js"),
    ]);
    const root = document.createElement("main");
    root.innerHTML = freshTemplate;
    document.body.append(root);
    const mounted = freshMount(createRouteContext({ root }));
    await flushPromises();

    advanceToRecords();
    document.querySelector(".delivery-status-control-issue").click();
    await flushPromises();
    document.querySelector(".delivery-photo-button").click();
    const input = document.querySelector('input[type="file"]:not(#deliveryVinImageInput):not(#deliveryVinNativeCaptureInput)');
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File([blob], "delivery.png", { type: "image/png" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    expect(document.querySelector(".delivery-photo-thumb img").getAttribute("src")).toBe("blob:delivery-photo-1");
    expect(readStoredSession().itemState["records-vin-match"].photoIds).toEqual(["photo-1"]);

    advanceToFinalReview();
    expect(document.querySelector(".delivery-issue-entry .delivery-photo-thumb img").getAttribute("src")).toBe("blob:delivery-photo-1");

    mounted.unmount();
    vi.doUnmock("../../src/apps/delivery-checklist/delivery-checklist-photo-store.js");
    vi.resetModules();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: originalRevokeObjectUrl,
    });
  });
});
