import "./delivery-checklist.less";

import {
  IconDownload,
  IconLogin,
  IconSave,
  IconUpload,
} from "../../icons.js";
import {
  BACKEND_AUTH_STATE_EVENT,
  isBackendUserAuthenticated,
  requestBackendAuthentication,
} from "../../shared/backend-auth.js";
import type { MountedView, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";
import {
  DELIVERY_CHECKLIST_MODELS,
  DELIVERY_CHECKLIST_SOURCE_ATTRIBUTIONS,
  buildDeliveryChecklistReport,
  createEmptyItemState,
  createSessionTitle,
  getChecklistItems,
  getChecklistModelLabel,
  getChecklistProgress,
  getChecklistSections,
  mapTeslaModelCodeToChecklistModelKey,
  normalizeChecklistModelKey,
  normalizeItemState,
  normalizeTeslaOrderForChecklist,
  type DeliveryChecklistItem,
  type DeliveryChecklistItemState,
  type DeliveryChecklistModelKey,
  type DeliveryChecklistSession,
  type DeliveryChecklistVehicleMetadata,
} from "./delivery-checklist-data.js";
import {
  createDeliveryChecklistRepository,
  type DeliveryChecklistRepository,
} from "./delivery-checklist-storage.js";
import {
  createDeliveryChecklistPhotoId,
  detectDeliveryChecklistPhotoStorage,
  getDeliveryChecklistPhoto,
  saveDeliveryChecklistPhoto,
  type DeliveryChecklistPhotoRecord,
} from "./delivery-checklist-photo-store.js";
import {
  compareDeliveryWindshieldVin,
  normalizeDeliveryVin,
  startDeliveryVinOcrScanner,
  terminateDeliveryVinOcrWorker,
  type DeliveryVinOcrDebugArtifact,
  type DeliveryVinOcrDebugReport,
  type DeliveryVinOcrMode,
  type DeliveryVinOcrRecognizer,
  type DeliveryVinScannerSession,
  type DeliveryWindshieldVinSource,
} from "./delivery-checklist-vin-scanner.js";

export const DELIVERY_CHECKLIST_ROUTE_APP_ID = "vatio.deliveryChecklist";

export type DeliveryChecklistRouteMountContext = RouteMountContext & {
  appRuntime?: VatioAppRuntime | null;
  appManifest?: VatioAppRuntime["manifest"] | null;
  appStorage?: VatioAppRuntime["storage"] | null;
  settingsService?: VatioAppRuntime["services"]["settings"] | null;
  authService?: VatioAppRuntime["services"]["auth"] | null;
  mediaDevices?: Pick<MediaDevices, "getUserMedia"> | null;
  vinOcrRecognizer?: DeliveryVinOcrRecognizer | null;
  translate?: ((key: string, fallback?: string) => string) | null;
  logger?: VatioAppRuntime["logger"] | null;
};

type ImportChoiceKind = "order" | "vehicle";
type DeliveryStepKind = "setup" | "checklist";
type SetupMode = "choice" | "manual" | "vatiolibre";

const VEHICLE_SETUP_STEP_ID = "vehicle-setup";
const VEHICLE_SETUP_STEP = {
  id: VEHICLE_SETUP_STEP_ID,
  kind: "setup" as const,
  title: "Vehicle setup",
  shortTitle: "Setup",
  description: "Choose VatioLibre import or a manual local checklist before inspection.",
};

interface DeliveryImportChoice {
  id: string;
  kind: ImportChoiceKind;
  label: string;
  raw: Record<string, any>;
  modelKey: DeliveryChecklistModelKey | null;
  metadata: DeliveryChecklistVehicleMetadata;
}

interface DeliveryGuidedStep {
  id: string;
  kind: DeliveryStepKind;
  title: string;
  shortTitle: string;
  description: string;
}

interface DeliveryChecklistDom {
  app: HTMLElement;
  langToggle: HTMLButtonElement | null;
  setupChoice: HTMLElement;
  useVatioLibreButton: HTMLButtonElement;
  useManualButton: HTMLButtonElement;
  setupDetailsPanel: HTMLElement;
  setupModelSwitch: HTMLElement;
  setupModelLock: HTMLElement;
  vinScanStatus: HTMLElement;
  windshieldVinValue: HTMLElement;
  windshieldVinCompare: HTMLElement;
  readVinOcrButton: HTMLButtonElement;
  enterVinManualButton: HTMLButtonElement;
  clearWindshieldVinButton: HTMLButtonElement;
  manualWindshieldVinWrap: HTMLElement;
  manualWindshieldVinInput: HTMLInputElement;
  exportButton: HTMLButtonElement;
  exportMenu: HTMLElement;
  exportPdfButton: HTMLButtonElement;
  exportJsonButton: HTMLButtonElement;
  exportTextButton: HTMLButtonElement;
  progressRing: HTMLElement;
  progressPercent: HTMLElement;
  sessionTitle: HTMLElement;
  progressText: HTMLElement;
  metadataForm: HTMLFormElement;
  vinInput: HTMLInputElement;
  orderInput: HTMLInputElement;
  pickupInput: HTMLInputElement;
  vehicleCard: HTMLElement;
  vehicleImage: HTMLImageElement;
  vehicleName: HTMLElement;
  vehicleDetails: HTMLElement;
  status: HTMLElement;
  importPanel: HTMLElement;
  importSummary: HTMLElement;
  importSelect: HTMLSelectElement;
  applyImportButton: HTMLButtonElement;
  setupPanel: HTMLElement;
  newSessionButton: HTMLButtonElement;
  loginButton: HTMLButtonElement;
  railProgress: HTMLElement;
  sectionTabs: HTMLElement;
  stepKicker: HTMLElement;
  sectionTitle: HTMLElement;
  sectionDescription: HTMLElement;
  issueCount: HTMLElement;
  checklistItems: HTMLElement;
  reviewPanel: HTMLElement;
  reviewSummary: HTMLElement;
  copyReportButton: HTMLButtonElement;
  printReportButton: HTMLButtonElement;
  issueList: HTMLElement;
  reportText: HTMLTextAreaElement;
  prevStepButton: HTMLButtonElement;
  nextStepButton: HTMLButtonElement;
  photoPreview: HTMLElement;
  photoPreviewCloseButton: HTMLButtonElement;
  photoPreviewImage: HTMLImageElement;
  photoPreviewCaption: HTMLElement;
  vinScannerSheet: HTMLElement;
  vinScannerVideo: HTMLVideoElement;
  vinScannerStatus: HTMLElement;
  vinScannerCloseButton: HTMLButtonElement;
  vinScannerCaptureButton: HTMLButtonElement;
  vinScannerFallbackButton: HTMLButtonElement;
  vinOcrDiagnostics: HTMLElement;
  vinOcrPreview: HTMLElement;
  vinOcrCopyDebugButton: HTMLButtonElement;
  vinOcrDownloadDebugButton: HTMLButtonElement;
  vinOcrWiderScanButton: HTMLButtonElement;
  header: HTMLElement;
  bottomNav: HTMLElement;
}

function $(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Delivery checklist element missing: ${selector}`);
  return element as HTMLElement;
}

function readDom(root: ParentNode): DeliveryChecklistDom {
  return {
    app: $(root, ".delivery-checklist-app"),
    langToggle: root.querySelector<HTMLButtonElement>("#deliveryLangToggle"),
    setupChoice: $(root, "#deliverySetupChoice"),
    useVatioLibreButton: $(root, "#deliveryUseVatioLibre") as HTMLButtonElement,
    useManualButton: $(root, "#deliveryUseManual") as HTMLButtonElement,
    setupDetailsPanel: $(root, "#deliverySetupDetailsPanel"),
    setupModelSwitch: $(root, "#deliverySetupModelSwitch"),
    setupModelLock: $(root, "#deliverySetupModelLock"),
    vinScanStatus: $(root, "#deliveryVinScanStatus"),
    windshieldVinValue: $(root, "#deliveryWindshieldVinValue"),
    windshieldVinCompare: $(root, "#deliveryWindshieldVinCompare"),
    readVinOcrButton: $(root, "#deliveryReadVinOcr") as HTMLButtonElement,
    enterVinManualButton: $(root, "#deliveryEnterVinManual") as HTMLButtonElement,
    clearWindshieldVinButton: $(root, "#deliveryClearWindshieldVin") as HTMLButtonElement,
    manualWindshieldVinWrap: $(root, "#deliveryManualWindshieldVinWrap"),
    manualWindshieldVinInput: $(root, "#deliveryManualWindshieldVin") as HTMLInputElement,
    exportButton: $(root, "#deliveryExport") as HTMLButtonElement,
    exportMenu: $(root, "#deliveryExportMenu"),
    exportPdfButton: $(root, "#deliveryExportPdf") as HTMLButtonElement,
    exportJsonButton: $(root, "#deliveryExportJson") as HTMLButtonElement,
    exportTextButton: $(root, "#deliveryExportText") as HTMLButtonElement,
    progressRing: $(root, "#deliveryProgressRing"),
    progressPercent: $(root, "#deliveryProgressPercent"),
    sessionTitle: $(root, "#deliverySessionTitle"),
    progressText: $(root, "#deliveryProgressText"),
    metadataForm: $(root, "#deliveryMetadataForm") as HTMLFormElement,
    vinInput: $(root, "#deliveryVin") as HTMLInputElement,
    orderInput: $(root, "#deliveryOrderReference") as HTMLInputElement,
    pickupInput: $(root, "#deliveryPickupLocation") as HTMLInputElement,
    vehicleCard: $(root, "#deliveryVehicleCard"),
    vehicleImage: $(root, "#deliveryVehicleImage") as HTMLImageElement,
    vehicleName: $(root, "#deliveryVehicleName"),
    vehicleDetails: $(root, "#deliveryVehicleDetails"),
    status: $(root, "#deliveryStatus"),
    importPanel: $(root, "#deliveryImportPanel"),
    importSummary: $(root, "#deliveryImportSummary"),
    importSelect: $(root, "#deliveryImportSelect") as HTMLSelectElement,
    applyImportButton: $(root, "#deliveryApplyImport") as HTMLButtonElement,
    setupPanel: $(root, "#deliverySetupPanel"),
    newSessionButton: $(root, "#deliveryNewSession") as HTMLButtonElement,
    loginButton: $(root, "#deliveryLogin") as HTMLButtonElement,
    railProgress: $(root, "#deliveryRailProgress"),
    sectionTabs: $(root, "#deliverySectionTabs"),
    stepKicker: $(root, "#deliveryStepKicker"),
    sectionTitle: $(root, "#deliverySectionTitle"),
    sectionDescription: $(root, "#deliverySectionDescription"),
    issueCount: $(root, "#deliveryIssueCount"),
    checklistItems: $(root, "#deliveryChecklistItems"),
    reviewPanel: $(root, "#deliveryReviewPanel"),
    reviewSummary: $(root, "#deliveryReviewSummary"),
    copyReportButton: $(root, "#deliveryCopyReport") as HTMLButtonElement,
    printReportButton: $(root, "#deliveryPrintReport") as HTMLButtonElement,
    issueList: $(root, "#deliveryIssueList"),
    reportText: $(root, "#deliveryReportText") as HTMLTextAreaElement,
    prevStepButton: $(root, "#deliveryPrevStep") as HTMLButtonElement,
    nextStepButton: $(root, "#deliveryNextStep") as HTMLButtonElement,
    photoPreview: $(root, "#deliveryPhotoPreview"),
    photoPreviewCloseButton: $(root, "#deliveryPhotoPreviewClose") as HTMLButtonElement,
    photoPreviewImage: $(root, "#deliveryPhotoPreviewImage") as HTMLImageElement,
    photoPreviewCaption: $(root, "#deliveryPhotoPreviewCaption"),
    vinScannerSheet: $(root, "#deliveryVinScannerSheet"),
    vinScannerVideo: $(root, "#deliveryVinScannerVideo") as HTMLVideoElement,
    vinScannerStatus: $(root, "#deliveryVinScannerStatus"),
    vinScannerCloseButton: $(root, "#deliveryVinScannerClose") as HTMLButtonElement,
    vinScannerCaptureButton: $(root, "#deliveryVinScannerCapture") as HTMLButtonElement,
    vinScannerFallbackButton: $(root, "#deliveryVinScannerFallback") as HTMLButtonElement,
    vinOcrDiagnostics: $(root, "#deliveryVinOcrDiagnostics"),
    vinOcrPreview: $(root, "#deliveryVinOcrPreview"),
    vinOcrCopyDebugButton: $(root, "#deliveryVinOcrCopyDebug") as HTMLButtonElement,
    vinOcrDownloadDebugButton: $(root, "#deliveryVinOcrDownloadDebug") as HTMLButtonElement,
    vinOcrWiderScanButton: $(root, "#deliveryVinOcrWiderScan") as HTMLButtonElement,
    header: $(root, ".delivery-checklist-header"),
    bottomNav: $(root, ".delivery-bottom-nav"),
  };
}

function setButtonIcon(button: HTMLElement | null, icon: string): void {
  const target = button?.querySelector(".btn-icon");
  if (target) target.innerHTML = icon;
}

function pickText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function metadataSummary(metadata: DeliveryChecklistVehicleMetadata): string {
  return [
    metadata.trimSummary?.slice(0, 3).join(" / "),
    metadata.deliveryDate,
    metadata.deliveryWindow,
    metadata.status,
    metadata.substatus,
  ].map((part) => String(part || "").trim()).filter(Boolean).join(" - ");
}

function normalizeVehicleForChecklist(vehicle: unknown, liveData: unknown = null): {
  modelKey: DeliveryChecklistModelKey | null;
  metadata: DeliveryChecklistVehicleMetadata;
} {
  const source = asRecord(vehicle);
  const response = asRecord(asRecord(liveData).response);
  const vehicleConfig = asRecord(response.vehicle_config);
  const vehicleState = asRecord(response.vehicle_state);
  const guiSettings = asRecord(response.gui_settings);
  const modelCode = pickText(
    source.modelCode,
    source.model_code,
    source.model,
    source.car_type,
    source.option_codes,
    vehicleConfig.car_type,
    vehicleConfig.exterior_color,
  );
  const modelKey = mapTeslaModelCodeToChecklistModelKey(modelCode)
    || mapTeslaModelCodeToChecklistModelKey(source.display_name)
    || mapTeslaModelCodeToChecklistModelKey(vehicleConfig.car_type);
  const vin = pickText(source.vin, response.vin);
  const displayName = pickText(source.display_name, response.display_name);
  const trimSummary = [
    pickText(vehicleConfig.exterior_color),
    pickText(vehicleConfig.wheel_type),
    pickText(vehicleConfig.spoiler_type),
    pickText(guiSettings.gui_distance_units),
  ].filter(Boolean);

  return {
    modelKey,
    metadata: {
      vin,
      orderReference: pickText(source.id_s, source.vehicle_id, source.id),
      modelName: displayName || getChecklistModelLabel(modelKey || "modely"),
      modelCode,
      trimSummary,
      deliveryDate: "",
      deliveryWindow: "",
      pickupLocation: "",
      status: pickText(source.state, vehicleState.vehicle_name),
      substatus: pickText(asRecord(liveData).error),
      imageUrl: "",
      source: "vatiolibre",
    },
  };
}

function makeImportChoice(kind: ImportChoiceKind, raw: unknown): DeliveryImportChoice | null {
  const source = asRecord(raw);
  const normalized = kind === "order"
    ? normalizeTeslaOrderForChecklist(source)
    : normalizeVehicleForChecklist(source);
  const metadata = normalized.metadata;
  const id = [
    kind,
    pickText(metadata.orderReference, source.referenceNumber, source.id_s, source.id, metadata.vin),
  ].filter(Boolean).join(":");

  if (!id) return null;

  return {
    id,
    kind,
    raw: source,
    modelKey: normalized.modelKey,
    metadata,
    label: [
      metadata.modelName || getChecklistModelLabel(normalized.modelKey || "modely"),
      metadata.vin || metadata.orderReference,
      metadata.status,
    ].filter(Boolean).join(" - "),
  };
}

function mergeItemStateForModel(
  modelKey: DeliveryChecklistModelKey,
  previous: DeliveryChecklistSession["itemState"] = {},
): DeliveryChecklistSession["itemState"] {
  const next = createEmptyItemState(getChecklistItems(modelKey));
  for (const item of getChecklistItems(modelKey)) {
    if (previous[item.id]) next[item.id] = normalizeItemState(previous[item.id]);
  }
  return next;
}

function setStatus(dom: DeliveryChecklistDom, message: string, tone: "idle" | "ok" | "warn" = "idle"): void {
  dom.status.textContent = message;
  dom.status.dataset.tone = tone;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  if (document.activeElement === input) return;
  input.value = value;
}

function hasInspectionProgress(targetSession: DeliveryChecklistSession): boolean {
  return Object.values(targetSession.itemState || {}).some((state) => {
    const normalized = normalizeItemState(state);
    return normalized.status !== "unchecked" || Boolean(normalized.note) || Boolean(normalized.photoIds?.length);
  });
}

function hasEditableVehicleMetadata(targetSession: DeliveryChecklistSession): boolean {
  const metadata = targetSession.metadata || {};
  return Boolean(
    String(metadata.vin || "").trim()
    || String(metadata.orderReference || "").trim()
    || String(metadata.pickupLocation || "").trim(),
  );
}

function getInitialSetupMode(targetSession: DeliveryChecklistSession): SetupMode {
  if (targetSession.metadata?.source === "vatiolibre") return "vatiolibre";
  if (hasInspectionProgress(targetSession) || hasEditableVehicleMetadata(targetSession)) return "manual";
  return "choice";
}

export function createDeliveryChecklistApp(routeContext: DeliveryChecklistRouteMountContext): MountedView {
  const dom = readDom(routeContext.root);
  const runtime = routeContext.appRuntime || null;
  const repository: DeliveryChecklistRepository = createDeliveryChecklistRepository({
    appStorage: routeContext.appStorage || null,
    settingsService: routeContext.settingsService || null,
  });
  const disposers: Array<() => void> = [];
  const expandedNotes = new Set<string>();
  const photoPreviewUrls = new Map<string, string>();
  const photoPreviewMeta = new Map<string, { name: string; size: number; type: string }>();
  const pendingPhotoLoads = new Set<string>();

  let session = repository.getActiveSession() || repository.createSession();
  let selectedSectionId = VEHICLE_SETUP_STEP_ID;
  let setupMode: SetupMode = getInitialSetupMode(session);
  let vatioLibreRequested = setupMode === "vatiolibre";
  let vinScannerSession: DeliveryVinScannerSession | null = null;
  let vinOcrDebugReport: DeliveryVinOcrDebugReport | null = null;
  let vinOcrDebugArtifacts: DeliveryVinOcrDebugArtifact[] = [];
  let vinOcrPreviewUrls: string[] = [];
  let photoStorageWritable = false;
  let importChoices: DeliveryImportChoice[] = [];
  let autoImportChecked = false;
  let importBusy = false;
  let pendingNoteSave = false;
  let noteSaveTimer: number | null = null;
  let disposed = false;

  function getActiveSectionItems(): DeliveryChecklistItem[] {
    if (isSetupStep()) return [];
    return getChecklistItems(session.modelKey, selectedSectionId);
  }

  function getActiveSectionProgress() {
    if (isSetupStep()) return getSetupProgress();
    return getChecklistProgress(session, getActiveSectionItems());
  }

  function getFirstUncheckedItem(): DeliveryChecklistItem | null {
    if (isSetupStep()) return null;
    return getActiveSectionItems().find((item) => normalizeItemState(session.itemState[item.id]).status === "unchecked") || null;
  }

  function isSetupComplete(): boolean {
    return setupMode !== "choice";
  }

  function getSetupProgress() {
    const complete = isSetupComplete() ? 1 : 0;
    return {
      total: 1,
      complete,
      passed: complete,
      issue: 0,
      skipped: 0,
      unchecked: complete ? 0 : 1,
      percent: complete ? 100 : 0,
    };
  }

  function focusSetupChoice(): void {
    dom.setupChoice.classList.remove("delivery-setup-choice--attention");
    void dom.setupChoice.offsetWidth;
    dom.setupChoice.classList.add("delivery-setup-choice--attention");
    scrollIntoGuidedViewport(dom.setupChoice);
    dom.useVatioLibreButton.focus({ preventScroll: true });
    setStatus(dom, "Choose VatioLibre import or manual local setup before continuing.", "warn");
  }

  function clearNoteSaveTimer(): void {
    if (noteSaveTimer !== null) {
      window.clearTimeout(noteSaveTimer);
      noteSaveTimer = null;
    }
  }

  function scheduleNoteSave(): void {
    pendingNoteSave = true;
    clearNoteSaveTimer();
    noteSaveTimer = window.setTimeout(() => {
      flushPendingNoteSave();
    }, 350);
  }

  function flushPendingNoteSave(): void {
    clearNoteSaveTimer();
    if (!pendingNoteSave) return;
    pendingNoteSave = false;
    saveCurrentSession(session);
  }

  function getSections() {
    return getChecklistSections(session.modelKey);
  }

  function getSteps(): DeliveryGuidedStep[] {
    return [
      VEHICLE_SETUP_STEP,
      ...getSections().map((section) => ({
        id: section.id,
        kind: "checklist" as const,
        title: section.title,
        shortTitle: section.shortTitle,
        description: section.description,
      })),
    ];
  }

  function isSetupStep(stepId: string = selectedSectionId): boolean {
    return stepId === VEHICLE_SETUP_STEP_ID;
  }

  function getCurrentStepIndex(): number {
    const steps = getSteps();
    const index = steps.findIndex((step) => step.id === selectedSectionId);
    return index >= 0 ? index : 0;
  }

  function getActiveSection() {
    return getSteps()[getCurrentStepIndex()] || getSteps()[0] || null;
  }

  function goToStep(sectionId: string, options: { validateForward?: boolean } = {}): void {
    const steps = getSteps();
    const targetIndex = steps.findIndex((section) => section.id === sectionId);
    if (targetIndex < 0) return;
    if (options.validateForward && targetIndex > getCurrentStepIndex()) {
      goRelativeStep(1);
      return;
    }
    flushPendingNoteSave();
    if (sectionId !== selectedSectionId) stopVinScanner();
    selectedSectionId = sectionId;
    render();
  }

  function goRelativeStep(delta: number, options: { validateCurrent?: boolean } = {}): void {
    flushPendingNoteSave();
    if (delta > 0 && isSetupStep() && !isSetupComplete()) {
      focusSetupChoice();
      return;
    }
    if (delta > 0 && options.validateCurrent !== false) {
      const firstMissing = getFirstUncheckedItem();
      if (firstMissing) {
        focusMissingItem(firstMissing);
        return;
      }
    }
    const steps = getSteps();
    if (!steps.length) return;
    const nextIndex = Math.min(Math.max(getCurrentStepIndex() + delta, 0), steps.length - 1);
    goToStep(steps[nextIndex].id);
  }

  function isReviewStep(): boolean {
    return selectedSectionId === "final-review";
  }

  function on<K extends keyof HTMLElementEventMap>(
    element: HTMLElement | Window | Document | null,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void {
    if (!element) return;
    element.addEventListener(type, listener as EventListener);
    disposers.push(() => element.removeEventListener(type, listener as EventListener));
  }

  function scrollIntoGuidedViewport(row: HTMLElement): void {
    row.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });

    const headerRect = dom.header.getBoundingClientRect();
    const navRect = dom.bottomNav.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    if (headerRect.height === 0 && navRect.height === 0 && rect.height === 0) return;

    const headerBottom = Math.max(headerRect.bottom, 0);
    const navTop = Math.min(navRect.top, window.innerHeight);
    const safeTop = headerBottom + 12;
    const safeBottom = navTop - 12;
    const safeHeight = Math.max(safeBottom - safeTop, 44);
    let scrollDelta = 0;

    if (rect.height > safeHeight) {
      scrollDelta = rect.top - safeTop;
    } else if (rect.bottom > safeBottom) {
      scrollDelta = rect.bottom - safeBottom;
    } else if (rect.top < safeTop) {
      scrollDelta = rect.top - safeTop;
    }

    if (navigator.userAgent.toLowerCase().includes("jsdom")) return;
    if (Math.abs(scrollDelta) > 1) {
      window.scrollBy({ top: scrollDelta, left: 0, behavior: "auto" });
    }
  }

  function focusMissingItem(item: DeliveryChecklistItem): void {
    const row = Array.from(dom.checklistItems.querySelectorAll<HTMLElement>(".delivery-item-row"))
      .find((candidate) => candidate.dataset.itemId === item.id);
    if (!row) return;
    row.classList.remove("delivery-item-row--attention");
    // Force the animation to restart when users tap the missing-items action repeatedly.
    void row.offsetWidth;
    row.classList.add("delivery-item-row--attention");
    scrollIntoGuidedViewport(row);
    row.focus({ preventScroll: true });
    setStatus(dom, "Finish the highlighted checklist item before moving on.", "warn");
  }

  function saveCurrentSession(nextSession: DeliveryChecklistSession = session): boolean {
    session = {
      ...nextSession,
      title: createSessionTitle(nextSession.modelKey, nextSession.metadata),
      updatedAt: new Date().toISOString(),
    };
    const saved = repository.saveSession(session);
    if (!saved) {
      setStatus(dom, "Could not save locally. Browser storage may be full.", "warn");
    }
    return saved;
  }

  function replaceSession(nextSession: DeliveryChecklistSession): void {
    session = nextSession;
    repository.setActiveSessionId(session.id);
    saveCurrentSession(session);
    const steps = getSteps();
    if (!steps.some((section) => section.id === selectedSectionId)) {
      selectedSectionId = VEHICLE_SETUP_STEP_ID;
    }
    render();
  }

  function updateMetadata(partial: Partial<DeliveryChecklistVehicleMetadata>): void {
    saveCurrentSession({
      ...session,
      metadata: {
        ...session.metadata,
        ...partial,
      },
    });
    renderOverview();
    renderVinScan();
    renderReview();
  }

  function updateWindshieldVin(
    value: string,
    source: DeliveryWindshieldVinSource,
    options: { scannedAt?: string } = {},
  ): void {
    const windshieldVin = normalizeDeliveryVin(value);
    const metadata: DeliveryChecklistVehicleMetadata = {
      ...session.metadata,
      windshieldVin,
      windshieldVinScannedAt: windshieldVin
        ? options.scannedAt || new Date().toISOString()
        : "",
      windshieldVinScanSource: windshieldVin ? source : undefined,
    };
    if (setupMode === "manual" && windshieldVin && !String(metadata.vin || "").trim()) {
      metadata.vin = windshieldVin;
    }
    saveCurrentSession({
      ...session,
      metadata,
    });
    renderOverview();
    renderVinScan();
    renderReview();
  }

  function clearWindshieldVin(): void {
    saveCurrentSession({
      ...session,
      metadata: {
        ...session.metadata,
        windshieldVin: "",
        windshieldVinScannedAt: "",
        windshieldVinScanSource: undefined,
      },
    });
    renderOverview();
    renderVinScan();
    renderReview();
    setStatus(dom, "Windshield VIN scan cleared.", "ok");
  }

  function updateItem(itemId: string, state: Partial<DeliveryChecklistItemState>): void {
    const existing = normalizeItemState(session.itemState[itemId]);
    const nextSession = {
      ...session,
      itemState: {
        ...session.itemState,
        [itemId]: normalizeItemState({
          ...existing,
          ...state,
          updatedAt: new Date().toISOString(),
        }),
      },
    };
    saveCurrentSession(nextSession);
    render();
  }

  function updateItemNote(itemId: string, note: string): void {
    const existing = normalizeItemState(session.itemState[itemId]);
    session = {
      ...session,
      itemState: {
        ...session.itemState,
        [itemId]: normalizeItemState({
          ...existing,
          note,
          updatedAt: new Date().toISOString(),
        }),
      },
      updatedAt: new Date().toISOString(),
    };
    scheduleNoteSave();
  }

  function switchModel(modelKey: DeliveryChecklistModelKey): void {
    const normalized = normalizeChecklistModelKey(modelKey);
    if (normalized === session.modelKey) return;
    const metadata = {
      ...session.metadata,
      modelName: getChecklistModelLabel(normalized),
    };
    replaceSession({
      ...session,
      modelKey: normalized,
      metadata,
      itemState: mergeItemStateForModel(normalized, session.itemState),
    });
  }

  function renderModelButtons(container: HTMLElement): void {
    container.replaceChildren();
    for (const model of DELIVERY_CHECKLIST_MODELS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "delivery-model-button";
      button.textContent = model.label;
      button.dataset.model = model.key;
      button.setAttribute("aria-pressed", model.key === session.modelKey ? "true" : "false");
      button.addEventListener("click", () => switchModel(model.key));
      container.append(button);
    }
  }

  function renderModelSwitch(): void {
    renderModelButtons(dom.setupModelSwitch);
  }

  function renderVinScan(): void {
    const comparison = compareDeliveryWindshieldVin(session.metadata, setupMode);
    dom.vinScanStatus.dataset.state = comparison.state;
    dom.clearWindshieldVinButton.hidden = !comparison.scannedVin;
    setInputValue(dom.manualWindshieldVinInput, comparison.scannedVin);

    if (!comparison.scannedVin) {
      dom.windshieldVinValue.textContent = "Not scanned";
      dom.windshieldVinCompare.textContent = "Scan is optional.";
      return;
    }

    dom.windshieldVinValue.textContent = comparison.scannedVin;
    if (comparison.state === "match") {
      dom.windshieldVinCompare.textContent = "Matches VatioLibre VIN.";
    } else if (comparison.state === "mismatch") {
      dom.windshieldVinCompare.textContent = `Does not match VatioLibre VIN ${comparison.backendVin}.`;
    } else if (comparison.state === "backend-unavailable") {
      dom.windshieldVinCompare.textContent = "Saved locally. VatioLibre VIN is not available to compare.";
    } else {
      dom.windshieldVinCompare.textContent = "Saved locally. Manual setup does not compare VINs.";
    }
  }

  function renderSetupPanel(): void {
    const importedFromVatioLibre = session.metadata?.source === "vatiolibre";
    const showDetails = setupMode !== "choice";
    const lockImportedModel = setupMode === "vatiolibre" && importedFromVatioLibre;

    dom.useVatioLibreButton.setAttribute("aria-pressed", setupMode === "vatiolibre" ? "true" : "false");
    dom.useManualButton.setAttribute("aria-pressed", setupMode === "manual" ? "true" : "false");
    dom.setupDetailsPanel.hidden = !showDetails;
    dom.setupModelSwitch.hidden = lockImportedModel;
    dom.setupModelLock.hidden = !lockImportedModel;
    dom.setupModelLock.textContent = lockImportedModel
      ? `${getChecklistModelLabel(session.modelKey)} imported from VatioLibre. Switch to manual setup to change the checklist model.`
      : "";
    renderVinScan();

    if (setupMode !== "vatiolibre") {
      importChoices = [];
      dom.importPanel.hidden = true;
      dom.importSummary.textContent = "";
      dom.importSelect.replaceChildren();
      dom.importSelect.hidden = true;
      dom.applyImportButton.hidden = true;
      dom.applyImportButton.disabled = true;
      dom.loginButton.hidden = true;
    }
  }

  function renderOverview(): void {
    const items = getChecklistItems(session.modelKey);
    const progress = getChecklistProgress(session, items);
    const metadata = session.metadata || {};

    dom.progressRing.style.setProperty("--delivery-progress", `${progress.percent}%`);
    dom.progressPercent.textContent = `${progress.percent}%`;
    dom.sessionTitle.textContent = session.title || `${getChecklistModelLabel(session.modelKey)} Delivery`;
    dom.progressText.textContent = `${progress.complete} of ${progress.total} complete`;
    dom.issueCount.textContent = `${progress.issue} issue${progress.issue === 1 ? "" : "s"}`;
    dom.railProgress.textContent = `${progress.complete} of ${progress.total}`;
    setInputValue(dom.vinInput, metadata.vin || "");
    setInputValue(dom.orderInput, metadata.orderReference || "");
    setInputValue(dom.pickupInput, metadata.pickupLocation || "");

    const details = metadataSummary(metadata);
    const hasVehicleCard = Boolean(
      metadata.imageUrl
      || details
      || (metadata.source === "vatiolibre" && (metadata.modelName || metadata.modelCode)),
    );
    dom.vehicleCard.hidden = !hasVehicleCard;
    dom.vehicleImage.hidden = !metadata.imageUrl;
    if (metadata.imageUrl) dom.vehicleImage.src = metadata.imageUrl;
    dom.vehicleName.textContent = metadata.modelName || getChecklistModelLabel(session.modelKey);
    dom.vehicleDetails.textContent = details || (metadata.source === "vatiolibre" ? "Imported from VatioLibre" : "");
  }

  function renderSectionTabs(): void {
    const steps = getSteps();
    dom.sectionTabs.replaceChildren();
    steps.forEach((section, index) => {
      const isSetup = section.kind === "setup";
      const items = getChecklistItems(session.modelKey, section.id);
      const progress = isSetup
        ? getSetupProgress()
        : getChecklistProgress(session, items);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "delivery-section-tab";
      button.dataset.section = section.id;
      button.dataset.status = isSetup
        ? "complete"
        : progress.issue > 0
        ? "issue"
        : progress.unchecked === 0 && progress.total > 0
          ? "complete"
          : "pending";
      button.setAttribute("aria-current", section.id === selectedSectionId ? "true" : "false");
      button.setAttribute(
        "aria-label",
        `${section.title}, step ${index + 1} of ${steps.length}, ${progress.complete} of ${progress.total} complete, ${progress.issue} issues`,
      );

      const number = document.createElement("span");
      number.className = "delivery-step-number";
      number.textContent = String(index + 1);
      const label = document.createElement("span");
      label.className = "delivery-step-label";
      label.textContent = section.shortTitle;
      const count = document.createElement("span");
      count.className = "delivery-step-count";
      count.textContent = isSetup
        ? progress.complete
          ? getChecklistModelLabel(session.modelKey)
          : "0/1"
        : `${progress.complete}/${progress.total}`;
      const issues = document.createElement("span");
      issues.className = "delivery-step-issues";
      issues.textContent = isSetup
        ? setupMode === "choice"
          ? "Choose setup"
          : session.metadata?.source === "vatiolibre"
            ? "Imported"
            : setupMode === "vatiolibre"
              ? "VatioLibre"
              : "Manual"
        : progress.issue ? `${progress.issue} issue${progress.issue === 1 ? "" : "s"}` : "No issues";

      button.append(number, label, count, issues);
      button.addEventListener("click", () => {
        goToStep(section.id, { validateForward: true });
      });
      dom.sectionTabs.append(button);
    });
  }

  function renderSectionHeader(): void {
    const sections = getSteps();
    const section = getActiveSection();
    if (!section) return;
    selectedSectionId = section.id;
    const sectionProgress = section.kind === "setup"
      ? getSetupProgress()
      : getChecklistProgress(session, getChecklistItems(session.modelKey, section.id));
    dom.stepKicker.textContent = `Step ${getCurrentStepIndex() + 1} of ${sections.length}`;
    dom.sectionTitle.textContent = section.title;
    dom.sectionDescription.textContent = section.description;
    dom.issueCount.textContent = section.kind === "setup"
      ? setupMode === "choice"
        ? "Choose setup"
        : getChecklistModelLabel(session.modelKey)
      : `${sectionProgress.complete}/${sectionProgress.total} - ${sectionProgress.issue} issue${sectionProgress.issue === 1 ? "" : "s"}`;
    dom.app.dataset.activeStep = selectedSectionId;
  }

  function rememberPhotoPreview(record: DeliveryChecklistPhotoRecord | null): string {
    if (!record?.id || !(record.blob instanceof Blob) || typeof URL.createObjectURL !== "function") return "";
    const existing = photoPreviewUrls.get(record.id);
    if (existing) return existing;
    const url = URL.createObjectURL(record.blob);
    photoPreviewUrls.set(record.id, url);
    photoPreviewMeta.set(record.id, {
      name: record.name || "Delivery photo",
      size: Number(record.size) || 0,
      type: record.type || "image",
    });
    return url;
  }

  function ensurePhotoPreview(photoId: string): void {
    if (!photoId || photoPreviewUrls.has(photoId) || pendingPhotoLoads.has(photoId)) return;
    pendingPhotoLoads.add(photoId);
    void getDeliveryChecklistPhoto(photoId)
      .then((record) => {
        pendingPhotoLoads.delete(photoId);
        const url = rememberPhotoPreview(record);
        if (url && !disposed) {
          renderItems();
          renderReview();
        }
      })
      .catch(() => {
        pendingPhotoLoads.delete(photoId);
      });
  }

  function photoCaption(photoId: string): string {
    const meta = photoPreviewMeta.get(photoId);
    if (!meta) return "Delivery photo";
    const size = meta.size > 0 ? ` - ${Math.round(meta.size / 1024)} KB` : "";
    return `${meta.name}${size}`;
  }

  function openPhotoPreview(photoId: string): void {
    const url = photoPreviewUrls.get(photoId);
    if (!url) {
      ensurePhotoPreview(photoId);
      setStatus(dom, "Loading photo preview...", "idle");
      return;
    }
    dom.photoPreviewImage.src = url;
    dom.photoPreviewImage.alt = photoCaption(photoId);
    dom.photoPreviewCaption.textContent = photoCaption(photoId);
    dom.photoPreview.hidden = false;
    dom.photoPreviewCloseButton.focus({ preventScroll: true });
  }

  function closePhotoPreview(): void {
    dom.photoPreview.hidden = true;
    dom.photoPreviewImage.removeAttribute("src");
    dom.photoPreviewCaption.textContent = "";
  }

  function clearVinOcrDebug(): void {
    for (const url of vinOcrPreviewUrls) URL.revokeObjectURL(url);
    vinOcrPreviewUrls = [];
    vinOcrDebugReport = null;
    vinOcrDebugArtifacts = [];
    dom.vinOcrDiagnostics.hidden = true;
    dom.vinOcrPreview.replaceChildren();
  }

  function createVinOcrDebugPayload() {
    return {
      report: vinOcrDebugReport,
      artifacts: vinOcrDebugArtifacts.map((artifact) => ({
        name: artifact.name,
        kind: artifact.kind,
        mimeType: artifact.mimeType,
        width: artifact.width,
        height: artifact.height,
        regionIndex: artifact.regionIndex,
        attempt: artifact.attempt,
        variant: artifact.variant,
        region: artifact.region,
        bytes: artifact.blob.size,
      })),
    };
  }

  function renderVinOcrDiagnostics(): void {
    for (const url of vinOcrPreviewUrls) URL.revokeObjectURL(url);
    vinOcrPreviewUrls = [];
    dom.vinOcrPreview.replaceChildren();

    if (!vinOcrDebugReport) {
      dom.vinOcrDiagnostics.hidden = true;
      return;
    }

    const previewArtifacts = [
      ...vinOcrDebugArtifacts.filter((artifact) => artifact.kind === "source").slice(0, 1),
      ...vinOcrDebugArtifacts.filter((artifact) => artifact.kind === "region").slice(0, 1),
      ...vinOcrDebugArtifacts.filter((artifact) => artifact.kind === "processed").slice(0, 2),
    ];
    for (const artifact of previewArtifacts) {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      const caption = document.createElement("figcaption");
      const url = URL.createObjectURL(artifact.blob);
      vinOcrPreviewUrls.push(url);
      image.src = url;
      image.alt = artifact.name;
      caption.textContent = artifact.name.replace(/\.png$/i, "");
      figure.append(image, caption);
      dom.vinOcrPreview.append(figure);
    }

    dom.vinOcrDiagnostics.hidden = false;
  }

  async function copyVinOcrDebugJson(): Promise<void> {
    if (!vinOcrDebugReport) return;
    const json = JSON.stringify(createVinOcrDebugPayload(), null, 2);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
      await navigator.clipboard.writeText(json);
      dom.vinScannerStatus.textContent = "OCR debug JSON copied.";
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = json;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand?.("copy");
      textarea.remove();
      dom.vinScannerStatus.textContent = "OCR debug JSON copied.";
    }
  }

  function downloadVinOcrDebugArtifacts(): void {
    if (!vinOcrDebugReport) return;
    const stamp = vinOcrDebugReport.startedAt.replace(/[^0-9T]/g, "").slice(0, 15) || Date.now().toString();
    downloadBlob(
      new Blob([JSON.stringify(createVinOcrDebugPayload(), null, 2)], { type: "application/json" }),
      `delivery-vin-ocr-${stamp}-debug.json`,
    );
    for (const artifact of vinOcrDebugArtifacts) {
      downloadBlob(artifact.blob, `delivery-vin-ocr-${stamp}-${artifact.name}`);
    }
    dom.vinScannerStatus.textContent = "OCR debug files downloaded.";
  }

  function stopVinScanner(): void {
    vinScannerSession?.destroy();
    vinScannerSession = null;
    dom.vinScannerSheet.hidden = true;
    dom.vinScannerStatus.textContent = "Align the VIN text, not the logo, inside the upper frame, then tap Read VIN.";
    dom.readVinOcrButton.disabled = false;
    dom.vinScannerCaptureButton.disabled = false;
    dom.vinScannerCaptureButton.textContent = "Read VIN";
    clearVinOcrDebug();
  }

  function showManualVinEntry(): void {
    dom.manualWindshieldVinWrap.hidden = false;
    dom.manualWindshieldVinInput.focus({ preventScroll: true });
  }

  async function openVinScanner(): Promise<void> {
    stopVinScanner();
    dom.vinScannerSheet.hidden = false;
    dom.vinScannerStatus.textContent = "Starting camera...";
    dom.readVinOcrButton.disabled = true;
    dom.vinScannerCaptureButton.disabled = true;
    try {
      vinScannerSession = await startDeliveryVinOcrScanner({
        video: dom.vinScannerVideo,
        permissions: runtime?.permissions || null,
        mediaDevices: routeContext.mediaDevices || navigator.mediaDevices,
        recognize: routeContext.vinOcrRecognizer || undefined,
        onProgress: ({ status, progress }) => {
          const percent = progress > 0 ? ` ${Math.round(progress * 100)}%` : "";
          dom.vinScannerStatus.textContent = `${status}${percent}`;
        },
      });
      dom.vinScannerStatus.textContent = "Align the VIN text, not the logo, inside the upper frame, then tap Read VIN.";
      dom.vinScannerCaptureButton.disabled = false;
    } catch (error) {
      routeContext.logger?.warn("Delivery checklist VIN OCR camera failed.", error);
      stopVinScanner();
      showManualVinEntry();
      setStatus(dom, "Camera OCR is unavailable here. Enter the windshield VIN manually.", "warn");
    }
  }

  async function captureVinScanner(mode: DeliveryVinOcrMode = "frame-then-search"): Promise<void> {
    if (!vinScannerSession) return;
    clearVinOcrDebug();
    dom.vinScannerCaptureButton.disabled = true;
    dom.vinOcrWiderScanButton.disabled = true;
    dom.vinScannerCaptureButton.textContent = "Reading...";
    try {
      const artifacts: DeliveryVinOcrDebugArtifact[] = [];
      const result = await vinScannerSession.capture({
        mode,
        debug: true,
        debugLabel: "delivery-checklist-camera",
        onDebugArtifact: (artifact) => {
          artifacts.push(artifact);
        },
        onDebugReport: (report) => {
          vinOcrDebugReport = report;
        },
      });
      vinOcrDebugArtifacts = artifacts;
      vinOcrDebugReport = result.debug || vinOcrDebugReport;
      if (result.vin) {
        updateWindshieldVin(result.vin, "ocr");
        setStatus(dom, "Windshield VIN read and saved locally.", "ok");
        stopVinScanner();
        return;
      }
      dom.vinScannerStatus.textContent = "Could not read a valid VIN. Move closer, keep the VIN inside the frame, and try again.";
      setStatus(dom, "No valid VIN found in the camera frame.", "warn");
      renderVinOcrDiagnostics();
    } catch (error) {
      routeContext.logger?.warn("Delivery checklist VIN OCR failed.", error);
      dom.vinScannerStatus.textContent = "Could not read the VIN. Try again or enter it manually.";
      setStatus(dom, "VIN OCR failed; manual entry is still available.", "warn");
      renderVinOcrDiagnostics();
    } finally {
      if (vinScannerSession?.isActive()) {
        dom.vinScannerCaptureButton.disabled = false;
        dom.vinScannerCaptureButton.textContent = "Read VIN";
        dom.vinOcrWiderScanButton.disabled = false;
      }
    }
  }

  function createPhotoThumb(photoId: string, compact = false): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = compact ? "delivery-photo-thumb delivery-photo-thumb-compact" : "delivery-photo-thumb";
    button.setAttribute("aria-label", `Open ${photoCaption(photoId)}`);
    const url = photoPreviewUrls.get(photoId);
    if (url) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      image.loading = "lazy";
      button.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.textContent = "Photo";
      button.append(placeholder);
      ensurePhotoPreview(photoId);
    }
    button.addEventListener("click", () => openPhotoPreview(photoId));
    return button;
  }

  function createPhotoGallery(photoIds: string[] = [], compact = false): HTMLElement | null {
    const ids = photoIds.filter(Boolean);
    if (!ids.length) return null;
    const gallery = document.createElement("div");
    gallery.className = compact ? "delivery-photo-gallery delivery-photo-gallery-compact" : "delivery-photo-gallery";
    for (const photoId of ids) {
      gallery.append(createPhotoThumb(photoId, compact));
    }
    return gallery;
  }

  function createStatusButton(item: DeliveryChecklistItem, state: DeliveryChecklistItemState, status: DeliveryChecklistItemState["status"], label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `delivery-status-control delivery-status-control-${status}`;
    button.textContent = label;
    button.dataset.status = status;
    button.setAttribute("aria-pressed", state.status === status ? "true" : "false");
    button.addEventListener("click", () => {
      const nextStatus = state.status === status ? "unchecked" : status;
      if (nextStatus === "issue") expandedNotes.add(item.id);
      updateItem(item.id, { status: nextStatus });
    });
    return button;
  }

  function createItemRow(item: DeliveryChecklistItem): HTMLElement {
    const state = normalizeItemState(session.itemState[item.id]);
    const row = document.createElement("article");
    row.className = "delivery-item-row";
    row.tabIndex = -1;
    row.dataset.itemId = item.id;
    row.dataset.status = state.status;
    row.dataset.critical = item.critical ? "true" : "false";

    const main = document.createElement("div");
    main.className = "delivery-item-main";

    const title = document.createElement("h3");
    title.textContent = item.title;
    main.append(title);

    const meta = document.createElement("div");
    meta.className = "delivery-item-meta";
    if (item.critical) {
      const critical = document.createElement("span");
      critical.textContent = "Critical";
      critical.className = "delivery-item-badge";
      meta.append(critical);
    }
    if (item.requiresUnlocked) {
      const unlocked = document.createElement("span");
      unlocked.textContent = "Unlocked";
      unlocked.className = "delivery-item-badge";
      meta.append(unlocked);
    }
    if (state.photoIds?.length) {
      const photos = document.createElement("span");
      photos.textContent = `${state.photoIds.length} photo${state.photoIds.length === 1 ? "" : "s"}`;
      photos.className = "delivery-item-badge";
      meta.append(photos);
    }
    if (meta.children.length) main.append(meta);

    if (item.helper) {
      const helper = document.createElement("p");
      helper.className = "delivery-item-helper";
      helper.textContent = item.helper;
      main.append(helper);
    }

    const controls = document.createElement("div");
    controls.className = "delivery-item-controls";
    controls.append(
      createStatusButton(item, state, "pass", "Pass"),
      createStatusButton(item, state, "issue", "Issue"),
      createStatusButton(item, state, "skip", "Skip"),
    );

    const noteButton = document.createElement("button");
    noteButton.type = "button";
    noteButton.className = "delivery-note-toggle";
    noteButton.textContent = "Note";
    noteButton.setAttribute("aria-pressed", expandedNotes.has(item.id) || state.status === "issue" || Boolean(state.note) ? "true" : "false");
    noteButton.addEventListener("click", () => {
      if (expandedNotes.has(item.id)) expandedNotes.delete(item.id);
      else expandedNotes.add(item.id);
      renderItems();
    });
    controls.append(noteButton);

    if (photoStorageWritable) {
      const photoButton = document.createElement("button");
      photoButton.type = "button";
      photoButton.className = "delivery-photo-button";
      photoButton.textContent = "Photo";
      photoButton.addEventListener("click", () => attachPhoto(item.id));
      controls.append(photoButton);
    }

    const noteWrap = document.createElement("div");
    noteWrap.className = "delivery-note-wrap";
    const showNote = state.status === "issue" || expandedNotes.has(item.id) || Boolean(state.note);
    noteWrap.hidden = !showNote;
    const note = document.createElement("textarea");
    note.value = state.note || "";
    note.placeholder = "Add advisor-ready notes";
    note.spellcheck = true;
    note.addEventListener("input", () => updateItemNote(item.id, note.value));
    note.addEventListener("blur", flushPendingNoteSave);
    noteWrap.append(note);

    const photoGallery = createPhotoGallery(state.photoIds || []);

    row.append(main, controls, noteWrap);
    if (photoGallery) row.append(photoGallery);
    return row;
  }

  function renderItems(): void {
    dom.checklistItems.replaceChildren();
    dom.setupPanel.hidden = !isSetupStep();
    dom.checklistItems.hidden = isSetupStep();
    if (isSetupStep()) return;
    for (const item of getChecklistItems(session.modelKey, selectedSectionId)) {
      dom.checklistItems.append(createItemRow(item));
    }
  }

  function renderReview(): void {
    const items = getChecklistItems(session.modelKey);
    const progress = getChecklistProgress(session, items);
    const issues = items.filter((item) => normalizeItemState(session.itemState[item.id]).status === "issue");
    const active = isReviewStep();
    dom.reviewPanel.hidden = !active;
    dom.reviewSummary.textContent = `${progress.issue} issue${progress.issue === 1 ? "" : "s"} - ${progress.percent}% complete`;
    dom.issueList.replaceChildren();

    if (issues.length === 0) {
      const empty = document.createElement("p");
      empty.className = "delivery-empty-review";
      empty.textContent = "No issues marked yet.";
      dom.issueList.append(empty);
    } else {
      for (const item of issues) {
        const state = normalizeItemState(session.itemState[item.id]);
        const entry = document.createElement("div");
        entry.className = "delivery-issue-entry";
        const title = document.createElement("strong");
        title.textContent = item.title;
        const note = document.createElement("p");
        note.textContent = state.note || "No note yet.";
        const photos = document.createElement("span");
        photos.textContent = `${state.photoIds?.length || 0} photo${state.photoIds?.length === 1 ? "" : "s"}`;
        entry.append(title, note, photos);
        const gallery = createPhotoGallery(state.photoIds || [], true);
        if (gallery) entry.append(gallery);
        dom.issueList.append(entry);
      }
    }

    dom.reportText.value = buildReportText();
  }

  function renderNavigation(): void {
    const sections = getSteps();
    const currentIndex = getCurrentStepIndex();
    const isFirst = currentIndex <= 0;
    const isLast = currentIndex >= sections.length - 1;
    const previousSection = sections[currentIndex - 1];
    const nextSection = sections[currentIndex + 1];
    const sectionProgress = getActiveSectionProgress();

    dom.prevStepButton.disabled = isFirst;
    dom.prevStepButton.hidden = isFirst;
    dom.prevStepButton.textContent = previousSection ? `Previous: ${previousSection.shortTitle}` : "Previous";
    dom.prevStepButton.dataset.available = isFirst ? "false" : "true";
    dom.nextStepButton.disabled = isLast && sectionProgress.unchecked === 0;
    dom.nextStepButton.dataset.mode = sectionProgress.unchecked > 0 ? "missing" : "next";
    dom.nextStepButton.textContent = isSetupStep() && !isSetupComplete()
      ? "Choose setup option"
      : sectionProgress.unchecked > 0
      ? `Finish ${sectionProgress.unchecked} missing`
      : nextSection
        ? `Next: ${nextSection.shortTitle}`
        : "Review Complete";
  }

  function render(): void {
    if (disposed) return;
    renderModelSwitch();
    renderSetupPanel();
    renderOverview();
    renderSectionTabs();
    renderSectionHeader();
    renderItems();
    renderReview();
    renderNavigation();
  }

  async function attachPhoto(itemId: string): Promise<void> {
    if (!photoStorageWritable) {
      setStatus(dom, "Photo storage is unavailable here. Notes still save locally.", "warn");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.append(input);

    const cleanup = () => input.remove();
    input.addEventListener("change", async () => {
      const file = input.files?.[0] || null;
      cleanup();
      if (!file) return;
      const id = createDeliveryChecklistPhotoId(session.id, itemId);
      const record = await saveDeliveryChecklistPhoto({
        id,
        sessionId: session.id,
        itemId,
        blob: file,
        name: file.name,
      });
      if (!record) {
        setStatus(dom, "Could not save that photo. The issue note is still local.", "warn");
        return;
      }
      rememberPhotoPreview(record);
      const state = normalizeItemState(session.itemState[itemId]);
      updateItem(itemId, {
        photoIds: [...(state.photoIds || []), record.id],
      });
      setStatus(dom, "Photo saved locally.", "ok");
    }, { once: true });

    input.click();
  }

  function readMetadataForm(): Partial<DeliveryChecklistVehicleMetadata> {
    return {
      vin: dom.vinInput.value.trim(),
      orderReference: dom.orderInput.value.trim(),
      pickupLocation: dom.pickupInput.value.trim(),
    };
  }

  function hasUserVehicleMetadata(): boolean {
    const metadata = session.metadata || {};
    return Boolean(
      metadata.source === "vatiolibre"
      || String(metadata.vin || "").trim()
      || String(metadata.orderReference || "").trim()
      || String(metadata.pickupLocation || "").trim(),
    );
  }

  function chooseManualSetup(): void {
    flushPendingNoteSave();
    setupMode = "manual";
    vatioLibreRequested = false;
    importChoices = [];
    autoImportChecked = false;
    const windshieldVin = normalizeDeliveryVin(session.metadata?.windshieldVin);
    saveCurrentSession({
      ...session,
      metadata: {
        ...session.metadata,
        source: "manual",
        modelName: session.metadata?.modelName || getChecklistModelLabel(session.modelKey),
        vin: session.metadata?.vin || windshieldVin || "",
      },
    });
    setStatus(dom, "Manual local setup selected.", "ok");
    render();
  }

  function chooseVatioLibreSetup(): void {
    setupMode = "vatiolibre";
    vatioLibreRequested = true;
    render();
    void loadVatioLibreImports({ force: true });
  }

  function createNewSession(): void {
    flushPendingNoteSave();
    const next = repository.createSession({
      modelKey: session.modelKey,
      metadata: {
        source: "manual",
        modelName: getChecklistModelLabel(session.modelKey),
      },
    });
    selectedSectionId = VEHICLE_SETUP_STEP_ID;
    session = next;
    setupMode = "choice";
    vatioLibreRequested = false;
    importChoices = [];
    autoImportChecked = false;
    setStatus(dom, "New local checklist started.", "ok");
    render();
  }

  function buildExportBaseName(extension: string): string {
    return `${session.title || "tesla-delivery-checklist"}.${extension}`
      .replace(/[^a-z0-9_.-]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || `tesla-delivery-checklist.${extension}`;
  }

  function buildReportText(): string {
    return [
      buildDeliveryChecklistReport(session),
      "",
      "Sources used for checklist structure:",
      ...DELIVERY_CHECKLIST_SOURCE_ATTRIBUTIONS.map((source) => `- ${source.title}: ${source.url}`),
    ].join("\n");
  }

  function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportJson(): void {
    flushPendingNoteSave();
    const data = JSON.stringify(session, null, 2);
    downloadBlob(new Blob([data], { type: "application/json" }), buildExportBaseName("json"));
    setStatus(dom, "Checklist JSON exported.", "ok");
  }

  function escapePdfString(value: string): string {
    return value
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function wrapPdfLine(line: string, maxLength = 88): string[] {
    const words = line.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if (!word) continue;
      if (!current) {
        current = word;
      } else if (`${current} ${word}`.length <= maxLength) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  }

  function createPdfBlob(title: string, report: string): Blob {
    const rawLines = [title, "", ...report.split(/\r?\n/)];
    const lines = rawLines.flatMap((line) => wrapPdfLine(line));
    const pageLineCount = 48;
    const pages: string[][] = [];
    for (let index = 0; index < lines.length; index += pageLineCount) {
      pages.push(lines.slice(index, index + pageLineCount));
    }
    if (!pages.length) pages.push([]);

    const objects: string[] = [];
    const pageIds: number[] = [];
    let nextObjectId = 4;

    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

    for (const pageLines of pages) {
      const pageId = nextObjectId;
      const contentId = nextObjectId + 1;
      nextObjectId += 2;
      pageIds.push(pageId);
      const text = [
        "BT",
        "/F1 11 Tf",
        "50 760 Td",
        "14 TL",
        ...pageLines.map((line) => `(${escapePdfString(line)}) Tj\nT*`),
        "ET",
      ].join("\n");
      objects[contentId] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    }

    objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    const byteLength = (value: string) => new TextEncoder().encode(value).length;
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [0];
    for (let id = 1; id < objects.length; id += 1) {
      if (!objects[id]) continue;
      offsets[id] = byteLength(pdf);
      pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xrefOffset = byteLength(pdf);
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id += 1) {
      const offset = offsets[id] || 0;
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return new Blob([pdf], { type: "application/pdf" });
  }

  function exportText(): void {
    flushPendingNoteSave();
    downloadBlob(new Blob([buildReportText()], { type: "text/plain;charset=utf-8" }), buildExportBaseName("txt"));
    setStatus(dom, "Checklist text report exported.", "ok");
  }

  function exportPdf(): void {
    flushPendingNoteSave();
    downloadBlob(
      createPdfBlob(session.title || "Tesla Delivery Checklist", buildReportText()),
      buildExportBaseName("pdf"),
    );
    setStatus(dom, "Checklist PDF report exported.", "ok");
  }

  async function copyReport(): Promise<void> {
    flushPendingNoteSave();
    const report = dom.reportText.value || buildReportText();
    try {
      await navigator.clipboard?.writeText(report);
      setStatus(dom, "Report copied.", "ok");
    } catch {
      dom.reportText.focus();
      dom.reportText.select();
      document.execCommand?.("copy");
      setStatus(dom, "Report selected for copying.", "ok");
    }
  }

  function closeExportMenu(): void {
    dom.exportMenu.hidden = true;
    dom.exportButton.setAttribute("aria-expanded", "false");
  }

  function toggleExportMenu(): void {
    const open = dom.exportMenu.hidden;
    dom.exportMenu.hidden = !open;
    dom.exportButton.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function requestLogin(): void {
    setupMode = "vatiolibre";
    vatioLibreRequested = true;
    renderSetupPanel();
    requestBackendAuthentication({
      authPromptMode: "required",
      promptAuth: true,
      source: "delivery-checklist",
    });
  }

  function showLoginPrompt(summary = "Log in to import from VatioLibre. Manual setup still works offline."): void {
    importChoices = [];
    dom.importPanel.hidden = false;
    dom.importSummary.textContent = summary;
    dom.importSelect.replaceChildren();
    dom.importSelect.hidden = true;
    dom.applyImportButton.hidden = true;
    dom.applyImportButton.disabled = true;
    dom.loginButton.hidden = false;
  }

  function showImportChoices(summary: string, choices: DeliveryImportChoice[]): void {
    importChoices = choices;
    dom.importPanel.hidden = false;
    dom.importSummary.textContent = summary;
    dom.importSelect.replaceChildren();
    for (const choice of choices) {
      const option = document.createElement("option");
      option.value = choice.id;
      option.textContent = choice.label;
      dom.importSelect.append(option);
    }
    dom.importSelect.hidden = choices.length === 0;
    dom.applyImportButton.hidden = choices.length === 0;
    dom.applyImportButton.disabled = choices.length === 0;
    dom.loginButton.hidden = true;
  }

  async function loadVatioLibreImports({
    automatic = false,
    force = false,
  }: { automatic?: boolean; force?: boolean } = {}): Promise<void> {
    if (importBusy || disposed) return;
    if (automatic && autoImportChecked && !force) return;
    if (automatic) autoImportChecked = true;
    setupMode = "vatiolibre";
    vatioLibreRequested = true;
    const auth = routeContext.authService;
    if (!auth?.getTeslaConnectionStatus) {
      showImportChoices("VatioLibre is not available in this session. Continue manually.", []);
      setStatus(dom, "Manual checklist mode is active.", "warn");
      return;
    }

    importBusy = true;
    dom.importPanel.hidden = false;
    dom.importSummary.textContent = "Checking VatioLibre Tesla connection...";
    dom.importSelect.hidden = true;
    dom.applyImportButton.hidden = true;
    dom.loginButton.hidden = true;
    setStatus(dom, "Checking VatioLibre Tesla connection...", "idle");
    try {
      const status = asRecord(await auth.getTeslaConnectionStatus({ force: true }));
      if (status.localOnly || status.isGuest || status.connected === false || status.authenticated === false) {
        if (!status.localOnly && (status.isGuest || status.authenticated === false)) {
          showLoginPrompt();
        } else {
          showImportChoices("Tesla data is not connected for this VatioLibre session. Continue manually.", []);
        }
        setStatus(dom, "Manual checklist mode is active.", "warn");
        return;
      }

      const ordersResult = asRecord(await auth.listTeslaOrders?.({ forceRefresh: true }));
      const orders = Array.isArray(ordersResult.orders) ? ordersResult.orders : [];
      const orderChoices = orders
        .map((order) => makeImportChoice("order", order))
        .filter((choice): choice is DeliveryImportChoice => Boolean(choice));

      if (orderChoices.length) {
        if (orderChoices.length === 1 && !hasUserVehicleMetadata()) {
          await applyImportChoice(orderChoices[0], { automatic: true });
        } else {
          showImportChoices("Select an order to prefill the checklist. Nothing syncs back.", orderChoices);
          setStatus(dom, "VatioLibre orders loaded.", "ok");
        }
        return;
      }

      const vehiclesResult = asRecord(await auth.listTeslaVehicles?.({ forceRefresh: true }));
      const vehicles = Array.isArray(vehiclesResult.vehicles) ? vehiclesResult.vehicles : [];
      const vehicleChoices = vehicles
        .map((vehicle) => makeImportChoice("vehicle", vehicle))
        .filter((choice): choice is DeliveryImportChoice => Boolean(choice));
      if (vehicleChoices.length === 1 && !hasUserVehicleMetadata()) {
        await applyImportChoice(vehicleChoices[0], { automatic: true });
      } else {
        showImportChoices(
          vehicleChoices.length
            ? "Select a vehicle to prefill the checklist. Sleeping vehicles will not be woken."
            : "No supported Tesla orders or vehicles were found. Continue manually.",
          vehicleChoices,
        );
        setStatus(
          dom,
          vehicleChoices.length ? "VatioLibre vehicles loaded." : "No importable Tesla data found.",
          vehicleChoices.length ? "ok" : "warn",
        );
      }
    } catch (error) {
      routeContext.logger?.warn("Delivery checklist import failed.", error);
      showImportChoices("Could not load VatioLibre Tesla data. Continue manually.", []);
      setStatus(dom, "Import failed; manual checklist mode is still available.", "warn");
    } finally {
      importBusy = false;
    }
  }

  async function applyImportChoice(
    selectedChoice: DeliveryImportChoice | null = null,
    { automatic = false }: { automatic?: boolean } = {},
  ): Promise<void> {
    const choice = selectedChoice || importChoices.find((candidate) => candidate.id === dom.importSelect.value) || null;
    if (!choice) return;

    let normalized = {
      modelKey: choice.modelKey,
      metadata: choice.metadata,
    };

    if (choice.kind === "vehicle" && routeContext.authService?.getTeslaVehicleData) {
      const vehicleId = pickText(choice.raw.id, choice.raw.vehicle_id, choice.raw.id_s);
      if (vehicleId) {
        const liveData = await routeContext.authService.getTeslaVehicleData({
          vehicleId,
          skipWake: true,
        });
        normalized = normalizeVehicleForChecklist(choice.raw, liveData);
      }
    }

    const modelKey = normalized.modelKey || session.modelKey;
    const metadata = {
      ...session.metadata,
      ...normalized.metadata,
      source: "vatiolibre" as const,
    };
    setupMode = "vatiolibre";
    vatioLibreRequested = true;
    replaceSession({
      ...session,
      modelKey,
      metadata,
      itemState: mergeItemStateForModel(modelKey, session.itemState),
    });
    showImportChoices(
      automatic
        ? "Imported the only matching VatioLibre vehicle/order. Nothing syncs back."
        : "Imported metadata saved locally. You can edit it here.",
      [],
    );
    setStatus(dom, automatic ? "VatioLibre metadata imported automatically." : "Imported metadata saved locally. You can edit it here.", "ok");
  }

  setButtonIcon(dom.exportButton, IconDownload);
  setButtonIcon(dom.applyImportButton, IconUpload);
  setButtonIcon(dom.loginButton, IconLogin);
  setButtonIcon(dom.readVinOcrButton, IconUpload);
  setButtonIcon(dom.copyReportButton, IconSave);
  setButtonIcon(dom.printReportButton, IconDownload);

  on(dom.metadataForm, "input", () => updateMetadata(readMetadataForm()));
  on(dom.readVinOcrButton, "click", () => void openVinScanner());
  on(dom.enterVinManualButton, "click", showManualVinEntry);
  on(dom.clearWindshieldVinButton, "click", clearWindshieldVin);
  on(dom.manualWindshieldVinInput, "input", () => {
    const normalized = normalizeDeliveryVin(dom.manualWindshieldVinInput.value);
    if (dom.manualWindshieldVinInput.value !== normalized) {
      dom.manualWindshieldVinInput.value = normalized;
    }
    if (!normalized) {
      clearWindshieldVin();
    } else if (normalized.length === 17) {
      updateWindshieldVin(normalized, "manual");
      setStatus(dom, "Windshield VIN saved locally.", "ok");
    }
  });
  on(dom.useManualButton, "click", chooseManualSetup);
  on(dom.useVatioLibreButton, "click", chooseVatioLibreSetup);
  on(dom.newSessionButton, "click", createNewSession);
  on(dom.applyImportButton, "click", () => void applyImportChoice());
  on(dom.loginButton, "click", requestLogin);
  on(dom.exportButton, "click", (event) => {
    event.stopPropagation();
    toggleExportMenu();
  });
  on(dom.exportMenu, "click", (event) => event.stopPropagation());
  on(dom.exportPdfButton, "click", () => {
    exportPdf();
    closeExportMenu();
  });
  on(dom.exportJsonButton, "click", () => {
    exportJson();
    closeExportMenu();
  });
  on(dom.exportTextButton, "click", () => {
    exportText();
    closeExportMenu();
  });
  on(dom.copyReportButton, "click", () => void copyReport());
  on(dom.printReportButton, "click", () => window.print());
  on(dom.prevStepButton, "click", () => goRelativeStep(-1));
  on(dom.nextStepButton, "click", () => goRelativeStep(1));
  on(dom.photoPreviewCloseButton, "click", closePhotoPreview);
  on(dom.photoPreview, "click", (event) => {
    if (event.target === dom.photoPreview) closePhotoPreview();
  });
  on(dom.vinScannerCloseButton, "click", stopVinScanner);
  on(dom.vinScannerCaptureButton, "click", () => void captureVinScanner());
  on(dom.vinOcrCopyDebugButton, "click", () => void copyVinOcrDebugJson());
  on(dom.vinOcrDownloadDebugButton, "click", downloadVinOcrDebugArtifacts);
  on(dom.vinOcrWiderScanButton, "click", () => void captureVinScanner("search"));
  on(dom.vinScannerFallbackButton, "click", () => {
    stopVinScanner();
    showManualVinEntry();
  });
  on(dom.vinScannerSheet, "click", (event) => {
    if (event.target === dom.vinScannerSheet) stopVinScanner();
  });
  on(document, "keydown", (event) => {
    if (event.key === "Escape" && !dom.photoPreview.hidden) closePhotoPreview();
    if (event.key === "Escape" && !dom.vinScannerSheet.hidden) stopVinScanner();
    if (event.key === "Escape" && !dom.exportMenu.hidden) closeExportMenu();
  });
  on(document, "click", closeExportMenu);
  on(dom.langToggle, "click", () => {
    const language = runtime?.i18n.toggleLanguage?.() || runtime?.i18n.getLanguage?.() || "en";
    if (dom.langToggle) dom.langToggle.textContent = language.toUpperCase();
  });

  const handleBackendAuthState = (event: Event): void => {
    if (!vatioLibreRequested || setupMode !== "vatiolibre") return;
    const detail = event instanceof CustomEvent ? event.detail : null;
    if (!isBackendUserAuthenticated(detail)) return;
    autoImportChecked = false;
    void loadVatioLibreImports({ automatic: true, force: true });
  };
  window.addEventListener(BACKEND_AUTH_STATE_EVENT, handleBackendAuthState);
  disposers.push(() => window.removeEventListener(BACKEND_AUTH_STATE_EVENT, handleBackendAuthState));

  const unsubscribeLanguage = runtime?.i18n.subscribe?.((language) => {
    if (dom.langToggle) dom.langToggle.textContent = language.toUpperCase();
    runtime.i18n.apply(routeContext.root);
  });
  if (unsubscribeLanguage) disposers.push(unsubscribeLanguage);
  if (dom.langToggle) dom.langToggle.textContent = runtime?.i18n.getLanguage?.().toUpperCase?.() || "EN";

  detectDeliveryChecklistPhotoStorage()
    .then((snapshot) => {
      photoStorageWritable = snapshot.indexedDbWritable;
      if (!photoStorageWritable) {
        dom.app.dataset.photoStorage = "unavailable";
        setStatus(dom, "Photo attachments are unavailable here; statuses and notes still save locally.", "warn");
      }
      renderItems();
      renderReview();
    })
    .catch(() => {
      photoStorageWritable = false;
      dom.app.dataset.photoStorage = "unavailable";
      renderItems();
    });

  setStatus(dom, "Saved locally in this browser.", "idle");
  runtime?.i18n.apply(routeContext.root);
  render();

  return {
    unmount() {
      disposed = true;
      stopVinScanner();
      void terminateDeliveryVinOcrWorker();
      flushPendingNoteSave();
      for (const url of photoPreviewUrls.values()) {
        URL.revokeObjectURL?.(url);
      }
      photoPreviewUrls.clear();
      for (const dispose of disposers.splice(0)) dispose();
    },
  };
}

export function mountDeliveryChecklistRoute(routeContext: DeliveryChecklistRouteMountContext): MountedView {
  return createDeliveryChecklistApp(routeContext);
}

export function unmountDeliveryChecklistRoute(): void {
  // The mounted view returned by createDeliveryChecklistApp owns cleanup.
}
