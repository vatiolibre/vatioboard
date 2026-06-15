import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDeliveryChecklistSession,
  getChecklistItems,
} from "../../src/apps/delivery-checklist/delivery-checklist-data.js";
import {
  DELIVERY_CHECKLIST_ACTIVE_SESSION_KEY,
  DELIVERY_CHECKLIST_SESSIONS_KEY,
  DELIVERY_CHECKLIST_STORAGE_PREFIX,
  createDeliveryChecklistRepository,
} from "../../src/apps/delivery-checklist/delivery-checklist-storage.js";

describe("delivery checklist storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates an active localStorage-backed session and restores it after reload", () => {
    const repo = createDeliveryChecklistRepository({ storage: localStorage });
    const session = repo.createSession({
      id: "delivery-local",
      modelKey: "modely",
      metadata: {
        vin: "VIN-MY",
      },
    });

    repo.updateItemState(session.id, "records-vin-match", {
      status: "pass",
    });
    repo.updateItemState(session.id, "locked-panel-gaps", {
      status: "issue",
      note: "Front passenger door sits proud.",
      photoIds: ["photo-1"],
    });

    const reloaded = createDeliveryChecklistRepository({ storage: localStorage });
    expect(reloaded.getActiveSessionId()).toBe("delivery-local");
    expect(reloaded.getActiveSession()).toMatchObject({
      id: "delivery-local",
      modelKey: "modely",
      metadata: {
        vin: "VIN-MY",
      },
      itemState: {
        "records-vin-match": {
          status: "pass",
        },
        "locked-panel-gaps": {
          status: "issue",
          note: "Front passenger door sits proud.",
          photoIds: ["photo-1"],
        },
      },
    });
  });

  it("normalizes migrated or partial session payloads with schema defaults", () => {
    localStorage.setItem(`${DELIVERY_CHECKLIST_STORAGE_PREFIX}${DELIVERY_CHECKLIST_SESSIONS_KEY}`, JSON.stringify({
      sessions: [
        {
          id: "legacy-session",
          modelKey: "model3",
          itemState: {
            "records-vin-match": {
              status: "bad-status",
            },
          },
        },
      ],
    }));
    localStorage.setItem(
      `${DELIVERY_CHECKLIST_STORAGE_PREFIX}settings.${DELIVERY_CHECKLIST_ACTIVE_SESSION_KEY}`,
      "legacy-session",
    );

    const repo = createDeliveryChecklistRepository({ storage: localStorage });
    const session = repo.getActiveSession();

    expect(session).toMatchObject({
      id: "legacy-session",
      version: 1,
      modelKey: "model3",
    });
    expect(session.itemState["records-vin-match"].status).toBe("unchecked");
    expect(Object.keys(session.itemState)).toHaveLength(getChecklistItems("model3").length);
  });

  it("updates last model and active session settings", () => {
    const repo = createDeliveryChecklistRepository({ storage: localStorage });
    repo.setLastModelKey("cybertruck");
    const session = repo.createSession({ id: "delivery-ct" });

    expect(session.modelKey).toBe("cybertruck");
    expect(repo.getActiveSessionId()).toBe("delivery-ct");
    expect(repo.getLastModelKey()).toBe("cybertruck");
  });

  it("returns false when localStorage quota or write failures prevent persistence", () => {
    const failingStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }),
      removeItem: vi.fn(),
      key: vi.fn(),
      length: 0,
    };
    const repo = createDeliveryChecklistRepository({ storage: failingStorage });
    const session = createDeliveryChecklistSession({
      id: "delivery-quota",
      modelKey: "modely",
    });

    expect(repo.saveSession(session)).toBe(false);
    expect(repo.listSessions()).toEqual([]);
  });
});
