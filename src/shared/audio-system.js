/**
 * Shared audio system coordinator.
 *
 * Keeps page-level audio features from fighting each other in an SPA:
 * - One silent keep-alive audio element for all background audio requests.
 * - Leases let features ask for background audio without stopping each other.
 */

import { createAudioChannelRetainer } from "./audio-channel-retainer.js";

const backgroundAudioRetainer = createAudioChannelRetainer();
const backgroundKeepAliveAudio = backgroundAudioRetainer.getKeepAliveAudio();
const backgroundAudioLeases = new Map();

let backgroundAudioGeneration = 0;
let backgroundAudioArmPending = false;
let backgroundAudioArmPromise = null;

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

function shouldKeepBackgroundAudioPlaying(generation) {
  return generation === backgroundAudioGeneration && hasActiveBackgroundAudioLease();
}

export function getBackgroundKeepAliveAudio() {
  return backgroundKeepAliveAudio;
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

export async function acquireBackgroundAudioLease(id, { shouldContinue = null } = {}) {
  const leaseId = normalizeLeaseId(id);
  if (!leaseId) return false;

  backgroundAudioLeases.set(leaseId, { shouldContinue });

  if (!hasActiveBackgroundAudioLease()) {
    backgroundAudioRetainer.stopKeepAlive();
    return false;
  }

  if (backgroundAudioRetainer.isKeepAliveActive()) {
    return true;
  }

  if (backgroundAudioArmPending) {
    return backgroundAudioArmPromise ?? false;
  }

  const generation = backgroundAudioGeneration;
  backgroundAudioArmPending = true;

  backgroundAudioArmPromise = (async () => {
    const armed = await backgroundAudioRetainer.ensureKeepAlivePlaying({
      shouldContinue: () => shouldKeepBackgroundAudioPlaying(generation),
    });

    if (!armed && !shouldKeepBackgroundAudioPlaying(generation)) {
      backgroundAudioRetainer.stopKeepAlive();
    }

    return armed;
  })().catch(() => {
    if (!shouldKeepBackgroundAudioPlaying(generation)) {
      backgroundAudioRetainer.stopKeepAlive();
    }
    return false;
  }).finally(() => {
    backgroundAudioArmPending = false;
    backgroundAudioArmPromise = null;
    if (!hasActiveBackgroundAudioLease()) {
      backgroundAudioRetainer.stopKeepAlive();
    }
  });

  return backgroundAudioArmPromise;
}

export function releaseBackgroundAudioLease(id) {
  const leaseId = normalizeLeaseId(id);
  if (!leaseId || !backgroundAudioLeases.has(leaseId)) return;

  backgroundAudioLeases.delete(leaseId);
  backgroundAudioGeneration += 1;

  if (!hasActiveBackgroundAudioLease()) {
    backgroundAudioArmPending = false;
    backgroundAudioArmPromise = null;
    backgroundAudioRetainer.stopKeepAlive();
  }
}

export function disposeAudioSystemForTests() {
  backgroundAudioLeases.clear();
  backgroundAudioGeneration += 1;
  backgroundAudioArmPending = false;
  backgroundAudioArmPromise = null;
  backgroundAudioRetainer.stopKeepAlive();
}
