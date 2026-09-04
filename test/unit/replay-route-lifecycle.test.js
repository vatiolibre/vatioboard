import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushTasks } from "../helpers/page-smoke.js";

const REPLAY_PLAYBACK_RATE_LEGACY_KEY = "vatio_replay_playback_rate_v1";
const REPLAY_PLAYBACK_RATE_RUNTIME_KEY = "vatioboard.app.vatio.replay.settings.playbackRate";

vi.mock("../../src/shared/backend-auth.js", () => ({
  BACKEND_AUTH_SIGNUP_URL: "https://www.vatiolibre.com/login#signup",
  BACKEND_AUTH_STATE_EVENT: "vatioboard:backend-auth-state",
  getBackendFeatureAccessState: vi.fn(async () => ({ ok: false })),
  getBackendSessionState: vi.fn(async () => ({
    authenticated: false,
    isGuest: true,
    ok: false,
    status: 0,
  })),
  getSsoSubscribeUrl: vi.fn(() => "https://www.vatiolibre.com/subscribe"),
  getVatioLibreSubscribeUrl: vi.fn(() => "https://www.vatiolibre.com/subscribe"),
  initBackendAuthControllers: vi.fn(),
}));

vi.mock("../../src/shared/cloud-sync.js", () => ({
  CLOUD_SYNC_APPLIED_EVENT: "vatioboard:cloud-sync-applied",
  CLOUD_SYNC_ENTITY_TYPES: {
    accelRun: "accel_run",
    boardDrawing: "board_drawing",
    replaySession: "replay_session",
  },
  CLOUD_SYNC_STATUS_EVENT: "vatioboard:cloud-sync-status",
  CLOUD_SYNC_STATUS_STATES: {
    failed: "failed",
    localOnly: "local_only",
    paused: "paused",
    synced: "synced",
    syncing: "syncing",
  },
  getCloudSyncStatus: vi.fn(() => ({ state: "local_only", reason: "test" })),
  queueCloudSyncDeletion: vi.fn(async () => true),
}));

vi.mock("../../src/shared/repositories/replay-repository.js", () => ({
  clearReplayRestoreFailure: vi.fn(),
  ensureReplayTelemetry: vi.fn(async () => ({ restored: false })),
  getReplaySelection: vi.fn(async () => ({
    records: [],
    selectedRecordingId: null,
    session: null,
    source: "none",
  })),
  listReplayRecords: vi.fn(async () => []),
  registerLinkedReplayCloudRecord: vi.fn(),
  removeReplayRecord: vi.fn(async () => true),
}));

vi.mock("../../src/shared/single-tab.js", () => ({
  ensureSingleTabOwnership: vi.fn(() => Promise.resolve(true)),
  releaseSingleTabOwnership: vi.fn(),
  SINGLE_TAB_OWNERSHIP_EVENT: "vatioboard:single-tab-ownership",
}));

async function settleReplayTasks(iterations = 10) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

function selectedRate() {
  return document.querySelector(".replay-rate-btn[aria-pressed='true']")?.dataset.rate || "";
}

async function mountReplayWithRuntime({ legacyRate = "", runtimeRate = "" } = {}) {
  window.history.replaceState({}, "", "https://vatioboard.com/replay");
  if (legacyRate) localStorage.setItem(REPLAY_PLAYBACK_RATE_LEGACY_KEY, legacyRate);
  const { appRegistry, createAppRuntime } = await import("../../src/app-platform/index.js");
  const { mount } = await import("../../src/app/views/ReplayView.js");
  const manifest = appRegistry.getApp("vatio.replay");
  const runtime = createAppRuntime({ manifest, baseContext: {} });
  if (runtimeRate) runtime.services.settings.set("playbackRate", runtimeRate);
  const root = document.getElementById("root");

  const mounted = await mount(root, {
    appRuntime: runtime,
    appManifest: manifest,
    routeSignal: new AbortController().signal,
  });
  await settleReplayTasks();

  return { mounted, runtime };
}

describe("Replay route lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.head.innerHTML = '<meta name="description" content="Replay test">';
    document.body.innerHTML = '<main id="root"></main>';
    window.__vatioboardSpa = true;
  });

  it("keeps the legacy playback rate key canonical while mirroring to runtime settings", async () => {
    const { mounted } = await mountReplayWithRuntime({
      legacyRate: "100",
      runtimeRate: "4",
    });

    expect(selectedRate()).toBe("100");
    expect(localStorage.getItem(REPLAY_PLAYBACK_RATE_LEGACY_KEY)).toBe("100");
    expect(localStorage.getItem(REPLAY_PLAYBACK_RATE_RUNTIME_KEY)).toBe("100");

    mounted.unmount();
  }, 40000);

  it("seeds the legacy playback rate key from runtime settings only when no legacy value exists", async () => {
    const { mounted } = await mountReplayWithRuntime({
      runtimeRate: "4",
    });

    expect(selectedRate()).toBe("4");
    expect(localStorage.getItem(REPLAY_PLAYBACK_RATE_LEGACY_KEY)).toBe("4");
    expect(localStorage.getItem(REPLAY_PLAYBACK_RATE_RUNTIME_KEY)).toBe("4");

    mounted.unmount();
  }, 40000);

  it("preserves direct route callers without runtime settings", async () => {
    localStorage.setItem(REPLAY_PLAYBACK_RATE_LEGACY_KEY, "10");
    window.history.replaceState({}, "", "https://vatioboard.com/replay");
    const { mount } = await import("../../src/app/views/ReplayView.js");
    const root = document.getElementById("root");

    const mounted = await mount(root, {
      routeSignal: new AbortController().signal,
    });
    await settleReplayTasks();

    expect(selectedRate()).toBe("10");
    expect(localStorage.getItem(REPLAY_PLAYBACK_RATE_RUNTIME_KEY)).toBeNull();

    mounted.unmount();
  }, 40000);
});
