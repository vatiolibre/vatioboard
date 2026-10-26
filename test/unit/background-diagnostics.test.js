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

  it("keeps bounded audio-channel identities and serialized lease IDs", async () => {
    const diagnostics = await import("../../src/shared/background-diagnostics.js");
    diagnostics.recordBackgroundDiagnostic("radio-channel", {
      primaryElementId: 3,
      analysisElementId: 3,
      nativeElementId: 0,
      keepAliveIdentity: 1,
      retainedLeaseIds: "speed-alerts,player-runtime",
      activeRole: "analysis",
      interruptionClassification: "audio-session",
      // Arrays are deliberately rejected; callers serialize known-safe IDs.
      activeLeaseIds: ["private-owner"],
    });

    expect(diagnostics.getBackgroundDiagnostics().at(-1)?.detail).toEqual({
      primaryElementId: 3,
      analysisElementId: 3,
      nativeElementId: 0,
      keepAliveIdentity: 1,
      retainedLeaseIds: "speed-alerts,player-runtime",
      activeRole: "analysis",
      interruptionClassification: "audio-session",
    });
  });
});

it("exports bounded radio recovery observations without media URLs or arbitrary station metadata", async () => {
  vi.resetModules();
  sessionStorage.clear();
  sessionStorage.setItem("vatioboard.debug.background", "1");
  const diagnostics = await import("../../src/shared/background-diagnostics.js");
  diagnostics.recordBackgroundDiagnostic("radio-connection", {
    trigger: "freeze", outcome: "restored", sourceReady: true,
    radioStationUuid: "11111111-1111-4111-8111-111111111111",
    connectionGeneration: 4, reconnectRequired: null, attempt: 2,
    currentTime: 32.5, lastProgressAt: 123456,
    buffered: "[[31,36]]", mediaErrorCode: 2,
    streamUrl: "https://secret.example/live", title: "Private metadata",
  });
  expect(diagnostics.getBackgroundDiagnostics().at(-1).detail).toEqual({
    trigger: "freeze", outcome: "restored", sourceReady: true,
    radioStationUuid: "11111111-1111-4111-8111-111111111111",
    connectionGeneration: 4, reconnectRequired: null, attempt: 2,
    currentTime: 32.5, lastProgressAt: 123456,
    buffered: "[[31,36]]", mediaErrorCode: 2,
  });
  diagnostics.recordBackgroundDiagnostic("radio-connection", { radioStationUuid: "Private metadata" });
  expect(diagnostics.getBackgroundDiagnostics().at(-1).detail).toEqual({});
});
