export const DELIVERY_CHECKLIST_APP_ID = "vatio.deliveryChecklist";

import { normalizeDeliveryVin } from "./delivery-checklist-vin-scanner.js";

export type DeliveryChecklistModelKey = "model3" | "modely" | "cybertruck";
export type DeliveryChecklistItemStatus = "unchecked" | "pass" | "issue" | "skip";

export interface DeliveryChecklistModelOption {
  key: DeliveryChecklistModelKey;
  label: string;
  shortLabel: string;
  teslaModelCodes: string[];
}

export interface DeliveryChecklistSection {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
}

export interface DeliveryChecklistItem {
  id: string;
  sectionId: string;
  title: string;
  helper?: string;
  appliesTo?: DeliveryChecklistModelKey[];
  requiresUnlocked?: boolean;
  critical?: boolean;
}

export interface DeliveryChecklistItemState {
  status: DeliveryChecklistItemStatus;
  note?: string;
  photoIds?: string[];
  updatedAt?: string;
}

export interface DeliveryChecklistVehicleMetadata {
  vin?: string;
  orderReference?: string;
  modelName?: string;
  modelCode?: string;
  trimSummary?: string[];
  deliveryDate?: string;
  deliveryWindow?: string;
  pickupLocation?: string;
  status?: string;
  substatus?: string;
  imageUrl?: string;
  windshieldVin?: string;
  windshieldVinScannedAt?: string;
  windshieldVinScanSource?: "ocr" | "qr" | "manual";
  source?: "manual" | "vatiolibre";
}

