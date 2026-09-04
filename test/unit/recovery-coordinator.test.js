import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRecoveryCoordinator,
  RECOVERY_METADATA_STORAGE_KEY,
} from "../../src/shared/recovery-coordinator.js";

describe("recovery coordinator", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("isolates adapter failures while hydrating, flushing, and reconciling", async () => {
    const coordinator = createRecoveryCoordinator();
    const healthy = {
      id: "healthy",
      hydrate: vi.fn(),
      flush: vi.fn(),
      reconcile: vi.fn(),
      destroy: vi.fn(),
    };
    coordinator.register({
      id: "broken",
      hydrate: () => { throw new Error("hydrate"); },
      flush: () => { throw new Error("flush"); },
      reconcile: () => { throw new Error("reconcile"); },
    });
    coordinator.register(healthy);

    await coordinator.hydrate();
    await coordinator.flush("mutation");
    await coordinator.reconcile(1234);

    expect(healthy.hydrate).toHaveBeenCalledOnce();
    expect(healthy.flush).toHaveBeenCalledWith("mutation");
    expect(healthy.reconcile).toHaveBeenCalledWith(1234);
    expect(JSON.parse(localStorage.getItem(RECOVERY_METADATA_STORAGE_KEY))).toMatchObject({
      version: 1,
      reason: "mutation",
    });

    await coordinator.destroy();
    expect(healthy.destroy).toHaveBeenCalledOnce();
  });

  it("flushes on pagehide and when the document becomes hidden", async () => {
    const coordinator = createRecoveryCoordinator();
    const flush = vi.fn();
    coordinator.register({ id: "feature", flush });
    await coordinator.hydrate();

    window.dispatchEvent(new Event("pagehide"));
    await coordinator.flush("mutation");
    expect(flush).toHaveBeenCalledWith("pagehide");

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await coordinator.flush("mutation");
    expect(flush).toHaveBeenCalledWith("visibility-hidden");

    await coordinator.destroy();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
});
