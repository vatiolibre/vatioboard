import { beforeEach, describe, expect, it, vi } from "vitest";

describe("background diagnostics", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem("vatioboard.debug.background", "1");
  });

  it("retains a bounded privacy-safe ring without locations or station data", async () => {
    const diagnostics = await import("../../src/shared/background-diagnostics.js");

    for (let index = 0; index < 260; index += 1) {
      diagnostics.recordBackgroundDiagnostic("radio-state", {
        connectionState: "playing",
        transport: "radio-relay",
        fixAgeMs: index,
        latitude: 40.7,
        longitude: -73.9,
        stationUuid: "private-station-id",
        streamUrl: "https://secret.example/live",
      });
    }

    const entries = diagnostics.getBackgroundDiagnostics();
    const exported = diagnostics.serializeBackgroundDiagnostics();
    expect(entries).toHaveLength(250);
    expect(entries[0].detail.fixAgeMs).toBe(10);
    expect(entries.at(-1).detail).toEqual({
      connectionState: "playing",
      transport: "radio-relay",
      fixAgeMs: 259,
    });
    expect(exported).not.toContain("40.7");
    expect(exported).not.toContain("-73.9");
    expect(exported).not.toContain("private-station-id");
    expect(exported).not.toContain("secret.example");
  });
});
