/**
 * Shared audio system coordinator.
 *
 * Keeps page-level audio features from fighting each other in an SPA:
 * - One silent keep-alive audio element for all background audio requests.
 * - Leases let features ask for background audio without stopping each other.
 */

import { updateMediaSessionClient, clearMediaSessionClient } from "./media-session-adapter.js";
import { recordBackgroundDiagnostic } from "./background-diagnostics.js";
import { createAudioChannelRetainer } from "./audio-channel-retainer.js";

export interface BackgroundAudioState {
  status: "idle" | "arming" | "armed" | "delegated" | "interrupted" | "blocked";
  activeLeaseIds: string[];
  lastInterruption: "pause" | "ended" | "play-rejected" | null;
  revision: number;
}

const backgroundAudioRetainer = createAudioChannelRetainer();
const backgroundKeepAliveAudio = backgroundAudioRetainer.getKeepAliveAudio();
const backgroundAudioLeases = new Map();
const primaryCarriers = new Set<string>();

/** Primary startup/playback supplies retention; leases remain independently owned. */
export function setBackgroundAudioCarrier(owner: string, active: boolean) {
  if (primaryCarriers.has(owner) === active) return;
  if (active) primaryCarriers.add(owner);
  else primaryCarriers.delete(owner);
  backgroundAudioGeneration += 1;
  backgroundAudioArmPending = false;
  backgroundAudioArmPromise = null;
  if (primaryCarriers.size) {
    stopKeepAliveIntentionally();
    publishBackgroundAudioState(hasActiveBackgroundAudioLease() ? "delegated" : "idle", null);
  } else if (hasActiveBackgroundAudioLease()) {
    void rearmBackgroundAudio();
  } else {
    stopKeepAliveIntentionally();
    publishBackgroundAudioState("idle", null);
  }
}
const backgroundAudioListeners = new Set<(state: BackgroundAudioState) => void>();

let backgroundAudioGeneration = 0;
let backgroundAudioArmPending = false;
let backgroundAudioArmPromise = null;
let intentionalStopDepth = 0;
let automaticRecoveryAttempted = false;
const gestureHandlers = new Set<() => unknown>();
const retentionHandlers = {
  play: () => { void activateBackgroundAudioFromGesture(); },
  pause: () => {},
  stop: () => {},
};

/** Callbacks must initiate play/resume synchronously and never acquire leases. */
export function registerBackgroundAudioGestureHandler(handler: () => unknown) {
  gestureHandlers.add(handler);
  return () => { gestureHandlers.delete(handler); };
}

export function activateBackgroundAudioFromGesture(): Promise<boolean> {
  automaticRecoveryAttempted = false;
  const attempts = Array.from(gestureHandlers, (handler) => {
    try { return Promise.resolve(handler()).catch(() => false); } catch { return Promise.resolve(false); }
  });
  const retention = rearmBackgroundAudio();
  return Promise.all([...attempts, retention]).then((results) => results.some(Boolean));
}

/** One automatic attempt per interruption; a fresh gesture resets the budget. */
export function recoverBackgroundAudioAutomatically() {
  if (primaryCarriers.size || automaticRecoveryAttempted || !hasActiveBackgroundAudioLease()
    || !backgroundKeepAliveAudio.paused || navigator.audioSession?.state === "interrupted") return;
  automaticRecoveryAttempted = true;
  void rearmBackgroundAudio();
}
let backgroundAudioState: BackgroundAudioState = {
  status: "idle",
  activeLeaseIds: [],
  lastInterruption: null,
  revision: 0,
};

function normalizeLeaseId(id) {
  return String(id || "").trim();
}

function pruneInactiveBackgroundAudioLeases() {
  for (const [id, lease] of backgroundAudioLeases) {
    if (typeof lease.shouldContinue !== "function") continue;

    try {
      if (lease.shouldContinue()) continue;
    } catch {
      // Treat throwing leases as stale.
    }

    backgroundAudioLeases.delete(id);
  }
}

function hasActiveBackgroundAudioLease() {
  pruneInactiveBackgroundAudioLeases();
  return backgroundAudioLeases.size > 0;
}

