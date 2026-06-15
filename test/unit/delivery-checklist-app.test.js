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

function createRoot() {
  const root = document.createElement("main");
  root.innerHTML = deliveryChecklistTemplate;
  document.body.append(root);
  return root;
}

function createRouteContext({ root, authService = null, appRuntime = null, qrScannerService = null } = {}) {
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
    qrScannerService,
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

function advanceToRecords() {
  if (document.querySelector("#deliverySectionTitle").textContent === "Vehicle setup") {
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
    if (document.querySelector("#deliverySectionTitle").textContent === "Vehicle setup") {
      const manualButton = document.querySelector("#deliveryUseManual");
      if (manualButton?.getAttribute("aria-pressed") !== "true") {
        manualButton?.click();
      }
    }
    if (document.querySelector("#deliverySectionTitle").textContent !== "Vehicle setup") {
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
  });

  it("creates a manual offline session, persists an issue note, and generates a report", async () => {
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root }));

    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Vehicle setup");
    expect(document.querySelector("#deliveryStepKicker").textContent).toBe("Step 1 of 9");
    expect(document.querySelector("#deliverySetupPanel").hidden).toBe(false);
    expect(document.querySelector("#deliverySetupDetailsPanel").hidden).toBe(true);
    expect(document.querySelector("#deliveryReviewToggle")).toBeNull();

    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Vehicle setup");
    expect(document.querySelector("#deliveryNextStep").textContent).toContain("Choose setup");
    expect(document.querySelector(".delivery-setup-choice--attention")).not.toBeNull();

    advanceToRecords();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Records");
    expect(document.querySelector("#deliveryStepKicker").textContent).toBe("Step 2 of 9");
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

  it("validates the active section before moving to the next guided step", async () => {
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root }));

    document.querySelector("#deliveryNextStep").click();
    expect(document.querySelector("#deliverySectionTitle").textContent).toBe("Vehicle setup");
    expect(document.querySelector("#deliveryStatus").textContent).toContain("Choose VatioLibre import");

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
    expect(document.querySelector("#deliveryStepKicker").textContent).toBe("Step 3 of 9");

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

  it("falls back to manual windshield VIN entry when the QR service denies camera access", async () => {
    const qrScannerService = {
      hasCamera: vi.fn(),
      listCameras: vi.fn(),
      scanImage: vi.fn(),
      createCameraSession: vi.fn(async () => {
        throw new Error("QR scanner camera permission denied.");
      }),
    };
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, qrScannerService }));

    await flushPromises();
    document.querySelector("#deliveryScanVinQr").click();
    await flushPromises();

    expect(qrScannerService.createCameraSession).toHaveBeenCalled();
    expect(document.querySelector("#deliveryVinScannerSheet").hidden).toBe(true);
    expect(document.querySelector("#deliveryManualWindshieldVinWrap").hidden).toBe(false);
    expect(document.querySelector("#deliveryStatus").textContent).toContain("Camera scan is unavailable");

    mounted.unmount();
  });

  it("shows section rail progress and issue counts for the active checklist", async () => {
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root }));

    advanceToRecords();
    document.querySelector(".delivery-status-control-issue").click();
    const recordsStep = document.querySelector("[data-section='records']");
    const setupStep = document.querySelector("[data-section='vehicle-setup']");

    expect(setupStep.textContent).toContain("Setup");
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
    expect(stylesheet).toContain("position: relative");
    expect(stylesheet).not.toContain(".scan-region-highlight");
    expect(stylesheet).not.toContain("#deliveryModelSwitch");
    expect(stylesheet).toContain("env(safe-area-inset-bottom");
    expect(stylesheet).toContain(".delivery-bottom-nav");
    expect(stylesheet).toContain("scroll-margin-bottom");
    const bottomNavBlock = stylesheet.match(/\.delivery-bottom-nav\s*\{([\s\S]*?)\n\}/)?.[1] || "";
    expect(bottomNavBlock).not.toContain("position: fixed");
    expect(bottomNavBlock).toContain("border-top");

    const root = createRoot();
    expect(root.querySelector(".delivery-checklist-header .delivery-checklist-overview")).not.toBeNull();
    expect(root.querySelector("main > .delivery-checklist-overview")).toBeNull();
    expect(root.querySelector(".delivery-vin-scan-card")).not.toBeNull();
    expect(root.querySelector("#deliveryVinScannerSheet")).not.toBeNull();
    expect(root.querySelector(".delivery-vin-video-wrap .delivery-vin-scan-frame")).not.toBeNull();
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

  it("saves a QR-scanned windshield VIN from the scanner sheet", async () => {
    const stopScanner = vi.fn();
    const destroyScanner = vi.fn();
    const qrScannerService = {
      hasCamera: vi.fn(),
      listCameras: vi.fn(),
      scanImage: vi.fn(),
      createCameraSession: vi.fn(async ({ onResult }) => ({
        start: vi.fn(async () => {
          onResult({ data: "qr:5YJYGDEE0RF000001" });
        }),
        stop: stopScanner,
        destroy: destroyScanner,
        setCamera: vi.fn(),
        isActive: vi.fn(),
      })),
    };
    const root = createRoot();
    const mounted = mountDeliveryChecklistRoute(createRouteContext({ root, qrScannerService }));

    document.querySelector("#deliveryScanVinQr").click();
    await flushPromises();

    expect(qrScannerService.createCameraSession).toHaveBeenCalledWith(expect.objectContaining({
      video: document.querySelector("#deliveryVinScannerVideo"),
      preferredCamera: "environment",
      calculateScanRegion: expect.any(Function),
      highlightScanRegion: false,
      highlightCodeOutline: false,
      onResult: expect.any(Function),
    }));
    expect(stopScanner).toHaveBeenCalled();
    expect(destroyScanner).toHaveBeenCalled();
    expect(document.querySelector("#deliveryVinScannerSheet").hidden).toBe(true);
    expect(document.querySelector("#deliveryWindshieldVinValue").textContent).toBe("5YJYGDEE0RF000001");
    expect(readStoredSession().metadata).toMatchObject({
      windshieldVin: "5YJYGDEE0RF000001",
      windshieldVinScanSource: "qr",
    });

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
    const input = document.querySelector('input[type="file"]');
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