export interface DeliveryChecklistSession {
  id: string;
  version: number;
  modelKey: DeliveryChecklistModelKey;
  title: string;
  metadata: DeliveryChecklistVehicleMetadata;
  itemState: Record<string, DeliveryChecklistItemState>;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryChecklistProgress {
  total: number;
  complete: number;
  passed: number;
  issue: number;
  skipped: number;
  unchecked: number;
  percent: number;
}

export const DELIVERY_CHECKLIST_SESSION_VERSION = 1;

export const DELIVERY_CHECKLIST_MODELS: DeliveryChecklistModelOption[] = [
  {
    key: "model3",
    label: "Model 3",
    shortLabel: "M3",
    teslaModelCodes: ["m3", "model3", "model 3"],
  },
  {
    key: "modely",
    label: "Model Y",
    shortLabel: "MY",
    teslaModelCodes: ["my", "modely", "model y"],
  },
  {
    key: "cybertruck",
    label: "Cybertruck",
    shortLabel: "CT",
    teslaModelCodes: ["ct", "cybertruck"],
  },
];

export const DELIVERY_CHECKLIST_SECTIONS: DeliveryChecklistSection[] = [
  {
    id: "records",
    title: "Records",
    shortTitle: "Records",
    description: "Confirm that the vehicle and paperwork match before inspecting details.",
  },
  {
    id: "locked-exterior",
    title: "Locked Exterior",
    shortTitle: "Locked",
    description: "Checks that are usually possible before accepting or unlocking the vehicle.",
  },
  {
    id: "unlocked-exterior",
    title: "Unlocked Exterior",
    shortTitle: "Unlocked",
    description: "Open and operate exterior panels, doors, glass, seals, and storage areas.",
  },
  {
    id: "interior",
    title: "Interior",
    shortTitle: "Interior",
    description: "Inspect cabin trim, seats, controls, storage, and accessories.",
  },
  {
    id: "electronics",
    title: "Electronics",
    shortTitle: "Tech",
    description: "Verify the screen, cameras, lighting, software, and comfort systems.",
  },
  {
    id: "charging",
    title: "Charging",
    shortTitle: "Charge",
    description: "Check charge equipment, adapters, ports, state of charge, and charging behavior.",
  },
  {
    id: "model-specific",
    title: "Model-Specific",
    shortTitle: "Model",
    description: "Items that differ meaningfully across Model 3, Model Y, and Cybertruck.",
  },
  {
    id: "final-review",
    title: "Final Review",
    shortTitle: "Review",
    description: "Collect issues, photos, and advisor-ready notes before leaving.",
  },
];

export const DELIVERY_CHECKLIST_SOURCE_ATTRIBUTIONS = [
  {
    title: "polymorphic Tesla Model Y Delivery Checklist",
    url: "https://github.com/polymorphic/tesla-model-y-checklist",
  },
  {
    title: "TeslaPrep Model 3 / Model Y checklists",
    url: "https://github.com/mykeln/teslaprep",
  },
  {
    title: "Jowua Delivery Day interactive checklist article",
    url: "https://www.jowua-life.com/blogs/tesla-owners-faq/the-ultimate-2026-tesla-delivery-day-checklist-free-tool-pdf",
  },
  {
    title: "Everyday Chris Cybertruck checklist",
    url: "https://everydaychrisofficial.com/cybertruck-checklist/",
  },
  {
    title: "Cybertruck Owners Club delivery checklist discussion",
    url: "https://www.cybertruckownersclub.com/forum/threads/comprehensive-cybertruck-delivery-checklist.29397/",
  },
  {
    title: "Infinidim Model 3 Highland acceptance checklist",
    url: "https://www.infinidim.org/wp-content/uploads/2024/01/Infinidim-Tesla-M3H-Acceptance-Checklist-29Jan24.pdf",
  },
];

const allModels: DeliveryChecklistModelKey[] = ["model3", "modely", "cybertruck"];
const model3y: DeliveryChecklistModelKey[] = ["model3", "modely"];

export const DELIVERY_CHECKLIST_ITEMS: DeliveryChecklistItem[] = [
  {
    id: "records-vin-match",
    sectionId: "records",
    title: "VIN matches the app, paperwork, windshield, and vehicle screen.",
    helper: "Treat any mismatch as a stop-and-ask item before accepting delivery.",
    critical: true,
  },
  {
    id: "records-name-address",
    sectionId: "records",
    title: "Name, registration address, and delivery paperwork are correct.",
    critical: true,
  },
  {
    id: "records-config-match",
    sectionId: "records",
    title: "Paint, wheels, interior, trim, and ordered options match the order.",
    critical: true,
  },
  {
    id: "records-insurance-payment",
    sectionId: "records",
    title: "Insurance, payment status, trade-in, and required documents are ready.",
  },
  {
    id: "records-delivery-time",
    sectionId: "records",
    title: "Delivery time and lighting are good enough for a careful walkaround.",
  },

  {
    id: "locked-panel-gaps",
    sectionId: "locked-exterior",
    title: "Body panels, doors, hood/frunk, hatch, and charge-port area sit even and flush.",
    helper: "Look for large, uneven, or rubbing gaps rather than tiny cosmetic differences.",
    critical: true,
  },
  {
    id: "locked-paint-walkaround",
    sectionId: "locked-exterior",
    title: "Paint or stainless finish is free of obvious chips, dents, stains, scratches, or overspray.",
    critical: true,
  },
  {
    id: "locked-glass-alignment",
    sectionId: "locked-exterior",
    title: "Windshield, roof glass, mirrors, and rear glass are aligned and undamaged.",
    critical: true,
  },
  {
    id: "locked-lights-fit",
    sectionId: "locked-exterior",
    title: "Headlights, tail lights, light bars, and lenses are seated, clear, and dry.",
  },
  {
    id: "locked-wheels-tires",
    sectionId: "locked-exterior",
    title: "Wheels, tires, hubcaps/covers, lug areas, and valve stems show no visible damage.",
  },
  {
    id: "locked-undercarriage",
    sectionId: "locked-exterior",
    title: "Underside, rocker panels, wheel wells, fasteners, and aero covers are not damaged or loose.",
    critical: true,
  },
  {
    id: "locked-cameras-sensors",
    sectionId: "locked-exterior",
    title: "Exterior cameras and sensor covers are clean, seated, and not cracked.",
  },

  {
    id: "unlocked-doors-windows",
    sectionId: "unlocked-exterior",
    title: "All doors open, close, latch, and window indexing works without scraping.",
    requiresUnlocked: true,
    critical: true,
  },
  {
    id: "unlocked-frunk-trunk",
    sectionId: "unlocked-exterior",
    title: "Frunk and trunk/hatch open and close smoothly; lighting and release buttons work.",
    requiresUnlocked: true,
  },
  {
    id: "unlocked-seals-weather",
    sectionId: "unlocked-exterior",
    title: "Door, glass, trunk, frunk, and roof seals are attached, continuous, and not pinched.",
    requiresUnlocked: true,
  },
  {
    id: "unlocked-door-jambs",
    sectionId: "unlocked-exterior",
    title: "Door jambs, hinge areas, sills, and hidden paint edges are clean and undamaged.",
    requiresUnlocked: true,
  },
  {
    id: "unlocked-wipers-washer",
    sectionId: "unlocked-exterior",
    title: "Wipers and washer operate correctly and do not contact painted panels.",
    requiresUnlocked: true,
  },
  {
    id: "unlocked-front-license",
    sectionId: "unlocked-exterior",
    title: "Front plate holder, tow hook, and included loose accessories are present where applicable.",
    requiresUnlocked: true,
  },

  {
    id: "interior-screen-trim",
    sectionId: "interior",
    title: "Screen, dash, console, door trim, headliner, carpet, and sills are clean and undamaged.",
    requiresUnlocked: true,
  },
  {
    id: "interior-seats",
    sectionId: "interior",
    title: "Seats, stitching, bolsters, rear bench, and folding mechanisms are aligned and undamaged.",
    requiresUnlocked: true,
  },
  {
    id: "interior-seat-controls",
    sectionId: "interior",
    title: "Front seat adjustment, lumbar, steering wheel controls, mirrors, and fold functions work.",
    requiresUnlocked: true,
  },
  {
    id: "interior-storage",
    sectionId: "interior",
    title: "Glovebox, center console, cupholders, coat hooks, cargo covers, and storage bins work.",
    requiresUnlocked: true,
  },
  {
    id: "interior-pedals-belts",
    sectionId: "interior",
    title: "Pedals, seat belts, emergency releases, and latch points are secure and easy to reach.",
    requiresUnlocked: true,
    critical: true,
  },
  {
    id: "interior-floor-mats",
    sectionId: "interior",
    title: "Floor mats, trunk/frunk liners, and cargo panels fit without loose or damaged edges.",
    requiresUnlocked: true,
  },

  {
    id: "electronics-display",
    sectionId: "electronics",
    title: "Touchscreen boots, responds normally, shows no warning messages, and can restart cleanly.",
    requiresUnlocked: true,
    critical: true,
  },
  {
    id: "electronics-cameras",
    sectionId: "electronics",
    title: "Backup, side, front, and cabin camera views appear clear where available.",
    requiresUnlocked: true,
    critical: true,
  },
  {
    id: "electronics-lights",
    sectionId: "electronics",
    title: "Headlights, hazards, turn signals, brake lights, reverse lights, fog lights, and interior lights work.",
    requiresUnlocked: true,
    critical: true,
  },
  {
    id: "electronics-audio",
    sectionId: "electronics",
    title: "Audio plays from all expected speakers without rattles, distortion, or dead zones.",
    requiresUnlocked: true,
  },
  {
    id: "electronics-climate",
    sectionId: "electronics",
    title: "HVAC, defrost, seat heaters/ventilation, and fan controls respond without unusual noise.",
    requiresUnlocked: true,
  },
  {
    id: "electronics-phone-usb",
    sectionId: "electronics",
    title: "Wireless chargers, USB ports, 12V/low-voltage outlets, Bluetooth, and app key work.",
    requiresUnlocked: true,
  },
  {
    id: "electronics-driver-assist",
    sectionId: "electronics",
    title: "Parking visualization, blind-spot camera, driver profiles, and safety settings are available.",
    requiresUnlocked: true,
  },

  {
    id: "charging-port-door",
    sectionId: "charging",
    title: "Charge-port door opens, closes, lights, and sits flush.",
    requiresUnlocked: true,
    critical: true,
  },
  {
    id: "charging-session",
    sectionId: "charging",
    title: "Vehicle accepts a charging cable and reports a sane charging state.",
    requiresUnlocked: true,
    critical: true,
  },
  {
    id: "charging-soc",
    sectionId: "charging",
    title: "State of charge is reasonable for pickup and enough for the first drive.",
    requiresUnlocked: true,
  },
  {
    id: "charging-adapters",
    sectionId: "charging",
    title: "Included charging adapter, mobile connector, or region-specific charging accessories are present.",
    requiresUnlocked: true,
  },

  {
    id: "model3-light-strip",
    sectionId: "model-specific",
    title: "Ambient light strip, dash trim, and front door alignment look even.",
    appliesTo: ["model3"],
    requiresUnlocked: true,
  },
  {
    id: "model3-highland-controls",
    sectionId: "model-specific",
    title: "Steering wheel buttons, turn controls, drive selection, and screen gestures work as expected.",
    appliesTo: ["model3"],
    requiresUnlocked: true,
    critical: true,
  },
  {
    id: "modely-hatch",
    sectionId: "model-specific",
    title: "Power liftgate height, rear hatch alignment, cargo covers, and rear water guards are correct.",
    appliesTo: ["modely"],
    requiresUnlocked: true,
  },
  {
    id: "modely-third-row-tow",
    sectionId: "model-specific",
    title: "Third-row seats, tow hitch, and Gemini/Induction wheel details match the order if equipped.",
    appliesTo: ["modely"],
    requiresUnlocked: true,
  },
  {
    id: "cybertruck-stainless",
    sectionId: "model-specific",
    title: "Stainless panels have consistent finish and no obvious dents, scratches, residue, or edge damage.",
    appliesTo: ["cybertruck"],
    critical: true,
  },
  {
    id: "cybertruck-powered-frunk",
    sectionId: "model-specific",
    title: "Powered frunk, front light bar, emergency release, front cameras, and tow hooks check out.",
    appliesTo: ["cybertruck"],
    requiresUnlocked: true,
    critical: true,
  },
  {
    id: "cybertruck-vault-bed",
    sectionId: "model-specific",
    title: "Vault cover, bed outlets, tailgate, tonneau track, bed lighting, and tie-downs operate cleanly.",
    appliesTo: ["cybertruck"],
    requiresUnlocked: true,
    critical: true,
  },
  {
    id: "cybertruck-wipers-wash",
    sectionId: "model-specific",
    title: "Large wiper, washer coverage, windshield edge trim, and glass cleaning quality are acceptable.",
    appliesTo: ["cybertruck"],
    requiresUnlocked: true,
  },
  {
    id: "model3y-j1772",
    sectionId: "model-specific",
    title: "J1772 adapter and trunk/frunk accessory kit are present if included for the region.",
    appliesTo: model3y,
    requiresUnlocked: true,
  },

  {
    id: "final-photos-notes",
    sectionId: "final-review",
    title: "All issues have notes and photos where useful.",
    critical: true,
  },
  {
    id: "final-advisor-review",
    sectionId: "final-review",
    title: "Delivery advisor has acknowledged serious defects before you leave.",
    critical: true,
  },
  {
    id: "final-service-request",
    sectionId: "final-review",
    title: "Minor follow-up items are ready for a service request or documented report.",
  },
  {
    id: "final-first-drive",
    sectionId: "final-review",
    title: "First drive plan includes charge, route, phone key, mirrors, and no blocking warnings.",
    critical: true,
  },
];

export function normalizeChecklistModelKey(
  value: unknown,
  fallback: DeliveryChecklistModelKey = "modely",
): DeliveryChecklistModelKey {
  const raw = String(value || "").trim().toLowerCase();
  for (const model of DELIVERY_CHECKLIST_MODELS) {
    if (model.key === raw || model.teslaModelCodes.includes(raw)) return model.key;
  }
  return fallback;
}

export function mapTeslaModelCodeToChecklistModelKey(value: unknown): DeliveryChecklistModelKey | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const normalized = normalizeChecklistModelKey(raw, "modely");
  return DELIVERY_CHECKLIST_MODELS.some((model) => model.key === normalized && model.teslaModelCodes.includes(raw))
    || raw === normalized
    ? normalized
    : null;
}

