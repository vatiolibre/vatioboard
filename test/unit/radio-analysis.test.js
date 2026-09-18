import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRadioAnalysis } from "../../src/shared/radio-analysis.js";
import { acquireGraph, destroyGraphForElement } from "../../src/shared/audio-graph-registry.js";
vi.mock("../../src/shared/audio-graph-registry.js", () => ({ acquireGraph: vi.fn(), destroyGraphForElement: vi.fn() }));
let context, analysis, changes;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers();
  context = Object.assign(new EventTarget(), { state: "running" });
  acquireGraph.mockResolvedValue({ audioContext: context });
  changes = vi.fn(); analysis = createRadioAnalysis(changes);
});
afterEach(() => { analysis.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("starts graph and muted play synchronously; only exposes the ready analysis element", async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play");
  const started = analysis.start("https://relay.example/one");
  expect(acquireGraph).toHaveBeenCalledTimes(1);
  expect(play).toHaveBeenCalledTimes(1);
  const el = play.mock.instances[0];
  expect(el.muted).toBe(true); expect(el.crossOrigin).toBe("anonymous");
  expect(el.dataset.vatioAnalysisOnly).toBe("true");
  expect(analysis.getElement()).toBeNull();
  expect(await started).toBe(true);
  expect(analysis.getElement()).toBe(el); expect(el.muted).toBe(false);
  await analysis.start("https://relay.example/one");
  expect(play).toHaveBeenCalledTimes(1);
});
it.each(["NotAllowedError", "NotSupportedError"])("fails quietly on %s without retrying", async name => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new DOMException("failed", name));
  expect(await analysis.start("https://relay.example/one")).toBe(false);
  expect(analysis.getStatus()).toBe("unavailable");
  expect(analysis.getElement()).toBeNull();
  await vi.advanceTimersByTimeAsync(30000);
  expect(play).toHaveBeenCalledTimes(1);
  expect(destroyGraphForElement).toHaveBeenCalled();
});
it("times out a pending graph and never unmutes its stale completion", async () => {
  let complete;
  acquireGraph.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  const first = analysis.start("https://relay.example/one");
  const old = acquireGraph.mock.calls[0][0];
  await vi.advanceTimersByTimeAsync(8000);
  expect(await first).toBe(false);
  expect(old.paused).toBe(true);
  complete({ audioContext: context }); await flush();
  expect(old.muted).toBe(true); expect(analysis.getElement()).toBeNull();
});
it("cancels old source promises without stopping or unmuting a newer source", async () => {
  let reject;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const first = analysis.start("https://relay.example/one");
  const old = acquireGraph.mock.calls[0][0];
  expect(await analysis.start("https://relay.example/two")).toBe(true);
  const current = analysis.getElement();
  expect(await first).toBe(false);
  reject(Error("late")); await flush();
  expect(analysis.getElement()).toBe(current); expect(current.paused).toBe(false);
  expect(old.muted).toBe(true); expect(old.paused).toBe(true);
});
it("tears down on media errors and context interruption, allowing explicit retry", async () => {
  await analysis.start("https://relay.example/one");
  analysis.getElement().dispatchEvent(new Event("error"));
  expect(analysis.getStatus()).toBe("unavailable");
  await analysis.start("https://relay.example/one");
  const old = analysis.getElement();
  context.state = "suspended"; context.dispatchEvent(new Event("statechange"));
  expect(old.paused).toBe(true); expect(old.muted).toBe(true);
  expect(analysis.getStatus()).toBe("unavailable");
  expect(vi.getTimerCount()).toBe(0);
});
it("does not start a hidden page", async () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  expect(await analysis.start("https://relay.example/one")).toBe(false);
  expect(acquireGraph).not.toHaveBeenCalled();
});
