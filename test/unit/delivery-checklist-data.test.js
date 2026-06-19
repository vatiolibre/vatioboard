import { describe, expect, it } from "vitest";

import {
  buildDeliveryChecklistReport,
  createDeliveryChecklistSession,
  getChecklistItems,
  getChecklistProgress,
  getChecklistSections,
  getLocalizedChecklistItems,
  getLocalizedChecklistSections,
  mapTeslaModelCodeToChecklistModelKey,
  normalizeTeslaOrderForChecklist,
} from "../../src/apps/delivery-checklist/delivery-checklist-data.js";
import { deliveryChecklistTranslations } from "../../src/apps/delivery-checklist/delivery-checklist-translations.js";

const translateEs = (key, fallback) => deliveryChecklistTranslations.es[key] || fallback || key;

describe("delivery checklist data", () => {
  it("filters stable checklist items by Model 3, Model Y, and Cybertruck", () => {
    const model3 = getChecklistItems("model3").map((item) => item.id);
    const modely = getChecklistItems("modely").map((item) => item.id);
    const cybertruck = getChecklistItems("cybertruck").map((item) => item.id);

    expect(model3).toContain("model3-highland-controls");
    expect(model3).not.toContain("modely-hatch");
    expect(modely).toContain("modely-hatch");
    expect(modely).not.toContain("cybertruck-vault-bed");
    expect(cybertruck).toContain("cybertruck-stainless");
    expect(cybertruck).not.toContain("model3-light-strip");

    expect(new Set(model3).size).toBe(model3.length);
    expect(new Set(modely).size).toBe(modely.length);
    expect(new Set(cybertruck).size).toBe(cybertruck.length);
  });

  it("keeps sections ordered and only includes sections that apply to the selected model", () => {
    expect(getChecklistSections("modely").map((section) => section.id)).toEqual([
      "records",
      "locked-exterior",
      "unlocked-exterior",
      "interior",
      "electronics",
      "charging",
      "model-specific",
      "final-review",
    ]);
  });

  it("localizes sections and items without changing stable IDs or model filtering", () => {
    const englishSections = getChecklistSections("modely");
    const spanishSections = getLocalizedChecklistSections("modely", translateEs);
    const englishItems = getChecklistItems("modely");
    const spanishItems = getLocalizedChecklistItems("modely", null, translateEs);

    expect(spanishSections.map((section) => section.id)).toEqual(englishSections.map((section) => section.id));
    expect(spanishSections[0]).toMatchObject({
      id: "records",
      title: "Registros",
      shortTitle: "Registros",
    });
    expect(spanishItems.map((item) => item.id)).toEqual(englishItems.map((item) => item.id));
    expect(spanishItems.find((item) => item.id === "records-vin-match")).toMatchObject({
      title: "El VIN coincide en la app, documentos, parabrisas y pantalla del vehículo.",
    });
    expect(getLocalizedChecklistItems("modely", "model-specific", translateEs).map((item) => item.id)).toContain("modely-hatch");
    expect(getLocalizedChecklistItems("modely", "model-specific", translateEs).map((item) => item.id)).not.toContain("cybertruck-stainless");
  });

  it("counts progress states consistently", () => {
    const session = createDeliveryChecklistSession({
      id: "delivery-progress",
      modelKey: "cybertruck",
    });
    session.itemState["records-vin-match"].status = "pass";
    session.itemState["cybertruck-stainless"].status = "issue";
    session.itemState["final-first-drive"].status = "skip";

    expect(getChecklistProgress(session)).toMatchObject({
      complete: 3,
      passed: 1,
      issue: 1,
      skipped: 1,
    });
  });

  it("normalizes VatioLibre enriched order fields into editable metadata", () => {
    const normalized = normalizeTeslaOrderForChecklist({
      modelCode: "m3",
      vin: "5YJ3E1EA0RF000001",
      referenceNumber: "RN123456789",
      _ui: {
        model_name: "Model 3",
        status: "Delivered",
        substatus: "Ready",
        config_summary: ["Stealth Grey", "18 inch Photon Wheels"],
      },
      _decoded: {
        image_url: "https://example.test/model3.png",
      },
      _details: {
        appointmentDateUtc: "2026-06-20T14:00:00Z",
        deliveryWindow: "10:00-12:00",
        pickupLocationAddress: {
          title: "Tesla Brooklyn",
          city: "Brooklyn",
          stateProvince: "NY",
          postalCode: "11201",
        },
      },
    });

    expect(normalized.modelKey).toBe("model3");
    expect(normalized.metadata).toMatchObject({
      vin: "5YJ3E1EA0RF000001",
      orderReference: "RN123456789",
      modelName: "Model 3",
      pickupLocation: "Tesla Brooklyn, Brooklyn, NY, 11201",
      source: "vatiolibre",
    });
    expect(normalized.metadata.trimSummary).toEqual(["Stealth Grey", "18 inch Photon Wheels"]);
  });

  it("maps current Tesla model codes for import", () => {
    expect(mapTeslaModelCodeToChecklistModelKey("m3")).toBe("model3");
    expect(mapTeslaModelCodeToChecklistModelKey("my")).toBe("modely");
    expect(mapTeslaModelCodeToChecklistModelKey("ct")).toBe("cybertruck");
    expect(mapTeslaModelCodeToChecklistModelKey("ms")).toBeNull();
  });

  it("generates an advisor-ready issue report with photo counts", () => {
    const session = createDeliveryChecklistSession({
      id: "delivery-report",
      modelKey: "modely",
      metadata: {
        vin: "VIN123",
        orderReference: "RN123",
        pickupLocation: "Tesla Delivery Center",
      },
    });
    session.itemState["locked-panel-gaps"] = {
      status: "issue",
      note: "Hatch rubs on left side.",
      photoIds: ["photo-1", "photo-2"],
    };

    expect(buildDeliveryChecklistReport(session)).toContain("VIN: VIN123");
    expect(buildDeliveryChecklistReport(session)).toContain("Hatch rubs on left side.");
    expect(buildDeliveryChecklistReport(session)).toContain("(2 photos)");
  });

  it("includes windshield VIN scan details and comparison in reports", () => {
    const session = createDeliveryChecklistSession({
      id: "delivery-vin-report",
      modelKey: "modely",
      metadata: {
        source: "vatiolibre",
        vin: "5yjygdee0rf000001",
        windshieldVin: "5YJYGDEE0RF000001",
      },
    });

    expect(buildDeliveryChecklistReport(session)).toContain("Windshield VIN: 5YJYGDEE0RF000001");
    expect(buildDeliveryChecklistReport(session)).toContain("Windshield VIN comparison: Match");

    session.metadata.windshieldVin = "7G2CEHED0RA000001";
    expect(buildDeliveryChecklistReport(session)).toContain(
      "Windshield VIN comparison: Mismatch (backend 5YJYGDEE0RF000001)",
    );

    session.metadata.source = "manual";
    expect(buildDeliveryChecklistReport(session)).toContain("Windshield VIN comparison: Manual/local only");
  });

  it("generates localized reports while preserving user notes and metadata", () => {
    const session = createDeliveryChecklistSession({
      id: "delivery-report-es",
      modelKey: "modely",
      metadata: {
        vin: "VIN123",
        orderReference: "RN123",
        pickupLocation: "Tesla Delivery Center",
      },
    });
    session.itemState["records-vin-match"] = {
      status: "issue",
      note: "Advisor should confirm.",
      photoIds: ["photo-1"],
    };

    const report = buildDeliveryChecklistReport(session, { translate: translateEs });

    expect(report).toContain("Lista de entrega Tesla:");
    expect(report).toContain("Modelo: Model Y");
    expect(report).toContain("Pedido: RN123");
    expect(report).toContain("El VIN coincide en la app");
    expect(report).toContain("Advisor should confirm.");
    expect(report).toContain("(1 foto)");
    expect(report).toContain("Incidencias: 1");
  });
});