export function getChecklistModelLabel(modelKey: unknown): string {
  const normalized = normalizeChecklistModelKey(modelKey);
  return DELIVERY_CHECKLIST_MODELS.find((model) => model.key === normalized)?.label || "Model Y";
}

export function itemAppliesToModel(item: DeliveryChecklistItem, modelKey: DeliveryChecklistModelKey): boolean {
  return !item.appliesTo?.length || item.appliesTo.includes(modelKey);
}

export function getChecklistItems(
  modelKey: DeliveryChecklistModelKey,
  sectionId?: string | null,
): DeliveryChecklistItem[] {
  const normalized = normalizeChecklistModelKey(modelKey);
  return DELIVERY_CHECKLIST_ITEMS.filter((item) =>
    itemAppliesToModel(item, normalized)
    && (!sectionId || item.sectionId === sectionId)
  );
}

export function getChecklistSections(modelKey: DeliveryChecklistModelKey): DeliveryChecklistSection[] {
  const normalized = normalizeChecklistModelKey(modelKey);
  const availableSectionIds = new Set(getChecklistItems(normalized).map((item) => item.sectionId));
  return DELIVERY_CHECKLIST_SECTIONS.filter((section) => availableSectionIds.has(section.id));
}

export function createEmptyItemState(
  items: DeliveryChecklistItem[] = DELIVERY_CHECKLIST_ITEMS,
): Record<string, DeliveryChecklistItemState> {
  return items.reduce<Record<string, DeliveryChecklistItemState>>((state, item) => {
    state[item.id] = { status: "unchecked", photoIds: [] };
    return state;
  }, {});
}