function publishBackgroundAudioState(
  status: BackgroundAudioState["status"],
  lastInterruption: BackgroundAudioState["lastInterruption"] = backgroundAudioState.lastInterruption,
) {
  const next: BackgroundAudioState = {
    status,
    activeLeaseIds: Array.from(backgroundAudioLeases.keys()),
    lastInterruption,
    revision: backgroundAudioState.revision + 1,
  };
  backgroundAudioState = next;
  if (next.activeLeaseIds.length && status !== "delegated") {
    updateMediaSessionClient("background-retention", {
      active: true, priority: -1, playbackState: "playing",
      metadata: { title: "VatioBoard", artist: "Background audio active" },
      handlers: retentionHandlers,
    });
  } else clearMediaSessionClient("background-retention");
  recordBackgroundDiagnostic("keep-alive-state", { backgroundStatus: status, retainedLeaseIds: next.activeLeaseIds.join(",") });
  for (const listener of backgroundAudioListeners) {
    try { listener(getBackgroundAudioState()); } catch { /* listener isolation */ }
  }
}

function stopKeepAliveIntentionally() {
  intentionalStopDepth += 1;
  try {
    backgroundAudioRetainer.stopKeepAlive();
  } finally {
    intentionalStopDepth -= 1;
  }
}

function handleKeepAliveInterruption(event: Event) {
  if (primaryCarriers.size || intentionalStopDepth > 0 || !backgroundKeepAliveAudio.paused || !hasActiveBackgroundAudioLease()) return;
  if (backgroundAudioState.status === "blocked") return;
  publishBackgroundAudioState("interrupted", event.type === "ended" ? "ended" : "pause");
  queueMicrotask(recoverBackgroundAudioAutomatically);
}

backgroundKeepAliveAudio.addEventListener("play", () => {
  if (primaryCarriers.size) { stopKeepAliveIntentionally(); return; }
  if (hasActiveBackgroundAudioLease()) publishBackgroundAudioState("armed", null);
});
backgroundKeepAliveAudio.addEventListener("pause", handleKeepAliveInterruption);
backgroundKeepAliveAudio.addEventListener("ended", handleKeepAliveInterruption);
// Actual media progress establishes a new recovery episode; play/playing alone
// cannot reset the budget because a browser may immediately pause again.
backgroundKeepAliveAudio.addEventListener("timeupdate", () => {
  if (!backgroundKeepAliveAudio.paused && !backgroundAudioArmPending
    && backgroundAudioState.status === "armed") automaticRecoveryAttempted = false;
});

function shouldKeepBackgroundAudioPlaying(generation) {
  return generation === backgroundAudioGeneration && !primaryCarriers.size && hasActiveBackgroundAudioLease();
}

export function getBackgroundKeepAliveAudio() {
  return backgroundKeepAliveAudio;
}

export function getBackgroundAudioState(): BackgroundAudioState {
  pruneInactiveBackgroundAudioLeases();
  return {
    ...backgroundAudioState,
    activeLeaseIds: Array.from(backgroundAudioLeases.keys()),
  };
}

export function subscribeBackgroundAudioState(listener: (state: BackgroundAudioState) => void) {
  if (typeof listener !== "function") return () => {};
  backgroundAudioListeners.add(listener);
  listener(getBackgroundAudioState());
  return () => backgroundAudioListeners.delete(listener);
}

export function isBackgroundAudioActive() {
  return Boolean(primaryCarriers.size) || !backgroundKeepAliveAudio.paused;
}

export function isBackgroundAudioArmPending() {
  return backgroundAudioArmPending;
}

export function hasBackgroundAudioLease(id) {
  return backgroundAudioLeases.has(normalizeLeaseId(id));
}

export function getBackgroundAudioLeaseCount() {
  pruneInactiveBackgroundAudioLeases();
  return backgroundAudioLeases.size;
}

export function isBackgroundAudioLeaseActive(id) {
  return hasBackgroundAudioLease(id) && isBackgroundAudioActive();
}

