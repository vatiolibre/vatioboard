import { afterEach, beforeEach, expect, it, vi } from "vitest";
let diagnostics, mount, cleanup;
beforeEach(async () => {
  vi.resetModules();
  window.history.replaceState(null, "", "/?debugAudio=1");
  diagnostics = await import("../../src/shared/background-diagnostics.js");
  ({ mountAudioDiagnosticSummary: mount } = await import("../../src/shared/audio-diagnostic-summary.js"));
});
afterEach(() => { cleanup?.(); window.history.replaceState(null, "", "/"); });
it("shows manual results without clipboard, storage, or new timers and preserves them across mounts", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("unavailable"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("unavailable"); });
  const timer = vi.spyOn(globalThis, "setInterval");
  const root = document.createElement("div");
  cleanup = mount(root);
  expect(root.textContent).toContain("Build:");
  const input = root.querySelector("input");
  input.value = "2026.26.6.1";
  input.dispatchEvent(new Event("input"));
  const result = root.querySelector("select");
  expect(result.value).toBe("Not tested");
  result.value = "Pass";
  result.dispatchEvent(new Event("change"));
  cleanup();
  cleanup = mount(root);
  expect(root.querySelectorAll("details")).toHaveLength(1);
  expect(root.querySelector("input").value).toBe("2026.26.6.1");
  expect(root.querySelector("select").value).toBe("Pass");
  expect(timer).not.toHaveBeenCalled();
  cleanup();
  expect(root.children).toHaveLength(0);
});
it("keeps observation totals when frequent events roll out of bounded history", async () => {
  diagnostics.recordBackgroundDiagnostic("audio-interruption");
  await diagnostics.observeAudioRecovery("test", Promise.resolve(true));
  await diagnostics.observeAudioRecovery("test", Promise.reject(Error("blocked")));
  diagnostics.recordBackgroundDiagnostic("audio-freeze", { lifecycle: "freeze" });
  for (let i = 0; i < 300; i++) diagnostics.recordBackgroundDiagnostic("audio-heartbeat", { heartbeat: i });
  expect(diagnostics.getBackgroundDiagnostics()).toHaveLength(250);
  expect(diagnostics.getAudioObservation()).toMatchObject({ interruptions: 1, recoveryAttempts: 2,
    recoveryResolved: 1, recoveryRejected: 1, latestLifecycle: "freeze" });
  const root = document.createElement("div");
  cleanup = mount(root);
  expect(root.textContent).toContain("Unrequested pauses: 1");
  expect(root.textContent).toContain("Latest lifecycle: freeze");
});
it("does not mount diagnostics when disabled", () => {
  window.history.replaceState(null, "", "/?debugAudio=0");
  const root = document.createElement("div");
  cleanup = mount(root);
  expect(root.children).toHaveLength(0);
});