export function normalizeItemStatus(value: unknown): DeliveryChecklistItemStatus {
  return value === "pass" || value === "issue" || value === "skip" ? value : "unchecked";
}

export function normalizeItemState(value: unknown): DeliveryChecklistItemState {
  const source = value && typeof value === "object" ? value as Partial<DeliveryChecklistItemState> : {};
  return {
    status: normalizeItemStatus(source.status),
    note: typeof source.note === "string" ? source.note : "",
    photoIds: Array.isArray(source.photoIds) ? source.photoIds.map(String).filter(Boolean) : [],
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
  };
}

export function getChecklistProgress(
  session: Pick<DeliveryChecklistSession, "modelKey" | "itemState"> | null | undefined,
  items = session ? getChecklistItems(session.modelKey) : DELIVERY_CHECKLIST_ITEMS,
): DeliveryChecklistProgress {
  const totals = {
    total: items.length,
    complete: 0,
    passed: 0,
    issue: 0,
    skipped: 0,
    unchecked: 0,
    percent: 0,
  };

  for (const item of items) {
    const status = normalizeItemStatus(session?.itemState?.[item.id]?.status);
    if (status === "pass") {
      totals.passed += 1;
      totals.complete += 1;
    } else if (status === "issue") {
      totals.issue += 1;
      totals.complete += 1;
    } else if (status === "skip") {
      totals.skipped += 1;
      totals.complete += 1;
    } else {
      totals.unchecked += 1;
    }
  }

  totals.percent = totals.total > 0 ? Math.round((totals.complete / totals.total) * 100) : 0;
  return totals;
}