export async function rearmBackgroundAudio() {
  if (!hasActiveBackgroundAudioLease()) {
    stopKeepAliveIntentionally();
    publishBackgroundAudioState("idle", null);
    return false;
  }

  if (primaryCarriers.size) {
    publishBackgroundAudioState("delegated", null);
    return true;
  }

  if (backgroundAudioRetainer.isKeepAliveActive()) {
    publishBackgroundAudioState("armed", null);
    return true;
  }

  if (backgroundAudioArmPending) return backgroundAudioArmPromise ?? false;

  const generation = backgroundAudioGeneration;
  backgroundAudioArmPending = true;
  publishBackgroundAudioState("arming", backgroundAudioState.lastInterruption);
  backgroundAudioArmPromise = backgroundAudioRetainer.ensureKeepAlivePlaying({
    shouldContinue: () => !primaryCarriers.size && hasActiveBackgroundAudioLease(),
  }).then((armed) => {
    if (!shouldKeepBackgroundAudioPlaying(generation)) {
      return false;
    }
    armed = armed && !backgroundKeepAliveAudio.paused;
    publishBackgroundAudioState(armed ? "armed" : "blocked", armed ? null : "play-rejected");
    return armed;
  }).catch(() => {
    if (shouldKeepBackgroundAudioPlaying(generation)) {
      publishBackgroundAudioState("blocked", "play-rejected");
    }
    return false;
  }).finally(() => {
    if (generation !== backgroundAudioGeneration) return;
    backgroundAudioArmPending = false;
    backgroundAudioArmPromise = null;
    if (!hasActiveBackgroundAudioLease()) {
      stopKeepAliveIntentionally();
      publishBackgroundAudioState("idle", null);
    }
  });
  return backgroundAudioArmPromise;
}

export async function acquireBackgroundAudioLease(id, { shouldContinue = null } = {}) {
  const leaseId = normalizeLeaseId(id);
  if (!leaseId) return false;

  bindBackgroundAudioLifecycle();
  const alreadyRetained = backgroundAudioLeases.has(leaseId);
  backgroundAudioLeases.set(leaseId, { shouldContinue });

  if (!hasActiveBackgroundAudioLease()) {
    stopKeepAliveIntentionally();
    publishBackgroundAudioState("idle", null);
    return false;
  }

  if (primaryCarriers.size) {
    publishBackgroundAudioState("delegated", null);
    return true;
  }

  if (backgroundAudioRetainer.isKeepAliveActive()) {
    publishBackgroundAudioState("armed", null);
    return true;
  }
  // Repeated feature sync must not turn autoplay rejection into a retry loop.
  if (alreadyRetained && ["blocked", "interrupted"].includes(backgroundAudioState.status)) return false;
  return rearmBackgroundAudio();
}

export function releaseBackgroundAudioLease(id) {
  const leaseId = normalizeLeaseId(id);
  if (!leaseId || !backgroundAudioLeases.has(leaseId)) return;

  backgroundAudioLeases.delete(leaseId);

  if (!hasActiveBackgroundAudioLease()) {
    backgroundAudioGeneration += 1;
    automaticRecoveryAttempted = false;
    backgroundAudioArmPending = false;
    backgroundAudioArmPromise = null;
    stopKeepAliveIntentionally();
    publishBackgroundAudioState("idle", null);
  } else {
    publishBackgroundAudioState(
      backgroundAudioRetainer.isKeepAliveActive() ? "armed" : backgroundAudioState.status,
      backgroundAudioState.lastInterruption,
    );
  }
}

export function disposeAudioSystemForTests() {
  primaryCarriers.clear();
  backgroundAudioLeases.clear();
  backgroundAudioGeneration += 1;
  automaticRecoveryAttempted = false;
  backgroundAudioArmPending = false;
  backgroundAudioArmPromise = null;
  stopKeepAliveIntentionally();
  publishBackgroundAudioState("idle", null);
  backgroundAudioListeners.clear();
}

// Bind lazily: importing a route must not acquire document lifecycle resources.
let lifecycleBound = false;
const recoverWhenVisible = () => { if (!document.hidden) recoverBackgroundAudioAutomatically(); };
function bindBackgroundAudioLifecycle() {
  if (lifecycleBound) return;
  lifecycleBound = true;
  document.addEventListener("visibilitychange", recoverWhenVisible);
  document.addEventListener("resume", recoverBackgroundAudioAutomatically);
  window.addEventListener("pageshow", recoverBackgroundAudioAutomatically);
  navigator.audioSession?.addEventListener?.("statechange", recoverBackgroundAudioAutomatically);
}
