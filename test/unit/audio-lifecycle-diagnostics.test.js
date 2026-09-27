import { afterEach, beforeEach, expect, it, vi } from "vitest";

let diagnostics;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/?debugAudio=1");
  vi.spyOn(console, "debug").mockImplementation(() => {});
  diagnostics = await import("../../src/shared/audio-lifecycle-diagnostics.js");
});
afterEach(() => {
  diagnostics.stopAudioLifecycleDiagnostics();
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("uses one heartbeat and listener set; aggregates timeupdates and records hidden gaps", async () => {
  const primary = new Audio();
  const keepAlive = new Audio();
  const sources = { getPrimary: () => primary, keepAlive, getLeaseIds: () => ["drive-recording"] };
  const addListener = vi.spyOn(primary, "addEventListener");
  const interval = vi.spyOn(globalThis, "setInterval");
  const clearInterval = vi.spyOn(globalThis, "clearInterval");
  diagnostics.startAudioLifecycleDiagnostics(sources);
  diagnostics.startAudioLifecycleDiagnostics(sources);
  expect(interval).toHaveBeenCalledTimes(1);
  expect(addListener.mock.calls.filter(([event]) => event === "pause")).toHaveLength(1);
  for (let i = 0; i < 200; i++) primary.dispatchEvent(new Event("timeupdate"));
  document.dispatchEvent(new Event("freeze"));
  vi.advanceTimersByTime(2000);
  const snapshot = diagnostics.getAudioDiagnosticSnapshot();
  expect(snapshot).toMatchObject({ heartbeat: 1, wallDelta: 2000, leaseCount: 1, primaryTimeupdates: 200 });
  const { getBackgroundDiagnostics } = await import("../../src/shared/background-diagnostics.js");
  expect(getBackgroundDiagnostics().some((entry) => entry.event === "audio-freeze")).toBe(true);
  expect(getBackgroundDiagnostics().length).toBeLessThan(10);
  diagnostics.stopAudioLifecycleDiagnostics();
  expect(clearInterval).toHaveBeenCalledWith(interval.mock.results[0].value);
  const count = getBackgroundDiagnostics().length;
  primary.dispatchEvent(new Event("pause"));
  expect(getBackgroundDiagnostics()).toHaveLength(count);
});

it("keeps diagnostics available when session storage is denied", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  const log = await import("../../src/shared/background-diagnostics.js");
  expect(log.isBackgroundDiagnosticsEnabled()).toBe(true);
  log.recordBackgroundDiagnostic("test", { heartbeat: 1 });
  expect(log.getBackgroundDiagnostics().at(-1)).toMatchObject({ event: "test", detail: { heartbeat: 1 } });
});