function pickText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeAddress(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object") return String(value).trim();

  const record = value as Record<string, unknown>;
  return [
    record.title,
    record.city,
    record.stateProvince,
    record.postalCode,
  ].map((part) => String(part || "").trim()).filter(Boolean).join(", ");
}

export function normalizeTeslaOrderForChecklist(order: unknown): {
  modelKey: DeliveryChecklistModelKey | null;
  metadata: DeliveryChecklistVehicleMetadata;
} {
  const source = order && typeof order === "object" ? order as Record<string, any> : {};
  const ui = source._ui && typeof source._ui === "object" ? source._ui : {};
  const details = source._details && typeof source._details === "object" ? source._details : {};
  const decoded = source._decoded && typeof source._decoded === "object" ? source._decoded : {};
  const modelCode = pickText(source.modelCode, source.model_code);
  const modelKey = mapTeslaModelCodeToChecklistModelKey(modelCode)
    || mapTeslaModelCodeToChecklistModelKey(ui.model_name);
  const trimSummary = Array.isArray(ui.config_summary)
    ? ui.config_summary.map(String).filter(Boolean)
    : [];

  return {
    modelKey,
    metadata: {
      vin: pickText(source.vin, ui.vin),
      orderReference: pickText(source.referenceNumber, source.reference_number),
      modelName: pickText(ui.model_name, getChecklistModelLabel(modelKey || "modely")),
      modelCode,
      trimSummary,
      deliveryDate: pickText(details.appointmentDateUtc, details.etaToDeliveryCenter, details.orderBookedDate),
      deliveryWindow: pickText(details.deliveryWindow, details.schedulingAppointmentSummary),
      pickupLocation: normalizeAddress(details.pickupLocationAddress) || pickText(
        details.schedulingDeliveryAddress,
        details.schedulingDeliveryAddressDetail,
      ),
      status: pickText(ui.status, source.orderStatus, source.order_status),
      substatus: pickText(ui.substatus, source.orderSubstatus, source.order_substatus),
      imageUrl: pickText(decoded.image_url),
      source: "vatiolibre",
    },
  };
}

