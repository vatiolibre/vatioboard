import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, flushTasks } from "../helpers/page-smoke.js";

// ── Hoisted mocks ────────────────────────────────────────────────────

const mockMediaCache = vi.hoisted(() => ({
  getCachedManifestSnapshot: vi.fn().mockResolvedValue(null),
  getCachedMediaManifest: vi.fn().mockResolvedValue(null),
  cacheManifestSnapshot: vi.fn().mockResolvedValue(true),
  cacheMediaManifest: vi.fn().mockResolvedValue(true),
  cacheMediaMetadata: vi.fn().mockResolvedValue(true),
  getLocalMediaBlob: vi.fn().mockResolvedValue(null),
  getLocalBlobMeta: vi.fn().mockResolvedValue(null),
  isAutoCacheEligible: vi.fn().mockReturnValue(false),
  registerAutoCacheDownload: vi.fn(),
  cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
  setMediaCacheUser: vi.fn(),
  getMediaCacheUser: vi.fn().mockReturnValue(null),
  restorePersistedMediaCacheUser: vi.fn().mockReturnValue(null),
  clearPersistedMediaCacheUser: vi.fn(),
  getCachedManifestToken: vi.fn().mockResolvedValue(null),
  cacheManifestToken: vi.fn().mockResolvedValue(true),
  getCachedBlobMeta: vi.fn().mockResolvedValue(null),
  getCachedMediaBlob: vi.fn().mockResolvedValue(null),
  removeCachedMediaBlob: vi.fn().mockResolvedValue(true),
  deriveLocalAvailability: vi.fn().mockReturnValue("cloud-only"),
  pinMediaBlob: vi.fn().mockResolvedValue(true),
  getPinnedMediaBlob: vi.fn().mockResolvedValue(null),
  getPinnedBlobMeta: vi.fn().mockResolvedValue(null),
  unpinMediaBlob: vi.fn().mockResolvedValue(true),
  isMediaBlobPinned: vi.fn().mockResolvedValue(false),
  removeCachedMediaMetadata: vi.fn().mockResolvedValue(true),
  getCachedMediaMetadata: vi.fn().mockResolvedValue(undefined),
  isAutoCacheInFlight: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/shared/media-cache.js", () => mockMediaCache);

// Mock media-access-cache (in-memory signed URL cache used by audio-source-resolver)
vi.mock("../../src/shared/media-access-cache.js", () => ({
  getCachedMediaAccess: vi.fn().mockReturnValue(null),
  setCachedMediaAccess: vi.fn(),
  clearMediaAccessCache: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────

async function settlePlayerTasks(iterations = 24) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

/** Open the widget panel and queue sheet so track items appear in the DOM. */
function openWidgetQueue(playerPage) {
  playerPage.widget.open();
  document.querySelector(".player-content-toggle-btn")?.click();
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, reject, resolve };
}

function getFetchUrl(input) {
  return typeof input === "string" ? input : String(input?.url ?? "");
}

function countFetchCalls(fetchMock, needle) {
  return fetchMock.mock.calls.filter(([input]) => getFetchUrl(input).includes(needle)).length;
}

async function deleteIndexedDbDatabase(name) {
  if (typeof indexedDB === "undefined" || typeof indexedDB.deleteDatabase !== "function") return;

  await new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

const AUDIO_ASSET_1 = {
  name: "AUDIO-1",
  title: "Morning Ride",
  media_kind: "audio",
  blob_size: 4096,
  original_filename: "morning-ride.mp3",
  content_hash: "hash-a1",
  modified_at: "2026-04-03T09:00:00Z",
  created_at_label: "2026-04-03",
  modified_at_label: "2026-04-03",
  folder_path: "Music",
  has_preview_image: false,
  file_extension: "mp3",
};

const AUDIO_ASSET_2 = {
  name: "AUDIO-2",
  title: "Highway Run",
  media_kind: "audio",
  blob_size: 8192,
  original_filename: "highway-run.flac",
  content_hash: "hash-a2",
  modified_at: "2026-04-04T10:00:00Z",
  created_at_label: "2026-04-04",
  modified_at_label: "2026-04-04",
  folder_path: "Recordings",
  has_preview_image: false,
  file_extension: "flac",
};

const VIDEO_ASSET = {
  name: "VIDEO-1",
  title: "Dashcam Clip",
  media_kind: "video",
  blob_size: 50000,
  original_filename: "dashcam.mp4",
  content_hash: "hash-v1",
};

const IMAGE_ASSET = {
  name: "IMG-1",
  title: "Track Photo",
  media_kind: "image",
  blob_size: 2048,
  original_filename: "photo.jpg",
  content_hash: "hash-i1",
};

const MIME_AUDIO_ASSET = {
  name: "AUDIO-3",
  title: "Opus Recording",
  media_kind: "",
  mime_type: "audio/opus",
  blob_size: 3072,
  original_filename: "recording.opus",
  content_hash: "hash-a3",
  modified_at: "2026-04-05T11:00:00Z",
  folder_path: "Voice",
};

const DEMO_TRACK_TITAN = {
  name: "demo:titan",
  title: "Titan",
  media_kind: "audio",
  original_filename: "sb_titan.mp3",
  src: "/audio/demo/sb_titan.mp3",
  duration: 123,
};

const DEMO_TRACK_ON_THE_RUN = {
  name: "demo:on-the-run",
  title: "On The Run",
  media_kind: "audio",
  original_filename: "On The Run.mp3",
  src: "/audio/demo/On The Run.mp3",
  duration: 182.5,
};

const DEMO_TRACK_ROCKER_CHICKS = {
  name: "demo:rocker-chicks",
  title: "Rocker Chicks",
  media_kind: "audio",
  original_filename: "RockerChicks.mp3",
  src: "/audio/demo/RockerChicks.mp3",
  duration: 90.1,
};

const PLAYER_SESSION_STORAGE_KEY = "vatioboard_player_session_v2";

function createAuthenticatedPlayerFetch({ assets = [AUDIO_ASSET_1, AUDIO_ASSET_2] } = {}) {
  return vi.fn(async (input) => {
    const url = typeof input === "string" ? input : String(input?.url ?? "");

    if (url.includes("/api/method/vatiolibre.vatiolibre.sso.status")) {
      return jsonResponse({ message: { connected: false, is_guest: false } });
    }
    if (url.includes("/api/method/frappe.auth.get_logged_user")) {
      return jsonResponse({ message: "player-user@vatiolibre.com" });
    }
    if (url.includes("/api/method/vatiolibre.vatiolibre.feature_access.get_my_feature_access")) {
      return jsonResponse({
        message: {
          has_active_subscription: true,
          csrf_token: "csrf-test-token",
          features: {
            cloud_sync: { enabled: true },
            media_assets: { enabled: true },
          },
        },
      });
    }
    if (url.includes("get_my_media_manifest_version")) {
      return jsonResponse({
        message: { manifest_token: "manifest-token-v1", total_count: assets.length },
      });
    }
    if (url.includes("get_my_media_manifest")) {
      return jsonResponse({
        message: {
          assets,
          manifest_token: "manifest-token-v1",
          total_count: assets.length,
        },
      });
    }
    if (url.includes("list_my_media_assets")) {
      return jsonResponse({
        message: { assets, total_count: assets.length, has_more: false, next_offset: assets.length },
      });
    }
    if (url.includes("get_my_media_asset_access")) {
      const params = new URL(url, "https://api.vatioboard.com").searchParams;
      const assetName = params.get("name") || "unknown";
      return jsonResponse({
        message: {
          asset: { name: assetName, content_hash: "hash-access" },
          access: {
            playback_url: `https://cdn.example.com/signed/${encodeURIComponent(assetName)}.mp3`,
            download_url: `https://cdn.example.com/dl/${encodeURIComponent(assetName)}.mp3`,
            expires_in_seconds: 300,
          },
        },
      });
    }
    return jsonResponse({});
  });
}

function createUnauthenticatedFetch() {
  return vi.fn(async (input) => {
    const url = typeof input === "string" ? input : String(input?.url ?? "");

    if (url.includes("/api/method/vatiolibre.vatiolibre.sso.status")) {
      return jsonResponse({ message: { connected: false, is_guest: true } }, 200);
    }
    // All authenticated endpoints return 403
    return jsonResponse({ exc_type: "PermissionError" }, 403);
  });
}

function createGuestDemoFetch({ demoTracks = [DEMO_TRACK_TITAN] } = {}) {
  return vi.fn(async (input) => {
    const url = typeof input === "string" ? input : String(input?.url ?? "");

    if (url.includes("/api/method/vatiolibre.vatiolibre.sso.status")) {
      return jsonResponse({ message: { connected: false, is_guest: true } }, 200);
    }
    if (url.endsWith("/audio/demo/playlist.json")) {
      return new Response(JSON.stringify(demoTracks), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return jsonResponse({ exc_type: "PermissionError" }, 403);
  });
}

function createOfflineFetch() {
  return vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("player cold boot", () => {
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    await deleteIndexedDbDatabase("vatioboard_demo_playlist");
    await deleteIndexedDbDatabase("vatioboard_demo_track_blobs");
    Object.values(mockMediaCache).forEach((fn) => {
      if (typeof fn.mockReset === "function") fn.mockReset();
    });
    mockMediaCache.getCachedManifestSnapshot.mockResolvedValue(null);
    mockMediaCache.getCachedMediaManifest.mockResolvedValue(null);
    mockMediaCache.cacheManifestSnapshot.mockResolvedValue(true);
    mockMediaCache.setMediaCacheUser.mockReturnValue(undefined);
    mockMediaCache.getMediaCacheUser.mockReturnValue(null);
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue(null);
    mockMediaCache.clearPersistedMediaCacheUser.mockReturnValue(undefined);
    mockMediaCache.getLocalMediaBlob.mockResolvedValue(null);
    mockMediaCache.getLocalBlobMeta.mockResolvedValue(null);
    mockMediaCache.isAutoCacheEligible.mockReturnValue(false);
    mockMediaCache.registerAutoCacheDownload.mockReturnValue(true);
    mockMediaCache.cacheMediaBlob.mockResolvedValue(undefined);
  });

  // ── Cold authenticated visit with no local manifest ──────────────

  it("cold authenticated visit fetches backend media and renders audio tracks", async () => {
    window.fetch = createAuthenticatedPlayerFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    // Auth bootstrap should set the cache user
    expect(mockMediaCache.setMediaCacheUser).toHaveBeenCalledWith("player-user@vatiolibre.com");

    expect(countFetchCalls(window.fetch, "get_my_media_manifest")).toBeGreaterThan(0);

    // Backend manifest should have been fetched and cached
    expect(mockMediaCache.cacheManifestSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: expect.any(Array),
      }),
    );

    // Open the widget and queue to see track items in the DOM
    openWidgetQueue(playerPage);
    await settlePlayerTasks(4);

    const trackItems = document.querySelectorAll(".player-queue-item");
    expect(trackItems.length).toBeGreaterThanOrEqual(2);

    // Should show audio titles
    const trackNames = Array.from(trackItems).map((li) => li.textContent);
    expect(trackNames.some((n) => n.includes("Morning Ride"))).toBe(true);
    expect(trackNames.some((n) => n.includes("Highway Run"))).toBe(true);
  });

  // ── Offline visit with persisted namespace + cached manifest ─────

  it("offline visit with persisted namespace renders audio tracks without network", async () => {
    // Simulate persisted namespace + cached manifest (prior visit)
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("player-user@vatiolibre.com");
    mockMediaCache.getCachedManifestSnapshot.mockResolvedValue({
      assets: [AUDIO_ASSET_1, AUDIO_ASSET_2],
      token: "manifest-token-v1",
    });

    window.fetch = createOfflineFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    // Should restore persisted user (not set fresh)
    expect(mockMediaCache.restorePersistedMediaCacheUser).toHaveBeenCalled();

    // Open the widget and queue to see track items
    openWidgetQueue(playerPage);
    await settlePlayerTasks(4);

    const trackItems = document.querySelectorAll(".player-queue-item");
    expect(trackItems.length).toBeGreaterThanOrEqual(2);
  });

  // ── Does not require a prior /library visit ──────────────────────

  it("does not require a prior /library visit to show tracks", async () => {
    // No cached manifest, no persisted user — completely fresh
    mockMediaCache.getCachedManifestSnapshot.mockResolvedValue(null);
    mockMediaCache.getCachedMediaManifest.mockResolvedValue(null);
    mockMediaCache.getMediaCacheUser.mockReturnValue(null);

    window.fetch = createAuthenticatedPlayerFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    // Auth should bootstrap independently
    expect(mockMediaCache.setMediaCacheUser).toHaveBeenCalledWith("player-user@vatiolibre.com");

    // Open widget and queue to see tracks
    openWidgetQueue(playerPage);
    await settlePlayerTasks(4);

    const trackItems = document.querySelectorAll(".player-queue-item");
    expect(trackItems.length).toBeGreaterThanOrEqual(1);
  });

  it("guest cold boot restores the saved demo track at the same playback position", async () => {
    localStorage.setItem(PLAYER_SESSION_STORAGE_KEY, JSON.stringify({
      version: 2,
      queueEntries: [{
        entryId: "demo_entry",
        name: DEMO_TRACK_TITAN.name,
        title: DEMO_TRACK_TITAN.title,
        artist: "",
        album: "",
        genre: "",
        duration: DEMO_TRACK_TITAN.duration,
        artwork_ref: "",
        media_kind: "audio",
        original_filename: DEMO_TRACK_TITAN.original_filename,
        content_hash: "",
        mime_type: "audio/mp3",
        blob_size: 0,
        file_extension: "mp3",
        folder_path: "",
        src: DEMO_TRACK_TITAN.src,
      }],
      playedEntries: [],
      currentEntryId: "demo_entry",
      currentIndex: 0,
      currentTime: 42,
      paused: true,
      volume: 0.88,
      muted: false,
      repeat: "off",
      shuffle: false,
      backgroundMode: false,
    }));

    window.fetch = createGuestDemoFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    const runtime = await import("../../src/shared/audio-runtime.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    const audioEl = runtime.getAudioElement();
    audioEl.dispatchEvent(new Event("loadedmetadata"));
    audioEl.currentTime = 0;
    audioEl.dispatchEvent(new Event("canplay"));

    const state = runtime.getState();
    expect(state.currentTrack?.name).toBe("demo:titan");
    expect(state.queue.map((track) => track.name)).toEqual(["demo:titan"]);
    expect(audioEl.currentTime).toBeGreaterThanOrEqual(41.5);
    expect(audioEl.currentTime).toBeLessThanOrEqual(42.5);
    expect(state.currentTime).toBeGreaterThanOrEqual(41.5);
    expect(state.currentTime).toBeLessThanOrEqual(42.5);
    expect(countFetchCalls(window.fetch, "/audio/demo/playlist.json")).toBeGreaterThan(0);
  });

  it("guest cold boot preserves the saved demo queue order and current item from a multi-track playlist", async () => {
    localStorage.setItem(PLAYER_SESSION_STORAGE_KEY, JSON.stringify({
      version: 2,
      queueEntries: [
        {
          entryId: "queue_a",
          name: DEMO_TRACK_ON_THE_RUN.name,
          title: DEMO_TRACK_ON_THE_RUN.title,
          artist: "",
          album: "",
          genre: "",
          duration: DEMO_TRACK_ON_THE_RUN.duration,
          artwork_ref: "",
          media_kind: "audio",
          original_filename: DEMO_TRACK_ON_THE_RUN.original_filename,
          content_hash: "",
          mime_type: "audio/mp3",
          blob_size: 0,
          file_extension: "mp3",
          folder_path: "",
          src: DEMO_TRACK_ON_THE_RUN.src,
        },
        {
          entryId: "queue_b",
          name: DEMO_TRACK_ROCKER_CHICKS.name,
          title: DEMO_TRACK_ROCKER_CHICKS.title,
          artist: "",
          album: "",
          genre: "",
          duration: DEMO_TRACK_ROCKER_CHICKS.duration,
          artwork_ref: "",
          media_kind: "audio",
          original_filename: DEMO_TRACK_ROCKER_CHICKS.original_filename,
          content_hash: "",
          mime_type: "audio/mp3",
          blob_size: 0,
          file_extension: "mp3",
          folder_path: "",
          src: DEMO_TRACK_ROCKER_CHICKS.src,
        },
        {
          entryId: "queue_c",
          name: DEMO_TRACK_TITAN.name,
          title: DEMO_TRACK_TITAN.title,
          artist: "",
          album: "",
          genre: "",
          duration: DEMO_TRACK_TITAN.duration,
          artwork_ref: "",
          media_kind: "audio",
          original_filename: DEMO_TRACK_TITAN.original_filename,
          content_hash: "",
          mime_type: "audio/mp3",
          blob_size: 0,
          file_extension: "mp3",
          folder_path: "",
          src: DEMO_TRACK_TITAN.src,
        },
      ],
      playedEntries: [],
      currentEntryId: "queue_c",
      currentIndex: 2,
      currentTime: 42,
      paused: true,
      volume: 0.88,
      muted: false,
      repeat: "off",
      shuffle: false,
      backgroundMode: false,
    }));

    window.fetch = createGuestDemoFetch({
      demoTracks: [
        DEMO_TRACK_ON_THE_RUN,
        DEMO_TRACK_ROCKER_CHICKS,
        DEMO_TRACK_TITAN,
      ],
    });

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    const runtime = await import("../../src/shared/audio-runtime.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    const audioEl = runtime.getAudioElement();
    audioEl.dispatchEvent(new Event("loadedmetadata"));
    audioEl.currentTime = 0;
    audioEl.dispatchEvent(new Event("canplay"));

    const state = runtime.getState();
    expect(state.queue.map((track) => track._queueId)).toEqual(["queue_a", "queue_b", "queue_c"]);
    expect(state.currentIndex).toBe(2);
    expect(state.currentTrack?._queueId).toBe("queue_c");
    expect(audioEl.currentTime).toBeGreaterThanOrEqual(41.5);
    expect(audioEl.currentTime).toBeLessThanOrEqual(42.5);
  });

  it("guest pagehide flush preserves the active demo track and playback second", async () => {
    window.fetch = createGuestDemoFetch({
      demoTracks: [
        DEMO_TRACK_ON_THE_RUN,
        DEMO_TRACK_ROCKER_CHICKS,
        DEMO_TRACK_TITAN,
      ],
    });

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    const runtime = await import("../../src/shared/audio-runtime.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    await runtime.playCatalogTrack("demo:titan", runtime.getState().queue);
    await settlePlayerTasks();

    const audioEl = runtime.getAudioElement();
    const activeQueueId = runtime.getState().currentTrack?._queueId;
    audioEl.currentTime = 42;
    audioEl.dispatchEvent(new Event("timeupdate"));
    runtime.pause();
    await settlePlayerTasks();

    window.dispatchEvent(new Event("pagehide"));

    const saved = JSON.parse(localStorage.getItem(PLAYER_SESSION_STORAGE_KEY));
    expect(saved.currentIndex).toBe(2);
    expect(saved.currentEntryId).toBe(activeQueueId);
    expect(saved.currentTime).toBe(42);
    expect(saved.paused).toBe(true);
  });

  it("guest refresh cycle keeps the saved demo queue item and second", async () => {
    const demoTracks = [
      DEMO_TRACK_ON_THE_RUN,
      DEMO_TRACK_ROCKER_CHICKS,
      DEMO_TRACK_TITAN,
    ];

    window.fetch = createGuestDemoFetch({ demoTracks });

    await bootHtmlPage("player.html");
    const firstPage = await import("../../src/player/player-demo.js");
    const firstRuntime = await import("../../src/shared/audio-runtime.js");
    await firstPage.initPromise;
    await settlePlayerTasks();

    await firstRuntime.playCatalogTrack("demo:titan", firstRuntime.getState().queue);
    await settlePlayerTasks();

    const firstAudioEl = firstRuntime.getAudioElement();
    firstAudioEl.currentTime = 42;
    firstAudioEl.dispatchEvent(new Event("timeupdate"));
    firstRuntime.pause();
    await settlePlayerTasks();
    window.dispatchEvent(new Event("pagehide"));

    const persistedBeforeRefresh = JSON.parse(localStorage.getItem(PLAYER_SESSION_STORAGE_KEY));
    expect(persistedBeforeRefresh.currentIndex).toBe(2);
    expect(persistedBeforeRefresh.currentTime).toBe(42);

    vi.resetModules();
    window.fetch = createGuestDemoFetch({ demoTracks });

    await bootHtmlPage("player.html");
    const refreshedPage = await import("../../src/player/player-demo.js");
    const refreshedRuntime = await import("../../src/shared/audio-runtime.js");
    await refreshedPage.initPromise;
    await settlePlayerTasks();

    const refreshedAudioEl = refreshedRuntime.getAudioElement();
    refreshedAudioEl.dispatchEvent(new Event("loadedmetadata"));
    refreshedAudioEl.currentTime = 0;
    refreshedAudioEl.dispatchEvent(new Event("canplay"));

    const refreshedState = refreshedRuntime.getState();
    const persistedAfterRefresh = JSON.parse(localStorage.getItem(PLAYER_SESSION_STORAGE_KEY));
    expect(refreshedState.currentIndex).toBe(2);
    expect(refreshedState.currentTrack?.name).toBe("demo:titan");
    expect(refreshedState.currentTime).toBeGreaterThanOrEqual(41.5);
    expect(persistedAfterRefresh.currentIndex).toBe(2);
    expect(persistedAfterRefresh.currentTime).toBe(42);
  });

  it("fresh boot uses the 0.88 default volume when no saved session exists", async () => {
    window.fetch = createAuthenticatedPlayerFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    const runtime = await import("../../src/shared/audio-runtime.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    expect(runtime.getState().volume).toBe(0.88);
  });

  it("cold boot restores the exact saved queue order and current queue item", async () => {
    localStorage.setItem(PLAYER_SESSION_STORAGE_KEY, JSON.stringify({
      version: 2,
      queueEntries: [
        {
          entryId: "dup_a_1",
          name: "AUDIO-1",
          title: "Morning Ride",
          media_kind: "audio",
          original_filename: "morning-ride.mp3",
          content_hash: "hash-a1",
          blob_size: 4096,
          folder_path: "Music",
          src: "",
        },
        {
          entryId: "snapshot_missing",
          name: "ARCHIVE-LOST",
          title: "Archived Cut",
          artist: "Archive Artist",
          album: "Lost Sessions",
          duration: 61,
          media_kind: "audio",
          content_hash: "hash-archive",
          blob_size: 0,
          src: "",
        },
        {
          entryId: "dup_a_2",
          name: "AUDIO-1",
          title: "Morning Ride",
          media_kind: "audio",
          original_filename: "morning-ride.mp3",
          content_hash: "hash-a1",
          blob_size: 4096,
          folder_path: "Music",
          src: "",
        },
        {
          entryId: "entry_b",
          name: "AUDIO-2",
          title: "Highway Run",
          media_kind: "audio",
          original_filename: "highway-run.flac",
          content_hash: "hash-a2",
          blob_size: 8192,
          folder_path: "Recordings",
          src: "",
        },
      ],
      currentEntryId: "dup_a_2",
      currentIndex: 2,
      currentTime: 17,
      paused: true,
      volume: 0.67,
      muted: false,
      repeat: "all",
      shuffle: false,
      backgroundMode: true,
    }));

    window.fetch = createAuthenticatedPlayerFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    const runtime = await import("../../src/shared/audio-runtime.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    await vi.waitFor(() => {
      const s = runtime.getState();
      expect(s.queue).toHaveLength(4);
      expect(s.currentIndex).toBe(2);
      expect(s.currentTrack?._queueId).toBe("dup_a_2");
      expect(s.queue[1].name).toBe("ARCHIVE-LOST");
      expect(s.queue[1].title).toBe("Archived Cut");
      expect(s.volume).toBe(0.67);
      expect(s.backgroundMode).toBe(true);
    });
  });

  it("background catalog refresh does not replace a restored first queue item", async () => {
    localStorage.setItem(PLAYER_SESSION_STORAGE_KEY, JSON.stringify({
      version: 2,
      queueEntries: [
        {
          entryId: "entry_a",
          name: "AUDIO-1",
          title: "Morning Ride",
          media_kind: "audio",
          original_filename: "morning-ride.mp3",
          content_hash: "hash-a1",
          blob_size: 4096,
          folder_path: "Music",
          src: "",
        },
        {
          entryId: "entry_b",
          name: "AUDIO-2",
          title: "Highway Run",
          media_kind: "audio",
          original_filename: "highway-run.flac",
          content_hash: "hash-a2",
          blob_size: 8192,
          folder_path: "Recordings",
          src: "",
        },
      ],
      currentEntryId: "entry_a",
      currentIndex: 0,
      currentTime: 17,
      paused: true,
      volume: 0.67,
      muted: false,
      repeat: "off",
      shuffle: false,
      backgroundMode: false,
    }));

    window.fetch = createAuthenticatedPlayerFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    const runtime = await import("../../src/shared/audio-runtime.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    await vi.waitFor(() => {
      const s = runtime.getState();
      expect(s.queue).toHaveLength(2);
      expect(s.currentIndex).toBe(0);
      expect(s.currentTrack?._queueId).toBe("entry_a");
      expect(s.currentTime).toBe(17);
    });
  });

  it("cold boot resumes playback when the saved player status was playing", async () => {
    localStorage.setItem(PLAYER_SESSION_STORAGE_KEY, JSON.stringify({
      version: 2,
      queueEntries: [
        {
          entryId: "entry_b",
          name: "AUDIO-2",
          title: "Highway Run",
          media_kind: "audio",
          original_filename: "highway-run.flac",
          content_hash: "hash-a2",
          blob_size: 8192,
          folder_path: "Recordings",
          src: "",
        },
      ],
      currentEntryId: "entry_b",
      currentIndex: 0,
      currentTime: 23,
      paused: false,
      volume: 0.67,
      muted: false,
      repeat: "off",
      shuffle: false,
      backgroundMode: false,
    }));

    window.fetch = createAuthenticatedPlayerFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    const runtime = await import("../../src/shared/audio-runtime.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    await vi.waitFor(() => {
      const s = runtime.getState();
      expect(s.currentTrack?._queueId).toBe("entry_b");
      expect(s.currentTrack?.name).toBe("AUDIO-2");
      expect(s.currentTime).toBe(23);
      expect(s.paused).toBe(false);
      expect(s.playing).toBe(true);
      expect(runtime.getAudioElement()?.currentTime).toBe(23);
    });
  });

  // ── Audio filter accepts mime_type-based items ───────────────────

  it("audio filter accepts mime_type-based audio items", async () => {
    window.fetch = createAuthenticatedPlayerFetch({
      assets: [AUDIO_ASSET_1, MIME_AUDIO_ASSET, VIDEO_ASSET, IMAGE_ASSET],
    });

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    openWidgetQueue(playerPage);
    await settlePlayerTasks(4);

    const trackItems = document.querySelectorAll(".player-queue-item");
    const trackNames = Array.from(trackItems).map((li) => li.textContent);

    // Audio items (by media_kind or mime_type) should be included
    expect(trackNames.some((n) => n.includes("Morning Ride"))).toBe(true);
    expect(trackNames.some((n) => n.includes("Opus Recording"))).toBe(true);

    // Video and image should be excluded
    expect(trackNames.some((n) => n.includes("Dashcam Clip"))).toBe(false);
    expect(trackNames.some((n) => n.includes("Track Photo"))).toBe(false);
  });

  // ── Non-audio assets stay excluded ───────────────────────────────

  it("non-audio assets are excluded from the track list", async () => {
    window.fetch = createAuthenticatedPlayerFetch({
      assets: [VIDEO_ASSET, IMAGE_ASSET],
    });

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    openWidgetQueue(playerPage);
    await settlePlayerTasks(4);

    const trackItems = document.querySelectorAll(".player-queue-item");
    expect(trackItems.length).toBe(0);

    // Empty state should show in queue list
    const emptyEl = document.querySelector(".player-queue-list .player-queue-empty");
    expect(emptyEl).toBeTruthy();
  });

  // ── At least one visible track element after successful boot ─────

  it("at least one visible track element appears in the DOM after boot", async () => {
    window.fetch = createAuthenticatedPlayerFetch({
      assets: [AUDIO_ASSET_1],
    });

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    openWidgetQueue(playerPage);
    await settlePlayerTasks(4);

    const trackItem = document.querySelector(".player-queue-item");
    expect(trackItem).toBeTruthy();
    expect(trackItem.textContent).toContain("Morning Ride");
  });

  // ── Track list is visible without toggling queue drawer ──────────

  it("queue sheet is accessible via toggle button", async () => {
    window.fetch = createAuthenticatedPlayerFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    // Widget panel exists and has a queue sheet
    playerPage.widget.open();
    const queueSheet = document.querySelector(".player-content-pane-queue");
    expect(queueSheet).toBeTruthy();

    // Queue is initially collapsed
    expect(queueSheet.classList.contains("is-open")).toBe(false);

    // Click the toggle to open
    document.querySelector(".player-content-toggle-btn")?.click();
    expect(queueSheet.classList.contains("is-open")).toBe(true);

    // Old queue drawer should not exist
    expect(document.querySelector(".player-queue-drawer")).toBeNull();
  });

  // ── Unauthenticated visit clears namespace ───────────────────────

  it("unauthenticated visit clears persisted namespace", async () => {
    window.fetch = createUnauthenticatedFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    expect(mockMediaCache.clearPersistedMediaCacheUser).toHaveBeenCalled();
    expect(countFetchCalls(window.fetch, "get_my_media_manifest_version")).toBe(0);
    expect(countFetchCalls(window.fetch, "get_my_media_manifest")).toBe(0);
    expect(countFetchCalls(window.fetch, "list_my_media_assets")).toBe(0);
    expect(countFetchCalls(window.fetch, "get_my_media_asset_detail")).toBe(0);
    expect(countFetchCalls(window.fetch, "get_my_media_asset_access")).toBe(0);
  });

  it("auth-pending boot waits for the session probe before firing manifest requests", async () => {
    const sessionProbe = createDeferred();
    const fetchMock = vi.fn(async (input) => {
      const url = getFetchUrl(input);

      if (url.includes("/api/method/vatiolibre.vatiolibre.sso.status")) {
        return sessionProbe.promise;
      }
      if (url.includes("/api/method/frappe.auth.get_logged_user")) {
        return jsonResponse({ message: "player-user@vatiolibre.com" });
      }
      if (url.includes("/api/method/vatiolibre.vatiolibre.feature_access.get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true,
            csrf_token: "csrf-test-token",
            features: {
              cloud_sync: { enabled: true },
              media_assets: { enabled: true },
            },
          },
        });
      }
      if (url.includes("get_my_media_manifest")) {
        return jsonResponse({
          message: {
            assets: [AUDIO_ASSET_1],
            manifest_token: "manifest-token-v1",
            total_count: 1,
          },
        });
      }
      if (url.includes("get_my_media_manifest_version")) {
        return jsonResponse({
          message: { manifest_token: "manifest-token-v1", total_count: 1 },
        });
      }
      return jsonResponse({});
    });
    window.fetch = fetchMock;

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    await flushTasks();
    await flushTasks();

    expect(countFetchCalls(fetchMock, "get_my_media_manifest")).toBe(0);
    expect(countFetchCalls(fetchMock, "get_my_media_manifest_version")).toBe(0);

    sessionProbe.resolve(jsonResponse({ message: { connected: false, is_guest: false } }));

    await playerPage.initPromise;
    await settlePlayerTasks();

    expect(countFetchCalls(fetchMock, "get_my_media_manifest")).toBeGreaterThan(0);
  });

  it("logout during manifest bootstrap aborts the in-flight request and skips follow-up protected calls", async () => {
    let manifestAbortCount = 0;
    let manifestStarted = false;
    const fetchMock = vi.fn(async (input, init = {}) => {
      const url = getFetchUrl(input);

      if (url.includes("/api/method/vatiolibre.vatiolibre.sso.status")) {
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("/api/method/frappe.auth.get_logged_user")) {
        return jsonResponse({ message: "player-user@vatiolibre.com" });
      }
      if (url.includes("/api/method/vatiolibre.vatiolibre.feature_access.get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true,
            csrf_token: "csrf-test-token",
            features: {
              cloud_sync: { enabled: true },
              media_assets: { enabled: true },
            },
          },
        });
      }
      if (url.includes("get_my_media_manifest")) {
        manifestStarted = true;
        return new Promise((resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            manifestAbortCount += 1;
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
      if (url.includes("get_my_media_manifest_version")) {
        return jsonResponse({
          message: { manifest_token: "manifest-token-v1", total_count: 1 },
        });
      }
      return jsonResponse({});
    });
    window.fetch = fetchMock;

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");

    await vi.waitFor(() => {
      expect(manifestStarted).toBe(true);
    });

    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: {
        authenticated: true,
        busy: true,
        isGuest: false,
        pendingLogout: true,
        user: "player-user@vatiolibre.com",
      },
    }));

    await playerPage.initPromise;
    await settlePlayerTasks();

    expect(manifestAbortCount).toBe(1);
    expect(countFetchCalls(fetchMock, "get_my_media_manifest_version")).toBe(0);
    expect(countFetchCalls(fetchMock, "list_my_media_assets")).toBe(0);
    expect(countFetchCalls(fetchMock, "get_my_media_asset_detail")).toBe(0);
    expect(countFetchCalls(fetchMock, "get_my_media_asset_access")).toBe(0);
  });

  // ── Search filters the visible track list ────────────────────────

  it("search filters the visible track list", async () => {
    window.fetch = createAuthenticatedPlayerFetch();

    await bootHtmlPage("player.html");
    const playerPage = await import("../../src/player/player-demo.js");
    await playerPage.initPromise;
    await settlePlayerTasks();

    // Open widget and queue
    openWidgetQueue(playerPage);
    await settlePlayerTasks(4);

    const searchInput = document.querySelector(".player-queue-search");
    expect(searchInput).toBeTruthy();

    // Type a filter
    searchInput.value = "Highway";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    const trackItems = document.querySelectorAll(".player-queue-item");
    expect(trackItems.length).toBe(1);
    expect(trackItems[0].textContent).toContain("Highway Run");
  });
});

// ── Unit tests: isAudioAsset ─────────────────────────────────────────

describe("isAudioAsset", () => {
  let isAudioAsset;

  beforeEach(async () => {
    vi.resetModules();

    // Minimal mocks — isAudioAsset doesn't use these but the module imports them
    vi.doMock("../../src/shared/media-cache.js", () => ({
      getCachedManifestSnapshot: vi.fn().mockResolvedValue(null),
      getCachedMediaManifest: vi.fn().mockResolvedValue(null),
      cacheManifestSnapshot: vi.fn().mockResolvedValue(true),
      getLocalMediaBlob: vi.fn().mockResolvedValue(null),
      getLocalBlobMeta: vi.fn().mockResolvedValue(null),
      isAutoCacheEligible: vi.fn().mockReturnValue(false),
      registerAutoCacheDownload: vi.fn(),
      cacheMediaBlob: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock("../../src/shared/environment.js", () => ({
      getEnvironmentConfig: () => ({ apiBase: "https://api.vatioboard.com" }),
    }));

    const mod = await import("../../src/shared/audio-catalog.js");
    isAudioAsset = mod.isAudioAsset;
  });

  it("accepts media_kind=audio", () => {
    expect(isAudioAsset({ media_kind: "audio" })).toBe(true);
  });

  it("accepts mime_type starting with audio/", () => {
    expect(isAudioAsset({ mime_type: "audio/mpeg" })).toBe(true);
    expect(isAudioAsset({ mime_type: "audio/opus" })).toBe(true);
    expect(isAudioAsset({ mime_type: "audio/wav" })).toBe(true);
  });

  it("accepts known audio extensions as fallback", () => {
    expect(isAudioAsset({ original_filename: "track.mp3" })).toBe(true);
    expect(isAudioAsset({ original_filename: "song.flac" })).toBe(true);
    expect(isAudioAsset({ original_filename: "voice.opus" })).toBe(true);
    expect(isAudioAsset({ original_filename: "music.m4a" })).toBe(true);
  });

  it("rejects video assets", () => {
    expect(isAudioAsset({ media_kind: "video" })).toBe(false);
    expect(isAudioAsset({ media_kind: "video", original_filename: "file.mp3" })).toBe(false);
  });

  it("rejects image assets", () => {
    expect(isAudioAsset({ media_kind: "image" })).toBe(false);
    expect(isAudioAsset({ media_kind: "image", mime_type: "image/png" })).toBe(false);
  });

  it("rejects non-audio mime types when kind is unset", () => {
    expect(isAudioAsset({ mime_type: "video/mp4" })).toBe(false);
    expect(isAudioAsset({ mime_type: "image/jpeg" })).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isAudioAsset(null)).toBe(false);
    expect(isAudioAsset(undefined)).toBe(false);
  });

  it("rejects assets with non-audio extensions and no kind/mime", () => {
    expect(isAudioAsset({ original_filename: "photo.jpg" })).toBe(false);
    expect(isAudioAsset({ original_filename: "video.mp4" })).toBe(false);
    expect(isAudioAsset({ original_filename: "document.pdf" })).toBe(false);
  });
});
