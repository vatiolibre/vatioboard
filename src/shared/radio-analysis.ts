import { acquireGraph, destroyGraphForElement } from "./audio-graph-registry.js";

/** Optional second stream. It never owns or modifies the audible radio element. */
export function createRadioAnalysis(onChange: () => void) {
  let element: HTMLAudioElement | null = null;
  let status: "idle" | "loading" | "ready" | "unavailable" = "idle";
  let generation = 0;
  let pending: Promise<boolean> | null = null;
  let finish: ((result: boolean) => void) | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let removeListeners = () => {};

  function stop(nextStatus: typeof status = "idle") {
    generation++;
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
    removeListeners(); removeListeners = () => {};
    const old = element;
    element = null;
    pending = null;
    finish?.(false); finish = null;
    if (old) {
      old.muted = true;
      old.pause();
      old.removeAttribute("src");
      old.load();
      destroyGraphForElement(old);
    }
    const changed = status !== nextStatus || old !== null;
    status = nextStatus;
    if (changed) onChange();
  }

  function start(src: string): Promise<boolean> {
    if (element?.src === src) return pending || Promise.resolve(status === "ready");
    stop();
    if (!src || document.hidden) return Promise.resolve(false);
    const token = generation;
    const el = document.createElement("audio");
    element = el;
    el.dataset.vatioAnalysisOnly = "true";
    el.crossOrigin = "anonymous";
    el.preload = "none";
    // Stay muted until the graph's zero-gain output is connected.
    el.muted = true;
    el.src = src;
    status = "loading";
    const result = new Promise<boolean>(resolve => { finish = resolve; });
    pending = result;
    const fail = () => { if (token === generation) stop("unavailable"); };
    const events = ["error", "stalled", "pause", "ended"];
    for (const name of events) el.addEventListener(name, fail);
    removeListeners = () => { for (const name of events) el.removeEventListener(name, fail); };
    timeout = setTimeout(fail, 8000);
    // Both calls begin in the gesture; neither waits for network or the other.
    const graph = acquireGraph(el);
    let playback: Promise<void>;
    try { playback = el.play(); } catch (error) { playback = Promise.reject(error); }
    void Promise.all([graph, playback]).then(([entry]) => {
      if (token !== generation) return;
      if (!entry || entry.audioContext.state !== "running") { fail(); return; }
      const onState = () => { if (entry.audioContext.state !== "running") fail(); };
      entry.audioContext.addEventListener("statechange", onState);
      const previousCleanup = removeListeners;
      removeListeners = () => { previousCleanup(); entry.audioContext.removeEventListener("statechange", onState); };
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
      // Analysis sees full samples; the graph's output remains gain=0.
      el.muted = false;
      status = "ready";
      pending = null;
      finish?.(true); finish = null;
      onChange();
    }).catch(fail);
    onChange();
    return result;
  }

  return { start, stop, getElement: () => status === "ready" ? element : null, getStatus: () => status };
}
