/**
 * Shared audio system coordinator.
 *
 * Keeps page-level audio features from fighting each other in an SPA:
 * - One silent keep-alive audio element for all background audio requests.
 * - Leases let features ask for background audio without stopping each other.
 */

import { createAudioChannelRetainer } from "./audio-channel-retainer.js";

export interface BackgroundAudioState {
  status: "idle" | "arming" | "armed" | "interrupted" | "blocked";
  activeLeaseIds: string[];
  lastInterruption: "pause" | "ended" | "play-rejected" | null;
  revision: number;
}

const backgroundAudioRetainer = createAudioChannelRetainer();
const backgroundKeepAliveAudio = backgroundAudioRetainer.getKeepAliveAudio();
const backgroundAudioLeases = new Map();
const backgroundAudioListeners = new Set<(state: BackgroundAudioState) => void>();

let backgroundAudioGeneration = 0;
let backgroundAudioArmPending = false;
let backgroundAudioArmPromise = null;
let intentionalStopDepth = 0;
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
  if (intentionalStopDepth > 0 || !hasActiveBackgroundAudioLease()) return;
  publishBackgroundAudioState("interrupted", event.type === "ended" ? "ended" : "pause");
}

backgroundKeepAliveAudio.addEventListener("play", () => {
  if (hasActiveBackgroundAudioLease()) publishBackgroundAudioState("armed", null);
});
backgroundKeepAliveAudio.addEventListener("pause", handleKeepAliveInterruption);
backgroundKeepAliveAudio.addEventListener("ended", handleKeepAliveInterruption);

function shouldKeepBackgroundAudioPlaying(generation) {
  return generation === backgroundAudioGeneration && hasActiveBackgroundAudioLease();
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
  return !backgroundKeepAliveAudio.paused;
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

  if (backgroundAudioRetainer.isKeepAliveActive()) {
    publishBackgroundAudioState("armed", null);
    return true;
  }

  if (backgroundAudioArmPending) return backgroundAudioArmPromise ?? false;

  const generation = backgroundAudioGeneration;
  backgroundAudioArmPending = true;
  publishBackgroundAudioState("arming", backgroundAudioState.lastInterruption);
  backgroundAudioArmPromise = backgroundAudioRetainer.ensureKeepAlivePlaying({
    shouldContinue: () => shouldKeepBackgroundAudioPlaying(generation),
  }).then((armed) => {
    if (!shouldKeepBackgroundAudioPlaying(generation)) {
      stopKeepAliveIntentionally();
      publishBackgroundAudioState("idle", null);
      return false;
    }
    publishBackgroundAudioState(armed ? "armed" : "blocked", armed ? null : "play-rejected");
    return armed;
  }).catch(() => {
    if (shouldKeepBackgroundAudioPlaying(generation)) {
      publishBackgroundAudioState("blocked", "play-rejected");
    }
    return false;
  }).finally(() => {
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

  backgroundAudioLeases.set(leaseId, { shouldContinue });

  if (!hasActiveBackgroundAudioLease()) {
    stopKeepAliveIntentionally();
    publishBackgroundAudioState("idle", null);
    return false;
  }

  if (backgroundAudioRetainer.isKeepAliveActive()) {
    publishBackgroundAudioState("armed", null);
    return true;
  }
  return rearmBackgroundAudio();
}

export function releaseBackgroundAudioLease(id) {
  const leaseId = normalizeLeaseId(id);
  if (!leaseId || !backgroundAudioLeases.has(leaseId)) return;

  backgroundAudioLeases.delete(leaseId);

  if (!hasActiveBackgroundAudioLease()) {
    backgroundAudioGeneration += 1;
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
  backgroundAudioLeases.clear();
  backgroundAudioGeneration += 1;
  backgroundAudioArmPending = false;
  backgroundAudioArmPromise = null;
  stopKeepAliveIntentionally();
  publishBackgroundAudioState("idle", null);
  backgroundAudioListeners.clear();
}