export function createSessionTitle(modelKey: DeliveryChecklistModelKey, metadata: DeliveryChecklistVehicleMetadata = {}): string {
  const modelLabel = metadata.modelName || getChecklistModelLabel(modelKey);
  const identifier = metadata.orderReference || metadata.vin;
  return identifier ? `${modelLabel} ${identifier}` : `${modelLabel} Delivery`;
}

export function createDeliveryChecklistSession({
  id = "",
  modelKey = "modely",
  metadata = {},
  now = new Date().toISOString(),
}: {
  id?: string;
  modelKey?: DeliveryChecklistModelKey;
  metadata?: DeliveryChecklistVehicleMetadata;
  now?: string;
} = {}): DeliveryChecklistSession {
  const normalizedModelKey = normalizeChecklistModelKey(modelKey);
  const sessionId = id || `delivery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: sessionId,
    version: DELIVERY_CHECKLIST_SESSION_VERSION,
    modelKey: normalizedModelKey,
    title: createSessionTitle(normalizedModelKey, metadata),
    metadata: { source: "manual", ...metadata },
    itemState: createEmptyItemState(getChecklistItems(normalizedModelKey)),
    createdAt: now,
    updatedAt: now,
  };
}

export function buildDeliveryChecklistReport(session: DeliveryChecklistSession): string {
  const items = getChecklistItems(session.modelKey);
  const progress = getChecklistProgress(session, items);
  const issueLines = items
    .filter((item) => normalizeItemStatus(session.itemState[item.id]?.status) === "issue")
    .map((item) => {
      const state = normalizeItemState(session.itemState[item.id]);
      const note = state.note ? ` - ${state.note}` : "";
      const photos = state.photoIds?.length ? ` (${state.photoIds.length} photo${state.photoIds.length === 1 ? "" : "s"})` : "";
      return `- ${item.title}${note}${photos}`;
    });

  const meta = session.metadata || {};
  const normalizedWindshieldVin = normalizeDeliveryVin(meta.windshieldVin);
  const normalizedBackendVin = normalizeDeliveryVin(meta.vin);
  const windshieldVin = normalizedWindshieldVin ? `Windshield VIN: ${normalizedWindshieldVin}` : "";
  const windshieldVinComparison = (() => {
    if (!normalizedWindshieldVin) return "";
    if (meta.source !== "vatiolibre") return "Windshield VIN comparison: Manual/local only";
    if (!normalizedBackendVin) return "Windshield VIN comparison: Backend VIN unavailable";
    return normalizedWindshieldVin === normalizedBackendVin
      ? "Windshield VIN comparison: Match"
      : `Windshield VIN comparison: Mismatch (backend ${normalizedBackendVin})`;
  })();
  const header = [
    `Tesla Delivery Checklist: ${session.title || getChecklistModelLabel(session.modelKey)}`,
    `Model: ${meta.modelName || getChecklistModelLabel(session.modelKey)}`,
    meta.vin ? `VIN: ${meta.vin}` : "",
    windshieldVin,
    windshieldVinComparison,
    meta.orderReference ? `Order: ${meta.orderReference}` : "",
    meta.pickupLocation ? `Pickup: ${meta.pickupLocation}` : "",
    `Progress: ${progress.complete}/${progress.total} (${progress.percent}%)`,
    `Issues: ${progress.issue}`,
  ].filter(Boolean);

  return [
    ...header,
    "",
    "Issues",
    issueLines.length ? issueLines.join("\n") : "No issues marked.",
  ].join("\n");
}
