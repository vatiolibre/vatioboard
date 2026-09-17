import { audioCompatibility } from "./audio-compatibility.js";
import { isBackgroundDiagnosticsEnabled, recordBackgroundDiagnostic } from "./background-diagnostics.js";

interface DiagnosticSources {
  getPrimary(): HTMLAudioElement | null;
  keepAlive: HTMLAudioElement;
  getLeaseIds(): string[];
}

type Snapshot = Record<string, string | number | boolean | null>;
const mediaEvents = ["play", "playing", "pause", "waiting", "stalled", "suspend", "emptied", "ended", "timeupdate"];
let stopObserver: (() => void) | null = null;
let refreshObserver: (() => void) | null = null;
let latest: Snapshot = {};
const listeners = new Set<(snapshot: Snapshot) => void>();

export function getAudioDiagnosticSnapshot(): Snapshot { return { ...latest }; }

export function subscribeAudioDiagnostics(listener: (snapshot: Snapshot) => void) {
  listeners.add(listener);
  listener(getAudioDiagnosticSnapshot());
  return () => { listeners.delete(listener); };
}

/** Exactly one optional observer per document; timers measure activity, never drive recovery. */
export function startAudioLifecycleDiagnostics(sources: DiagnosticSources) {
  if (stopObserver) { refreshObserver?.(); return; }
  if (!isBackgroundDiagnosticsEnabled()) return;
  let primary: HTMLAudioElement | null = null;
  let primaryCleanup = () => {};
  let heartbeat = 0;
  let wall = Date.now();
  let performanceTime = performance.now();
  let primaryTimeupdates = 0;
  let keepAliveTimeupdates = 0;
  let nextIdentity = 1;
  const identities = new WeakMap<object, number>();
  const identity = (element: object | null) => {
    if (!element) return 0;
    if (!identities.has(element)) identities.set(element, nextIdentity++);
    return identities.get(element)!;
  };

  function observe(element: HTMLAudioElement, role: "primary" | "keep-alive") {
    const handler = (event: Event) => {
      if (event.type === "timeupdate") {
        if (role === "primary") primaryTimeupdates += 1;
        else keepAliveTimeupdates += 1;
        return;
      }
      recordBackgroundDiagnostic(`${role}-${event.type}`, { mediaEvent: event.type, ...snapshot() });
    };
    for (const name of mediaEvents) element.addEventListener(name, handler);
    return () => { for (const name of mediaEvents) element.removeEventListener(name, handler); };
  }

  function snapshot(): Snapshot {
    const current = sources.getPrimary();
    if (current !== primary) {
      primaryCleanup();
      primary = current;
      primaryCleanup = current ? observe(current, "primary") : () => {};
    }
    const keepAlive = sources.keepAlive;
    const leaseIds = sources.getLeaseIds();
    return {
      audioAttached: audioCompatibility.attachedElement,
      silentDuringPlayback: audioCompatibility.silentDuringPlayback,
      primeOtherConsumers: audioCompatibility.primeOtherConsumers,
      mediaSessionWrites: audioCompatibility.mediaSessionWrites,
      audioSessionHints: audioCompatibility.audioSessionHints,
      primaryConnected: primary?.isConnected ?? false,
      visibility: document.visibilityState, hidden: document.hidden,
      heartbeat, wallTime: Date.now(), performanceTime: performance.now(),
      primaryElementId: identity(primary), keepAliveIdentity: identity(keepAlive),
      paused: primary?.paused ?? true, ended: primary?.ended ?? false,
      primaryCurrentTime: primary?.currentTime ?? 0, primaryDuration: primary?.duration ?? 0,
      readyState: primary?.readyState ?? 0, networkState: primary?.networkState ?? 0,
      keepAlivePaused: keepAlive.paused, keepAliveEnded: keepAlive.ended,
      keepAliveCurrentTime: keepAlive.currentTime, keepAliveDuration: keepAlive.duration,
      keepAliveLoop: keepAlive.loop, keepAliveMuted: keepAlive.muted,
      keepAliveVolume: keepAlive.volume, keepAlivePlaybackRate: keepAlive.playbackRate,
      mediaSessionPlaybackState: navigator.mediaSession?.playbackState ?? "unsupported",
      leaseCount: leaseIds.length, retainedLeaseIds: leaseIds.join(","),
      primaryTimeupdates, keepAliveTimeupdates,
    };
  }

  function publish() {
    latest = { ...snapshot(), wallDelta: Date.now() - wall, performanceDelta: performance.now() - performanceTime };
    wall = Date.now();
    performanceTime = performance.now();
    recordBackgroundDiagnostic("audio-heartbeat", latest);
    for (const listener of listeners) {
      try { listener(getAudioDiagnosticSnapshot()); } catch { /* diagnostics cannot affect playback */ }
    }
    // Console survives a minimized page when developer tools preserve logs.
    // eslint-disable-next-line no-console -- explicitly enabled diagnostic output
    console.debug("[VatioBoard audio]", latest);
  }
  refreshObserver = snapshot;
  const keepAliveCleanup = observe(sources.keepAlive, "keep-alive");
  const lifecycle = (event: Event) => recordBackgroundDiagnostic(`audio-${event.type}`, {
    lifecycle: event.type, ...snapshot(),
  });
  for (const name of ["visibilitychange", "freeze", "resume"]) document.addEventListener(name, lifecycle);
  for (const name of ["pagehide", "pageshow"]) window.addEventListener(name, lifecycle);
  publish();
  const timer = setInterval(() => {
    if (!isBackgroundDiagnosticsEnabled()) { stopAudioLifecycleDiagnostics(); return; }
    heartbeat += 1;
    publish();
  }, 2000);
  stopObserver = () => {
    clearInterval(timer);
    primaryCleanup();
    keepAliveCleanup();
    for (const name of ["visibilitychange", "freeze", "resume"]) document.removeEventListener(name, lifecycle);
    for (const name of ["pagehide", "pageshow"]) window.removeEventListener(name, lifecycle);
  };
}

export function stopAudioLifecycleDiagnostics() {
  stopObserver?.();
  stopObserver = null;
  refreshObserver = null;
}
