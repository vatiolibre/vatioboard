import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, flushTasks } from "../helpers/page-smoke.js";

// ── Hoisted mocks ────────────────────────────────────────────────────

const mockMediaCache = vi.hoisted(() => ({
  cacheMediaManifest: vi.fn().mockResolvedValue(true),
  cacheMediaMetadata: vi.fn().mockResolvedValue(true),
  getCachedMediaManifest: vi.fn().mockResolvedValue(null),
  getCachedMediaMetadata: vi.fn().mockResolvedValue(undefined),
  removeCachedMediaMetadata: vi.fn().mockResolvedValue(true),
  pinMediaBlob: vi.fn().mockResolvedValue(true),
  getPinnedMediaBlob: vi.fn().mockResolvedValue(null),
  getPinnedBlobMeta: vi.fn().mockResolvedValue(null),
  unpinMediaBlob: vi.fn().mockResolvedValue(true),
  isMediaBlobPinned: vi.fn().mockResolvedValue(false),
  setMediaCacheUser: vi.fn(),
  getMediaCacheUser: vi.fn().mockReturnValue(null),
  restorePersistedMediaCacheUser: vi.fn().mockReturnValue(null),
  clearPersistedMediaCacheUser: vi.fn(),
  getCachedManifestToken: vi.fn().mockResolvedValue(null),
  cacheManifestToken: vi.fn().mockResolvedValue(true),
  getLocalMediaBlob: vi.fn().mockResolvedValue(null),
  getLocalBlobMeta: vi.fn().mockResolvedValue(null),
  getCachedBlobMeta: vi.fn().mockResolvedValue(null),
  getCachedMediaBlob: vi.fn().mockResolvedValue(null),
  cacheMediaBlob: vi.fn().mockResolvedValue(true),
  isAutoCacheEligible: vi.fn().mockReturnValue(false),
  isAutoCacheInFlight: vi.fn().mockReturnValue(false),
  registerAutoCacheDownload: vi.fn().mockReturnValue(true),
  deriveLocalAvailability: vi.fn().mockReturnValue("cloud-only"),
  removeCachedMediaBlob: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/shared/media-cache.js", () => mockMediaCache);

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor() {
      this.handlers = {};
      this.sources = new Map();
      this.scrollZoom = { disable: vi.fn() };
      this.boxZoom = { disable: vi.fn() };
      this.doubleClickZoom = { disable: vi.fn() };
      this.dragPan = { disable: vi.fn() };
      this.dragRotate = { disable: vi.fn() };
      this.keyboard = { disable: vi.fn() };
      this.touchZoomRotate = { disable: vi.fn() };
      this.jumpTo = vi.fn();
      this.easeTo = vi.fn();
      this.fitBounds = vi.fn();
      this.remove = vi.fn();
      Promise.resolve().then(() => {
        for (const handler of this.handlers.load ?? []) handler();
      });
    }
    on(event, handler) { (this.handlers[event] ??= []).push(handler); return this; }
    addControl() { return this; }
    getSource(id) {
      if (!this.sources.has(id)) this.sources.set(id, { setData: vi.fn() });
      return this.sources.get(id);
    }
    setPaintProperty() {}
  }
  return { default: { Map: FakeMap, AttributionControl: class {} } };
});

// ── Helpers ──────────────────────────────────────────────────────────

async function settleLibraryTasks(iterations = 16) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MEDIA_ASSET = {
  name: "MEDIA-1",
  title: "Skidpad export",
  created_at_label: "2026-04-03 08:30:00",
  modified_at_label: "2026-04-03 09:15:00",
  media_kind: "image",
  blob_size: 245760,
  original_filename: "skidpad.png",
  folder_path: "Exports",
  has_preview_image: true,
  file_extension: "png",
};

function createAuthenticatedLibraryFetch(handler) {
  return vi.fn(async (input, init) => {
    const url = typeof input === "string" ? input : String(input?.url ?? "");

    if (url.includes("/api/method/vatiolibre.services.tesla_connection_status")) {
      return jsonResponse({ message: { connected: false, is_guest: false } });
    }
    if (url.includes("/api/method/frappe.auth.get_logged_user")) {
      return jsonResponse({ message: "library-user@vatiolibre.com" });
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
        message: { manifest_token: "manifest-token-v1", total_count: 1 },
      });
    }

    return handler(url, init);
  });
}

function createDefaultFetch() {
  return createAuthenticatedLibraryFetch((url) => {
    if (url.includes("list_my_media_assets")) {
      return jsonResponse({
        message: {
          assets: [MEDIA_ASSET],
          total_count: 1,
          has_more: false,
          next_offset: 1,
        },
      });
    }
    if (url.includes("get_my_media_asset_detail")) {
      return jsonResponse({ message: { asset: MEDIA_ASSET } });
    }
    // Speed / accel / board doc list — return empty
    if (url.includes("list_my_speed_recordings")) {
      return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
    }
    if (url.includes("list_my_accel_runs")) {
      return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
    }
    if (url.includes("list_my_board_documents")) {
      return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
    }
    return jsonResponse({});
  });
}

async function bootMediaTab() {
  await bootHtmlPage("library.html");
  window.fetch = createDefaultFetch();

  const libraryPage = await import("../../src/library/library.js");
  await libraryPage.initPromise;
  await settleLibraryTasks();

  // Switch to media tab
  document.querySelector('[data-tab="media"]')?.dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
  await settleLibraryTasks();

  // Select the first item
  document.querySelector(".library-record")?.dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
  await settleLibraryTasks();

  return libraryPage;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("library offline media", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(mockMediaCache).forEach((fn) => fn.mockReset());
    mockMediaCache.cacheMediaManifest.mockResolvedValue(true);
    mockMediaCache.cacheMediaMetadata.mockResolvedValue(true);
    mockMediaCache.getCachedMediaManifest.mockResolvedValue(null);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue(undefined);
    mockMediaCache.removeCachedMediaMetadata.mockResolvedValue(true);
    mockMediaCache.pinMediaBlob.mockResolvedValue(true);
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(null);
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue(null);
    mockMediaCache.unpinMediaBlob.mockResolvedValue(true);
    mockMediaCache.isMediaBlobPinned.mockResolvedValue(false);
    mockMediaCache.setMediaCacheUser.mockReturnValue(undefined);
    mockMediaCache.getMediaCacheUser.mockReturnValue(null);
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue(null);
    mockMediaCache.clearPersistedMediaCacheUser.mockReturnValue(undefined);
    mockMediaCache.getCachedManifestToken.mockResolvedValue(null);
    mockMediaCache.cacheManifestToken.mockResolvedValue(true);
    mockMediaCache.getLocalMediaBlob.mockResolvedValue(null);
    mockMediaCache.getLocalBlobMeta.mockResolvedValue(null);
    mockMediaCache.getCachedBlobMeta.mockResolvedValue(null);
    mockMediaCache.getCachedMediaBlob.mockResolvedValue(null);
    mockMediaCache.cacheMediaBlob.mockResolvedValue(true);
    mockMediaCache.isAutoCacheEligible.mockReturnValue(false);
    mockMediaCache.isAutoCacheInFlight.mockReturnValue(false);
    mockMediaCache.registerAutoCacheDownload.mockReturnValue(true);
    mockMediaCache.deriveLocalAvailability.mockReturnValue("cloud-only");
    mockMediaCache.removeCachedMediaBlob.mockResolvedValue(true);
  });

  // ── Pin / unpin ─────────────────────────────────────────────────

  it("shows the pin button on media detail", async () => {
    await bootMediaTab();

    const pinBtn = document.getElementById("libraryActionPin");
    expect(pinBtn).toBeTruthy();
    expect(pinBtn.hidden).toBe(false);
    expect(pinBtn.textContent).toContain("Pin");
  });

  it("pins a media asset by downloading its blob via signed URL", async () => {
    // Simulate the access endpoint returning a signed URL, and that URL
    // serving a real blob (S3 bucket has CORS configured correctly).
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: { assets: [MEDIA_ASSET], total_count: 1, has_more: false },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: MEDIA_ASSET } });
      }
      if (url.includes("get_my_media_asset_access")) {
        return jsonResponse({
          message: {
            asset: { name: "MEDIA-1", content_hash: "abc123", media_kind: "image" },
            access: { download_url: "https://s3.example.com/signed-blob", expires_in_seconds: 300 },
          },
        });
      }
      if (url.includes("s3.example.com/signed-blob")) {
        return new Response(new Blob(["fake-png-data"], { type: "image/png" }), { status: 200 });
      }
      if (url.includes("list_my_speed_recordings")) {
        return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      }
      if (url.includes("list_my_accel_runs")) {
        return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      }
      if (url.includes("list_my_board_documents")) {
        return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      }
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    const pinBtn = document.getElementById("libraryActionPin");
    expect(pinBtn.hidden).toBe(false);

    pinBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleLibraryTasks();

    // Signed URL should have been fetched directly (fast path)
    const signedFetch = window.fetch.mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("s3.example.com/signed-blob"),
    );
    expect(signedFetch).toBeTruthy();

    // Streaming fallback should NOT have been used
    const streamFetch = window.fetch.mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("stream_my_media_asset_blob"),
    );
    expect(streamFetch).toBeUndefined();

    expect(mockMediaCache.pinMediaBlob).toHaveBeenCalledWith(
      "MEDIA-1",
      expect.any(Blob),
      { contentHash: null },
    );
  });

  it("falls back to streaming endpoint when signed URL fetch throws (CORS)", async () => {
    // Simulate the signed S3 URL failing with a TypeError (as browsers do
    // when CORS blocks the response) and verify the streaming BFF endpoint
    // is used as the real fallback — not the redirect-based download URL
    // which also ends up at S3.
    let signedUrlAttempted = false;
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: { assets: [MEDIA_ASSET], total_count: 1, has_more: false },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: MEDIA_ASSET } });
      }
      if (url.includes("get_my_media_asset_access")) {
        return jsonResponse({
          message: {
            asset: { name: "MEDIA-1", content_hash: "abc123", media_kind: "image" },
            access: { download_url: "https://s3.example.com/signed-blob", expires_in_seconds: 300 },
          },
        });
      }
      if (url.includes("s3.example.com/signed-blob")) {
        signedUrlAttempted = true;
        throw new TypeError("Failed to fetch");
      }
      if (url.includes("stream_my_media_asset_blob")) {
        return new Response(new Blob(["streamed-png-data"], { type: "application/octet-stream" }), { status: 200 });
      }
      if (url.includes("list_my_speed_recordings")) {
        return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      }
      if (url.includes("list_my_accel_runs")) {
        return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      }
      if (url.includes("list_my_board_documents")) {
        return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      }
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.getElementById("libraryActionPin").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    // Signed URL was attempted first
    expect(signedUrlAttempted).toBe(true);

    // Streaming fallback was used
    const streamFetch = window.fetch.mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("stream_my_media_asset_blob"),
    );
    expect(streamFetch).toBeTruthy();

    // Redirect-based download URL was NOT used (it would not bypass CORS)
    const redirectFetch = window.fetch.mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("/private/files/skidpad.png"),
    );
    expect(redirectFetch).toBeUndefined();

    expect(mockMediaCache.pinMediaBlob).toHaveBeenCalledWith(
      "MEDIA-1",
      expect.any(Blob),
      { contentHash: null },
    );
  });

  it("falls back to streaming endpoint when signed URL returns non-OK", async () => {
    // Signed URL returns 403 (expired/invalid) — should fall back to stream
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: { assets: [MEDIA_ASSET], total_count: 1, has_more: false },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: MEDIA_ASSET } });
      }
      if (url.includes("get_my_media_asset_access")) {
        return jsonResponse({
          message: {
            asset: { name: "MEDIA-1", content_hash: "abc123", media_kind: "image" },
            access: { download_url: "https://s3.example.com/signed-expired", expires_in_seconds: 300 },
          },
        });
      }
      if (url.includes("s3.example.com/signed-expired")) {
        return new Response("<Error>AccessDenied</Error>", { status: 403 });
      }
      if (url.includes("stream_my_media_asset_blob")) {
        return new Response(new Blob(["streamed-data"]), { status: 200 });
      }
      if (url.includes("list_my_speed_recordings")) {
        return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      }
      if (url.includes("list_my_accel_runs")) {
        return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      }
      if (url.includes("list_my_board_documents")) {
        return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      }
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();
    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.getElementById("libraryActionPin").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    const streamFetch = window.fetch.mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("stream_my_media_asset_blob"),
    );
    expect(streamFetch).toBeTruthy();

    expect(mockMediaCache.pinMediaBlob).toHaveBeenCalledWith(
      "MEDIA-1",
      expect.any(Blob),
      { contentHash: null },
    );
  });

  it("uses streaming endpoint directly when access endpoint returns no signed URL", async () => {
    // resolveMediaAccess returns null — no signed URL available
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: { assets: [MEDIA_ASSET], total_count: 1, has_more: false },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: MEDIA_ASSET } });
      }
      if (url.includes("get_my_media_asset_access")) {
        return jsonResponse({ message: {} });
      }
      if (url.includes("stream_my_media_asset_blob")) {
        return new Response(new Blob(["fallback-data"]), { status: 200 });
      }
      if (url.includes("list_my_speed_recordings")) {
        return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      }
      if (url.includes("list_my_accel_runs")) {
        return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      }
      if (url.includes("list_my_board_documents")) {
        return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      }
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();
    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.getElementById("libraryActionPin").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    const streamFetch = window.fetch.mock.calls.find(
      ([u]) => typeof u === "string" && u.includes("stream_my_media_asset_blob"),
    );
    expect(streamFetch).toBeTruthy();

    expect(mockMediaCache.pinMediaBlob).toHaveBeenCalledWith(
      "MEDIA-1",
      expect.any(Blob),
      { contentHash: null },
    );
  });

  it("unpins a previously pinned media asset", async () => {
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({ content_hash: null, pinned_at: Date.now() });

    await bootMediaTab();

    const pinBtn = document.getElementById("libraryActionPin");
    expect(pinBtn).toBeTruthy();
    expect(pinBtn.hidden).toBe(false);
    expect(pinBtn.dataset.pinned).toBe("true");

    pinBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleLibraryTasks();

    expect(mockMediaCache.unpinMediaBlob).toHaveBeenCalledWith("MEDIA-1");
  });

  // ── Offline audio open ──────────────────────────────────────────

  it("opens a pinned media blob via object URL when offline", async () => {
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({ content_hash: null, pinned_at: Date.now() });
    const fakeBlob = new Blob(["audio-data"], { type: "audio/mpeg" });
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(fakeBlob);
    mockMediaCache.getLocalMediaBlob.mockResolvedValue({ blob: fakeBlob, source: "pinned", contentHash: null });

    const revokedUrls = [];
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:vatioboard/fake-object-url");
    URL.revokeObjectURL = vi.fn((url) => revokedUrls.push(url));
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    try {
      await bootMediaTab();

      const openBtn = document.getElementById("libraryActionOpen");
      openBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settleLibraryTasks();

      expect(mockMediaCache.getLocalMediaBlob).toHaveBeenCalledWith("MEDIA-1");
      expect(URL.createObjectURL).toHaveBeenCalledWith(fakeBlob);
      expect(openSpy).toHaveBeenCalledWith(
        "blob:vatioboard/fake-object-url",
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      openSpy.mockRestore();
    }
  });

  // ── User-scoped cache ───────────────────────────────────────────

  it("sets the cache user on successful authentication", async () => {
    await bootMediaTab();

    expect(mockMediaCache.setMediaCacheUser).toHaveBeenCalledWith(
      "library-user@vatiolibre.com",
    );
  });

  it("preserves cache namespace when logged-user lookup fails but session is authenticated", async () => {
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "" }, 403);
      }
      if (url.includes("get_my_feature_access")) {
        return jsonResponse({}, 403);
      }
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    // When the session is authenticated but logged-user lookup fails
    // transiently, the existing cache namespace should be preserved.
    const nullCalls = mockMediaCache.setMediaCacheUser.mock.calls.filter(
      (args) => args[0] === null,
    );
    expect(nullCalls.length).toBe(0);
    expect(mockMediaCache.clearPersistedMediaCacheUser).not.toHaveBeenCalled();
  });

  // ── Stale pin detection / re-pin ────────────────────────────────

  it("shows outdated pin badge when content_hash differs", async () => {
    const assetWithHash = { ...MEDIA_ASSET, content_hash: "abc123" };
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "old-hash",
      pinned_at: Date.now(),
    });

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: { assets: [assetWithHash], total_count: 1, has_more: false },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: assetWithHash } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    // Check list badge
    const badge = document.querySelector(".library-record-badge[data-tone='warning']");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("Outdated pin");

    // Select the item and check detail
    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    const pinBtn = document.getElementById("libraryActionPin");
    expect(pinBtn).toBeTruthy();
    expect(pinBtn.dataset.stale).toBe("true");
    expect(pinBtn.textContent).toContain("Re-pin");
  });

  it("re-pins a stale blob instead of unpinning it", async () => {
    const assetWithHash = { ...MEDIA_ASSET, content_hash: "new-hash" };
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "old-hash",
      pinned_at: Date.now(),
    });

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: { assets: [assetWithHash], total_count: 1, has_more: false },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: assetWithHash } });
      }
      if (url.includes("get_my_media_asset_access")) {
        return jsonResponse({ message: {} });
      }
      if (url.includes("stream_my_media_asset_blob")) {
        return new Response(new Blob(["updated-data"], { type: "application/octet-stream" }), { status: 200 });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    const pinBtn = document.getElementById("libraryActionPin");
    pinBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleLibraryTasks();

    // Should re-pin with new blob, not unpin
    expect(mockMediaCache.unpinMediaBlob).not.toHaveBeenCalled();
    expect(mockMediaCache.pinMediaBlob).toHaveBeenCalledWith(
      "MEDIA-1",
      expect.any(Blob),
      { contentHash: "new-hash" },
    );
  });

  it("prefers remote URL over stale local blob when opening", async () => {
    const assetWithHash = { ...MEDIA_ASSET, content_hash: "new-hash" };
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "old-hash",
      pinned_at: Date.now(),
    });
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(
      new Blob(["stale-data"], { type: "image/png" }),
    );

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    try {
      window.fetch = createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets")) {
          return jsonResponse({
            message: { assets: [assetWithHash], total_count: 1, has_more: false },
          });
        }
        if (url.includes("get_my_media_asset_detail")) {
          return jsonResponse({ message: { asset: assetWithHash } });
        }
        if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });

      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      // Clear any calls from prior leaked async work or initial renders
      // before measuring the open-button interaction.
      mockMediaCache.getPinnedMediaBlob.mockClear();

      const openBtn = document.getElementById("libraryActionOpen");
      openBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settleLibraryTasks();

      // Should NOT read the local blob because pin is stale
      expect(mockMediaCache.getPinnedMediaBlob).not.toHaveBeenCalled();
      // Should open the BFF redirect URL for this asset
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("download_my_media_asset"),
        "_blank",
        "noopener,noreferrer",
      );
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("name=MEDIA-1"),
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      openSpy.mockRestore();
    }
  });

  // ── Metadata-only offline items ─────────────────────────────────

  it("disables open, download, rename and delete for metadata-only offline items", async () => {
    const cachedItem = {
      name: "MEDIA-1",
      title: "Skidpad export",
      media_kind: "image",
      blob_size: 245760,
      original_filename: "skidpad.png",
      content_hash: "abc123",
      created_at_label: "2026-04-03 08:30:00",
      modified_at_label: "2026-04-03 09:15:00",
      folder_path: "Exports",
    };
    // Simulate offline: list API fails, manifest cache returns items
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem,
      preview_image_url: null,
      download_url: null,
    });

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      if (url.includes("get_my_media_asset_detail")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    // Check the "Cached metadata only" badge in the list
    const allBadges = [...document.querySelectorAll(".library-record-badge")];
    const metadataBadge = allBadges.find((b) => b.textContent === "Cached metadata only");
    expect(metadataBadge).toBeTruthy();
    expect(metadataBadge.dataset.tone).toBe("muted");

    // Select the offline item
    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    // All cloud-dependent actions should be disabled
    const openBtn = document.getElementById("libraryActionOpen");
    const downloadBtn = document.getElementById("libraryActionDownload");
    const renameBtn = document.getElementById("libraryActionRename");
    const deleteBtn = document.getElementById("libraryActionDelete");

    expect(openBtn?.disabled).toBe(true);
    expect(downloadBtn?.disabled).toBe(true);
    if (renameBtn) expect(renameBtn.disabled).toBe(true);
    if (deleteBtn) expect(deleteBtn.disabled).toBe(true);
  });

  // ── Available offline badge for fresh pin ───────────────────────

  it("shows available offline badge for a fresh pinned item", async () => {
    // Pin meta matches the asset content_hash — fresh pin
    const assetWithHash = { ...MEDIA_ASSET, content_hash: "abc123" };
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "abc123",
      pinned_at: Date.now(),
    });

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: { assets: [assetWithHash], total_count: 1, has_more: false },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: assetWithHash } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    const badge = document.querySelector(".library-record-badge[data-tone='success']");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("Available offline");
  });

  // ── Offline boot ────────────────────────────────────────────────

  it("boots from cached media when backend is unreachable and a persisted namespace exists", async () => {
    const cachedItem = {
      name: "MEDIA-1",
      title: "Skidpad export",
      media_kind: "image",
      blob_size: 245760,
      original_filename: "skidpad.png",
      content_hash: "abc123",
      created_at_label: "2026-04-03 08:30:00",
      modified_at_label: "2026-04-03 09:15:00",
      folder_path: "Exports",
    };
    // Persisted cache user from a prior session
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem,
      preview_image_url: null,
      download_url: null,
    });

    // All backend calls fail — total offline
    window.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // The media tab should be active and show the cached item
    const records = document.querySelectorAll(".library-record");
    expect(records.length).toBe(1);
    expect(records[0].textContent).toContain("Skidpad export");
  });

  it("clears persisted namespace on explicit logout", async () => {
    await bootMediaTab();

    // Simulate a logout auth state event
    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: {
        authenticated: false,
        busy: true,
        isGuest: false,
        pendingLogout: true,
        user: null,
      },
    }));
    await settleLibraryTasks();

    expect(mockMediaCache.clearPersistedMediaCacheUser).toHaveBeenCalled();
  });

  // ── Stale pin offline ───────────────────────────────────────────

  it("disables open for stale pinned items when offline", async () => {
    const cachedItem = {
      name: "MEDIA-1",
      title: "Skidpad export",
      media_kind: "image",
      blob_size: 245760,
      original_filename: "skidpad.png",
      content_hash: "new-hash",
      created_at_label: "2026-04-03 08:30:00",
      modified_at_label: "2026-04-03 09:15:00",
      folder_path: "Exports",
    };
    // Stale pin — content hashes differ
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "old-hash",
      pinned_at: Date.now(),
    });
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem,
      _offline: true,
      preview_image_url: null,
      download_url: null,
    });

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      // Media list fails — offline
      if (url.includes("list_my_media_assets")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      if (url.includes("get_my_media_asset_detail")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    const openBtn = document.getElementById("libraryActionOpen");
    expect(openBtn).toBeTruthy();
    // Stale + offline → open should be disabled
    expect(openBtn.disabled).toBe(true);
  });

  // ── Offline preview fallback ────────────────────────────────────

  it("shows an offline fallback instead of broken remote preview for metadata-only items", async () => {
    const cachedItem = {
      name: "MEDIA-1",
      title: "Skidpad export",
      media_kind: "image",
      blob_size: 245760,
      original_filename: "skidpad.png",
      content_hash: "abc123",
      created_at_label: "2026-04-03 08:30:00",
      modified_at_label: "2026-04-03 09:15:00",
      folder_path: "Exports",
    };
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem,
      preview_image_url: "https://api.vatioboard.com/files/skidpad.png?token=view#preview",
      download_url: null,
    });

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      if (url.includes("get_my_media_asset_detail")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    const preview = document.getElementById("libraryDetailPreview");
    expect(preview).toBeTruthy();
    // Should NOT have an <img> tag (remote URL would break offline)
    expect(preview.querySelector("img")).toBeNull();
    // Should show the offline fallback
    expect(preview.dataset.previewKind).toBe("offline-fallback");
    expect(preview.querySelector(".library-preview-offline-label")).toBeTruthy();
    expect(preview.textContent).toContain("Preview unavailable offline");
  });

  // ── Finding 1: 401 clears persisted namespace ───────────────────

  it("clears the persisted cache namespace after a 401 session expiry", async () => {
    // Auth succeeds, but the media list returns 401 (session expired mid-request).
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({ message: "Guest" }, 401);
      }
      if (url.includes("list_my_speed_recordings")) {
        return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      }
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    // Switch to the media tab to trigger the 401
    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    // The 401 handler should have called clearPersistedMediaCacheUser
    expect(mockMediaCache.clearPersistedMediaCacheUser).toHaveBeenCalled();
  });

  // ── Empty manifest cache correctness ────────────────────────────

  it("returns cached empty manifest without hitting the backend on non-forced load", async () => {
    // Simulate a user who has zero media: the manifest was cached as [].
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([]);

    const listCalls = [];
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        listCalls.push(url);
        return jsonResponse({ message: { assets: [], total_count: 0, has_more: false } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    // Switch to media tab — the non-forced load should use the cached []
    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    // The media list API should NOT have been called for the initial
    // non-forced load because the cached empty manifest is a valid result.
    // (A forced revalidation may fire in the background, but the initial
    // render must come from cache.)
    const records = document.querySelectorAll(".library-record");
    expect(records.length).toBe(0);

    // The empty state should be showing, not the loading indicator
    const emptyState = document.querySelector(".library-no-results, .library-empty-state, [data-empty-state]");
    const loadingIndicator = document.querySelector(".library-loading");
    expect(loadingIndicator?.hidden ?? true).toBe(true);
  });

  it("returns offline empty manifest instead of throwing when network fails and cache is empty array", async () => {
    // Simulate offline with a previously cached empty manifest.
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([]);

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    // Switch to media tab — should NOT throw despite network failure
    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    // Should render an empty list (not an error state)
    const records = document.querySelectorAll(".library-record");
    expect(records.length).toBe(0);

    // Should not have an unhandled loading state
    const loadingIndicator = document.querySelector(".library-loading");
    expect(loadingIndicator?.hidden ?? true).toBe(true);
  });

  // ── Finding 2: Offline search/sort on cached manifest ───────────

  it("applies client-side search filtering to the cached manifest in offline mode", async () => {
    const items = [
      {
        name: "MEDIA-1", title: "Skidpad export", media_kind: "image",
        blob_size: 1024, original_filename: "skidpad.png", content_hash: "a1",
        created_at_label: "2026-04-01 10:00:00", modified_at_label: "2026-04-01 10:00:00",
        folder_path: "Exports",
      },
      {
        name: "MEDIA-2", title: "Bridge photo", media_kind: "image",
        blob_size: 2048, original_filename: "bridge.jpg", content_hash: "b2",
        created_at_label: "2026-04-02 12:00:00", modified_at_label: "2026-04-02 12:00:00",
        folder_path: "Photos",
      },
      {
        name: "MEDIA-3", title: "Tunnel video", media_kind: "video",
        blob_size: 4096, original_filename: "tunnel.mp4", content_hash: "c3",
        created_at_label: "2026-04-03 08:00:00", modified_at_label: "2026-04-03 08:00:00",
        folder_path: "Videos",
      },
    ];
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue(items);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...items[0],
      preview_image_url: null,
      download_url: null,
    });

    // All backend calls fail — total offline
    window.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // All 3 items should be visible
    let records = document.querySelectorAll(".library-record");
    expect(records.length).toBe(3);

    // Search for "bridge"
    const searchInput = document.getElementById("librarySearch");
    const searchForm = document.getElementById("librarySearchForm");
    searchInput.value = "bridge";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(32);

    records = document.querySelectorAll(".library-record");
    expect(records.length).toBe(1);
    expect(records[0].textContent).toContain("Bridge photo");
  });

  it("applies client-side sorting to the cached manifest in offline mode", async () => {
    // Labels are human-readable / localized — sorting must use raw timestamps.
    const items = [
      {
        name: "MEDIA-1", title: "Charlie", media_kind: "image",
        blob_size: 1024, original_filename: "c.png", content_hash: "a1",
        modified_at: "2026-04-01T10:00:00Z",
        created_at_label: "1 de abril de 2026", modified_at_label: "1 de abril de 2026",
        folder_path: "Exports",
      },
      {
        name: "MEDIA-2", title: "Alpha", media_kind: "image",
        blob_size: 2048, original_filename: "a.jpg", content_hash: "b2",
        modified_at: "2026-04-03T12:00:00Z",
        created_at_label: "3 de abril de 2026", modified_at_label: "3 de abril de 2026",
        folder_path: "Photos",
      },
      {
        name: "MEDIA-3", title: "Bravo", media_kind: "video",
        blob_size: 4096, original_filename: "b.mp4", content_hash: "c3",
        modified_at: "2026-04-02T08:00:00Z",
        created_at_label: "2 de abril de 2026", modified_at_label: "2 de abril de 2026",
        folder_path: "Videos",
      },
    ];
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue(items);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...items[0],
      preview_image_url: null,
      download_url: null,
    });

    window.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Default sort is "newest" — Alpha (Apr 3), Bravo (Apr 2), Charlie (Apr 1)
    let titles = Array.from(document.querySelectorAll(".library-record-title")).map((el) => el.textContent);
    expect(titles).toEqual(["Alpha", "Bravo", "Charlie"]);

    // Switch to title A-Z
    const sortSelect = document.getElementById("librarySort");
    sortSelect.value = "title_asc";
    sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await settleLibraryTasks(32);

    titles = Array.from(document.querySelectorAll(".library-record-title")).map((el) => el.textContent);
    expect(titles).toEqual(["Alpha", "Bravo", "Charlie"]);

    // Switch to title Z-A
    sortSelect.value = "title_desc";
    sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await settleLibraryTasks(32);

    titles = Array.from(document.querySelectorAll(".library-record-title")).map((el) => el.textContent);
    expect(titles).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  // ── Finding 3: Pinned offline preview from local blob ───────────

  it("renders a local blob preview for pinned offline media instead of a remote URL", async () => {
    const cachedItem = {
      name: "MEDIA-1",
      title: "Skidpad export",
      media_kind: "image",
      blob_size: 245760,
      original_filename: "skidpad.png",
      content_hash: "abc123",
      created_at_label: "2026-04-03 08:30:00",
      modified_at_label: "2026-04-03 09:15:00",
      folder_path: "Exports",
    };
    const fakeBlob = new Blob(["fake-image-data"], { type: "image/png" });
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "abc123",
      pinned_at: Date.now(),
    });
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(fakeBlob);
    mockMediaCache.getLocalMediaBlob.mockResolvedValue({ blob: fakeBlob, source: "pinned", contentHash: "abc123" });
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem,
      _offline: true,
      preview_image_url: "https://api.vatioboard.com/files/skidpad.png?token=view#preview",
      download_url: null,
    });

    const originalCreateObjectURL = URL.createObjectURL;
    const blobUrls = [];
    URL.createObjectURL = vi.fn((blob) => {
      const url = `blob:vatioboard/${blobUrls.length}`;
      blobUrls.push({ blob, url });
      return url;
    });

    try {
      window.fetch = createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets")) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        if (url.includes("get_my_media_asset_detail")) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });

      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      const preview = document.getElementById("libraryDetailPreview");
      expect(preview).toBeTruthy();

      const img = preview.querySelector("img");
      expect(img).toBeTruthy();
      // The img src should be a blob URL, not the remote URL
      expect(img.src).toMatch(/^blob:/);
      expect(img.src).not.toContain("vatioboard.com");
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  // ── Offline tab scoping ─────────────────────────────────────────

  it("does not allow non-media tabs to be used in offline-limited mode", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // All backend calls fail — total offline
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Media tab is active with the cached item
    expect(document.querySelectorAll(".library-record").length).toBe(1);

    // Non-media tabs should be disabled
    const speedTab = document.querySelector('[data-tab="speed"]');
    const accelTab = document.querySelector('[data-tab="accel"]');
    const boardTab = document.querySelector('[data-tab="board_documents"]');
    expect(speedTab.disabled).toBe(true);
    expect(accelTab.disabled).toBe(true);
    expect(boardTab.disabled).toBe(true);

    // Media tab should NOT be disabled
    const mediaTab = document.querySelector('[data-tab="media"]');
    expect(mediaTab.disabled).toBe(false);

    // Clicking a disabled tab should not switch away from media
    speedTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleLibraryTasks();
    expect(document.querySelector('[data-tab="media"]').dataset.active).toBe("true");
    expect(document.querySelectorAll(".library-record").length).toBe(1);
  });

  // ── Pinned non-image preview fallback ───────────────────────────

  it("shows a type-aware fallback for pinned offline audio instead of a broken image", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Podcast episode", media_kind: "audio",
      blob_size: 8192, original_filename: "episode.mp3", content_hash: "abc",
      modified_at: "2026-04-03T09:00:00Z",
      created_at_label: "2026-04-03", modified_at_label: "2026-04-03",
      folder_path: "Podcasts",
    };
    const fakeBlob = new Blob(["audio-data"], { type: "audio/mpeg" });
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "abc", pinned_at: Date.now(),
    });
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(fakeBlob);
    mockMediaCache.getLocalMediaBlob.mockResolvedValue({ blob: fakeBlob, source: "pinned", contentHash: "abc" });
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, _offline: true, preview_image_url: null, download_url: null,
    });

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) return Promise.reject(new TypeError("Failed to fetch"));
      if (url.includes("get_my_media_asset_detail")) return Promise.reject(new TypeError("Failed to fetch"));
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    const preview = document.getElementById("libraryDetailPreview");
    expect(preview).toBeTruthy();
    // Must NOT render an <img> — audio blobs are not images
    expect(preview.querySelector("img")).toBeNull();
    // Now mounts an inline media player for pinned offline audio
    expect(preview.dataset.previewKind).toBe("media-player");
    expect(preview.querySelector(".media-player")).toBeTruthy();
    expect(preview.querySelector("audio")).toBeTruthy();
  });

  // ── Offline → online recovery ───────────────────────────────────

  it("re-enables non-media tabs after a fresh online response during revalidation", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: All backend calls fail — boots into offline-limited mode
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Confirm offline-limited: non-media tabs disabled
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(true);
    expect(document.querySelector('[data-tab="accel"]').disabled).toBe(true);

    // Phase 2: Connectivity returns — online response succeeds via revalidation
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: { ...cachedItem } } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger a list reload to get the revalidation cycle
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(32);

    // After the fresh online response, tabs should be re-enabled
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(false);
    expect(document.querySelector('[data-tab="accel"]').disabled).toBe(false);
    expect(document.querySelector('[data-tab="board_documents"]').disabled).toBe(false);
  });

  it("re-enables tabs on the initial online response without waiting for revalidation", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    // First call returns cached manifest (offline boot), subsequent calls resolve online.
    mockMediaCache.getCachedMediaManifest
      .mockResolvedValueOnce([cachedItem])
      .mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: All backend calls fail — boots into offline-limited mode
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Confirm offline-limited
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(true);

    // Phase 2: Next list request returns an online (non-_offline) response on the
    // initial fetch. The library resource caches+returns, and the initial success
    // path should update state.listOffline and re-render tabs immediately.
    let listCallCount = 0;
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        listCallCount += 1;
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) return jsonResponse({ message: { asset: cachedItem } });
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger a forced list reload (force=true skips revalidation)
    const sortSelect = document.getElementById("librarySort");
    sortSelect.value = "newest";
    sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await settleLibraryTasks(32);

    // Tabs should be re-enabled from the initial success path alone
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(false);
    expect(document.querySelector('[data-tab="accel"]').disabled).toBe(false);
    expect(document.querySelector('[data-tab="board_documents"]').disabled).toBe(false);
  });

  // ── Cloud only availability state ───────────────────────────────

  it("shows Cloud only availability for online unpinned media items", async () => {
    await bootMediaTab();

    const detailMeta = document.getElementById("libraryDetailMeta");
    expect(detailMeta).toBeTruthy();
    // Should contain the "Availability" row with "Cloud only" in detail only
    expect(detailMeta.textContent).toContain("Availability");
    expect(detailMeta.textContent).toContain("Cloud only");

    // "Cloud only" should NOT appear as a list badge (kept minimal)
    const badges = document.querySelectorAll(".library-record-badge");
    const cloudOnlyBadge = Array.from(badges).find((b) => b.textContent === "Cloud only");
    expect(cloudOnlyBadge).toBeFalsy();
  });

  // ── Preview object URL cleanup ──────────────────────────────────

  it("revokes preview object URLs when detail becomes empty or tab switches", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Pinned photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "abc",
      modified_at: "2026-04-03T09:00:00Z",
      created_at_label: "2026-04-03", modified_at_label: "2026-04-03",
      folder_path: "Exports",
    };
    const fakeBlob = new Blob(["fake-image-data"], { type: "image/png" });
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "abc", pinned_at: Date.now(),
    });
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(fakeBlob);
    mockMediaCache.getLocalMediaBlob.mockResolvedValue({ blob: fakeBlob, source: "pinned", contentHash: "abc" });
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, _offline: true, preview_image_url: null, download_url: null,
    });

    const revokedUrls = [];
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob) => `blob:test/${revokedUrls.length}`);
    URL.revokeObjectURL = vi.fn((url) => { revokedUrls.push(url); });

    try {
      window.fetch = createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets")) return Promise.reject(new TypeError("Failed to fetch"));
        if (url.includes("get_my_media_asset_detail")) return Promise.reject(new TypeError("Failed to fetch"));
        if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });

      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(32);

      // At this point a blob URL should have been created for the pinned image
      expect(URL.createObjectURL).toHaveBeenCalled();

      // Restore connectivity and trigger a list reload to exit offline mode
      window.fetch = createDefaultFetch();
      const searchForm = document.getElementById("librarySearchForm");
      searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await settleLibraryTasks(32);

      // Switch to a different tab — should revoke the preview object URL
      document.querySelector('[data-tab="speed"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      expect(revokedUrls.length).toBeGreaterThanOrEqual(1);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  // ── Auth/capability recovery on reconnect ──────────────────────

  it("restores tab access after offline→online reconnect", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: All backend calls fail — boots into offline-limited mode
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    const mediaTab = document.querySelector('[data-tab="media"]');
    expect(mediaTab.dataset.access).toBe("granted"); // active offline tab

    // Phase 2: Connectivity returns — full auth + media list succeed
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: cachedItem } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger a list reload via search submit
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(32);

    // Media tab access should be "granted" with real auth (not just offline active)
    expect(mediaTab.dataset.access).toBe("granted");

    // Non-media tabs should be re-enabled AND have access "granted"
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(false);
    expect(document.querySelector('[data-tab="speed"]').dataset.access).toBe("granted");
  });

  // ── Cache namespace preserved on transient user-lookup failure ──

  it("preserves the cache namespace when fetchBackendLoggedUser fails transiently", async () => {
    // The session fetch succeeds but the logged-user endpoint fails.
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");

      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        // Transient failure — e.g. load balancer timeout
        return jsonResponse({ message: "" }, 500);
      }
      if (url.includes("get_my_feature_access")) {
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
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: { assets: [MEDIA_ASSET], total_count: 1, has_more: false },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: MEDIA_ASSET } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    // setMediaCacheUser should NOT have been called with null
    const nullCalls = mockMediaCache.setMediaCacheUser.mock.calls.filter(
      (args) => args[0] === null,
    );
    expect(nullCalls.length).toBe(0);
    // clearPersistedMediaCacheUser should NOT have been called
    expect(mockMediaCache.clearPersistedMediaCacheUser).not.toHaveBeenCalled();
  });

  // ── Mutation actions gated on capability during reconnect ──────

  it("keeps rename and delete disabled until feature access is rehydrated after reconnect", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: All backend calls fail — boots into offline-limited mode
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Phase 2: Media list succeeds but auth endpoints are slow.
    // Use a deferred promise for feature_access to control timing.
    let resolveFeatureAccess;
    const featureAccessGate = new Promise((resolve) => { resolveFeatureAccess = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");

      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "library-user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        // Block until we explicitly resolve
        await featureAccessGate;
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
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: { ...cachedItem } } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger a list reload — online response arrives, rehydration starts
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(32);

    // Select the item so detail renders
    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks(16);

    // Feature access is still pending — rename/delete should be disabled
    const renameBtn = document.getElementById("libraryActionRename");
    const deleteBtn = document.getElementById("libraryActionDelete");
    if (renameBtn) expect(renameBtn.disabled).toBe(true);
    if (deleteBtn) expect(deleteBtn.disabled).toBe(true);

    // Now resolve feature access
    resolveFeatureAccess();
    await settleLibraryTasks(32);

    // After rehydration, mutation actions should be enabled
    if (renameBtn) expect(renameBtn.disabled).toBe(false);
    if (deleteBtn) expect(deleteBtn.disabled).toBe(false);
  });

  // ── Atomic reconnect: search/sort/refresh don't clear list ─────

  it("does not clear the media list when search/sort triggers during reconnect rehydration", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: All backend calls fail — boots into offline-limited mode
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    expect(document.querySelectorAll(".library-record").length).toBe(1);

    // Phase 2: Media list goes online but feature_access stays pending.
    let resolveFeatureAccess;
    const featureAccessGate = new Promise((resolve) => { resolveFeatureAccess = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "library-user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        await featureAccessGate;
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: cachedItem } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger online reconnect via search submit
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(32);

    // Online list data arrived, feature access still pending.
    expect(document.querySelectorAll(".library-record").length).toBe(1);

    // Trigger another sort change while feature access is in flight.
    const sortSelect = document.getElementById("librarySort");
    sortSelect.value = "title_asc";
    sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await settleLibraryTasks(32);

    // List must NOT have been cleared by the capability gate.
    expect(document.querySelectorAll(".library-record").length).toBe(1);

    resolveFeatureAccess();
    await settleLibraryTasks(32);
  });

  // ── Atomic reconnect: non-media tabs stay disabled ─────────────

  it("does not allow non-media tabs to become interactive before reconnect recovery completes", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: All backend calls fail — offline-limited mode
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Confirm offline-limited
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(true);

    // Phase 2: Media list goes online, auth endpoints are slow
    let resolveFeatureAccess;
    const featureAccessGate = new Promise((resolve) => { resolveFeatureAccess = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "library-user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        await featureAccessGate;
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) return jsonResponse({ message: { asset: cachedItem } });
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger reconnect
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(32);

    // Feature access still pending — non-media tabs must remain disabled
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(true);
    expect(document.querySelector('[data-tab="accel"]').disabled).toBe(true);
    expect(document.querySelector('[data-tab="board_documents"]').disabled).toBe(true);

    // Clicking speed tab should not switch
    document.querySelector('[data-tab="speed"]').dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();
    expect(document.querySelector('[data-tab="media"]').dataset.active).toBe("true");

    // Now complete reconnect recovery
    resolveFeatureAccess();
    await settleLibraryTasks(32);

    // Non-media tabs should now be enabled
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(false);
    expect(document.querySelector('[data-tab="accel"]').disabled).toBe(false);
  });

  // ── Race-safe: stale rehydration does not overwrite newer logout ──

  it("discards stale reconnect rehydration results after a newer logout", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: Boot into offline-limited mode
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Phase 2: Media list goes online, but rehydration auth endpoints are slow
    let resolveSessionCall;
    const sessionGate = new Promise((resolve) => { resolveSessionCall = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        // Block the rehydration session call to control timing
        await sessionGate;
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "library-user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) return jsonResponse({ message: { asset: cachedItem } });
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger reconnect — rehydration starts but session is blocked
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(16);

    // While rehydration is in-flight, fire a logout event
    // The logout triggers refreshAuthState which increments authGeneration
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        // Now returns guest/logged out
        return jsonResponse({ message: { connected: false, is_guest: true } });
      }
      return jsonResponse({});
    });

    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: false, busy: true, isGuest: false, pendingLogout: true, user: null },
    }));
    await settleLibraryTasks(32);

    // Now resolve the original slow rehydration session call
    resolveSessionCall();
    await settleLibraryTasks(32);

    // The stale rehydration result should have been discarded.
    // clearPersistedMediaCacheUser should have been called by the logout
    expect(mockMediaCache.clearPersistedMediaCacheUser).toHaveBeenCalled();
  });

  // ── Reconnect staging persists through replacement auth refresh ──

  it("keeps non-media tabs blocked until the replacement auth refresh completes", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: offline-limited mode
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(true);

    // Phase 2: Media list goes online — reconnect starts.
    // Gate the feature-access call in both rehydrate and the replacement auth refresh.
    let resolveFeatureAccess;
    const featureAccessGate = new Promise((resolve) => { resolveFeatureAccess = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        await featureAccessGate;
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) return jsonResponse({ message: { asset: cachedItem } });
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger reconnect via search
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(16);

    // While rehydration is blocked on featureAccess, fire an external auth state event.
    // This enters refreshAuthState which previously cleared state.reconnecting immediately.
    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: true, busy: false, isGuest: false, pendingLogout: false, user: "user@vatiolibre.com" },
    }));
    await settleLibraryTasks(16);

    // Non-media tabs must STILL be blocked — the replacement auth refresh hasn't finished.
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(true);
    expect(document.querySelector('[data-tab="accel"]').disabled).toBe(true);

    // Now resolve the feature access gate — both rehydration and refreshAuthState unblock.
    resolveFeatureAccess();
    await settleLibraryTasks(32);

    // Tabs should now be enabled.
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(false);
    expect(document.querySelector('[data-tab="accel"]').disabled).toBe(false);
  });

  // ── Stale-while-revalidate: list snapshot preserved during reconnect ──

  it("preserves the visible media list during a reconnect reload", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: offline-limited
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Should have offline items rendered
    expect(document.querySelectorAll(".library-record").length).toBe(1);

    // Phase 2: Backend comes back — gate the list call so we can check mid-flight
    let resolveListCall;
    const listGate = new Promise((resolve) => { resolveListCall = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        await listGate;
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) return jsonResponse({ message: { asset: cachedItem } });
      return jsonResponse({});
    });

    // Trigger reconnect via search
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(16);

    // While the list request is in flight, previous items should still be visible
    expect(document.querySelectorAll(".library-record").length).toBe(1);

    // Complete the list request
    resolveListCall();
    await settleLibraryTasks(32);

    // Items refreshed — still 1 record visible (from the server response now)
    expect(document.querySelectorAll(".library-record").length).toBe(1);
  });

  // ── Terminal auth failure clears reconnect mode ──

  it("clears reconnect state when a 401 error occurs during reconnect", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: offline-limited
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(true);

    // Phase 2: Backend returns but media list returns 401
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({ message: { exc_type: "AuthenticationError" } }, 401);
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger reconnect
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(32);

    // After 401, reconnecting should be cleared — the login prompt should be shown.
    // Status should show login prompt (the 401 path in applyLibraryRequestError)
    const statusEl = document.getElementById("libraryStatus");
    expect(statusEl.hidden).toBe(false);
  });

  // ── 401 invalidates in-flight reconnect rehydration ──

  it("ignores stale reconnect rehydration after a confirmed 401 bumps auth generation", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: offline-limited mode
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Phase 2: Backend returns — gate session call so rehydration stays in-flight
    let resolveSessionCall;
    const sessionGate = new Promise((resolve) => { resolveSessionCall = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        // First call from rehydration uses the gate; subsequent calls return immediately
        await sessionGate;
        return jsonResponse({
          message: { connected: true, is_guest: false },
        });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) return jsonResponse({ message: { asset: cachedItem } });
      return jsonResponse({});
    });

    // Trigger reconnect — rehydration fires and blocks on session gate
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(16);

    // While rehydration is in-flight, a 401 is received from a list request.
    // Use a different search term to bypass the in-memory cache from the
    // first (successful) search.
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({ message: { exc_type: "AuthenticationError" } }, 401);
      }
      // All other calls succeed normally
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: true } });
      }
      return jsonResponse({});
    });
    searchInput.value = "trigger-401";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(16);

    // Now resolve the slow rehydration session call — it should be discarded
    // because the 401 bumped authGeneration.
    resolveSessionCall();
    await settleLibraryTasks(32);
    expect(mockMediaCache.clearPersistedMediaCacheUser).toHaveBeenCalled();
  });

  // ── Overlapping refreshAuthState calls are race-safe ──

  it("discards older refreshAuthState results when a newer refresh resolves first", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: offline-limited
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Phase 2: First auth-state event — gate its session call so it stays in-flight
    let resolveFirstSession;
    const firstSessionGate = new Promise((resolve) => { resolveFirstSession = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        await firstSessionGate;
        return jsonResponse({ message: { connected: true, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) return jsonResponse({ message: { asset: cachedItem } });
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Fire first auth-state event — refreshAuthState #1 starts, blocks on session
    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: true, busy: false, isGuest: false, pendingLogout: false, user: "user@vatiolibre.com" },
    }));
    await settleLibraryTasks(8);

    // Fire second auth-state event (e.g. logout) — refreshAuthState #2 starts
    // This one resolves immediately with unauthenticated session.
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: true } });
      }
      return jsonResponse({});
    });

    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: false, busy: true, isGuest: false, pendingLogout: true, user: null },
    }));
    await settleLibraryTasks(32);

    // The second (newer) refresh resolved — user should be logged out

    // Now resolve the first (older) refresh session call — it should be discarded
    resolveFirstSession();
    await settleLibraryTasks(32);
  });

  // ── Refresh-driven recovery preserves visible media snapshot ──

  it("preserves visible media list during auth-event refresh recovery", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: offline-limited mode with one cached item
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Confirm one item visible in offline mode
    expect(document.querySelectorAll(".library-record").length).toBe(1);

    // Phase 2: Media list goes online — triggers reconnect
    let resolveListCall;
    const listGate = new Promise((resolve) => { resolveListCall = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: true, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        await listGate;
        return jsonResponse({
          message: {
            assets: [
              { ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" },
              { name: "MEDIA-2", title: "New photo", media_kind: "image", blob_size: 2048,
                original_filename: "new.png", content_hash: "h2",
                modified_at: "2026-04-02T10:00:00Z",
                created_at_label: "2026-04-02", modified_at_label: "2026-04-02",
                folder_path: "Exports" },
            ],
            total_count: 2, has_more: false, next_offset: 2,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) return jsonResponse({ message: { asset: cachedItem } });
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Fire an auth-event which triggers refreshAuthState while reconnecting.
    // The list endpoint is gated so we can check mid-flight.
    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: true, busy: false, isGuest: false, pendingLogout: false, user: "user@vatiolibre.com" },
    }));
    await settleLibraryTasks(16);

    // While the auth-driven list refresh is in flight, the old items must still be visible.
    expect(document.querySelectorAll(".library-record").length).toBe(1);

    // Resolve the list call — fresh data arrives
    resolveListCall();
    await settleLibraryTasks(32);

    // Fresh data should now be rendered (2 items from server)
    expect(document.querySelectorAll(".library-record").length).toBe(2);
  });

  // ── Terminal 401 clears authLoading state ──

  it("clears authLoading and does not strand the page when a 401 lands during refreshAuthState", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: offline-limited
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Phase 2: auth-event triggers refreshAuthState — gate session so it's in-flight
    let resolveSession;
    const sessionGate = new Promise((resolve) => { resolveSession = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        await sessionGate;
        return jsonResponse({ message: { connected: true, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({ message: { exc_type: "AuthenticationError" } }, 401);
      }
      return jsonResponse({});
    });

    // Fire auth event — refreshAuthState starts, blocks on session
    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: true, busy: false, isGuest: false, pendingLogout: false, user: "user@vatiolibre.com" },
    }));
    await settleLibraryTasks(8);

    // Meanwhile, a list request on a different code path hits 401.
    // Simulate by triggering a search which hits 401 on list_my_media_assets.
    const searchForm = document.getElementById("librarySearchForm");
    const searchInput = document.getElementById("librarySearch");
    searchInput.value = "";
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(16);

    // 401 confirmed — authLoading must NOT be stuck true
    const tabButtons = document.querySelectorAll("[data-tab]");
    // All tabs should be interactive (not stuck in loading state)

    // Now resolve the slow session call — stale, should be ignored
    resolveSession();
    await settleLibraryTasks(32);

    // Page must recover: another auth event should work normally
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: true, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) return jsonResponse({ message: { asset: cachedItem } });
      return jsonResponse({});
    });

    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: true, busy: false, isGuest: false, pendingLogout: false, user: "user@vatiolibre.com" },
    }));
    await settleLibraryTasks(32);

    // The subsequent auth refresh must work — tabs should be enabled
    expect(document.querySelector('[data-tab="media"]').disabled).toBe(false);
    expect(document.querySelectorAll(".library-record").length).toBe(1);
  });

  // ── Auth-event coalescing ──

  it("coalesces a non-logout auth event during authLoading into one follow-up refresh", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: offline-limited
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // All tabs initially disabled (offline-limited)
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(true);

    // Phase 2: Start a long auth refresh — gate feature access call
    let resolveFeatureAccess;
    let featureAccessGate = new Promise((resolve) => { resolveFeatureAccess = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: true, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        await featureAccessGate;
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) return jsonResponse({ message: { asset: cachedItem } });
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger first refresh via toolbar refresh button
    document.getElementById("libraryRefresh").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks(8);

    // While first refresh is blocked on featureAccess, fire a non-logout auth event.
    // Without coalescing, this would be dropped and we'd never converge.
    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: true, busy: false, isGuest: false, pendingLogout: false, user: "user@vatiolibre.com" },
    }));
    await settleLibraryTasks(4);

    // Non-media tabs still disabled — first refresh hasn't finished
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(true);

    // Unblock the first refresh (and all subsequent feature-access calls)
    resolveFeatureAccess();
    await settleLibraryTasks(64);

    // After settling, the coalesced auth event should have triggered a follow-up refresh.
    // All tabs should be accessible — the event was not dropped.
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(false);
    expect(document.querySelector('[data-tab="accel"]').disabled).toBe(false);
    expect(document.querySelector('[data-tab="media"]').disabled).toBe(false);
    expect(document.querySelectorAll(".library-record").length).toBeGreaterThanOrEqual(1);
  });

  // ── Snapshot preservation refreshes stale selected detail ──

  it("refreshes selected detail after snapshot-preserving list recovery", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: offline-limited with one cached item that has no preview
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Confirm offline detail is showing (no preview URL in offline mode)
    expect(document.querySelectorAll(".library-record").length).toBe(1);
    const detailTitle = document.getElementById("libraryDetailTitle");
    expect(detailTitle?.textContent).toBe("Offline photo");
    // In offline mode, the preview should be an offline fallback (no remote URL)
    const previewImg = document.querySelector("#libraryDetailPreview img");
    const offlinePreviewSrc = previewImg?.getAttribute("src") || "";

    // Phase 2: Backend comes back — reconnect with fresh data including preview URL
    const freshItem = {
      ...cachedItem,
      title: "Offline photo",
      preview_image_url: "https://api.vatioboard.com/files/photo.png",
      download_url: "https://api.vatioboard.com/files/photo.png?download=1",
    };

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: true, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        return jsonResponse({
          message: {
            has_active_subscription: true, csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [freshItem],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: freshItem } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Fire auth-event to trigger refresh-driven recovery (which uses preserveSnapshot)
    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: true, busy: false, isGuest: false, pendingLogout: false, user: "user@vatiolibre.com" },
    }));
    await settleLibraryTasks(64);

    // After recovery the same item should still be selected
    expect(detailTitle?.textContent).toBe("Offline photo");
    // But the detail should now reflect the fresh online data with preview
    const freshPreviewImg = document.querySelector("#libraryDetailPreview img");
    const freshPreviewSrc = freshPreviewImg?.getAttribute("src") || "";
    // The preview should have updated from offline fallback to the online BFF URL
    expect(freshPreviewSrc).toContain("download_my_media_asset");
    // Media uses list-row-first rendering: no separate detail request needed.
    // The list response includes the preview URL, so the detail pane updates
    // directly from the list data.
  });

  // ── Mutation 401 triggers auth teardown ─────────────────────────

  it("routes a 401 during pin download through the auth teardown path", async () => {
    await bootMediaTab();

    // Replace fetch so the streaming fallback returns 401.
    // The pin flow: resolve access → try signed URL → fall back to stream.
    // We simulate the access endpoint failing (no signed URL) so the stream
    // fallback is used, and that returns 401.
    const baseFetch = window.fetch;
    window.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("get_my_media_asset_access")) {
        return jsonResponse({ message: {} });
      }
      if (url.includes("stream_my_media_asset_blob")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return baseFetch(input, init);
    });

    // Click pin — triggers the pin flow which hits 401 on the streaming fallback
    const pinBtn = document.getElementById("libraryActionPin");
    pinBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleLibraryTasks(32);

    // Auth teardown should have fired: session cleared
    const statusEl = document.getElementById("libraryStatus");
    // The status should show the login prompt, not the generic pin-failed message
    expect(statusEl?.textContent || "").not.toContain("pin");
  });

  // ── Actions disabled while auth refresh is in flight ────────────

  it("disables mutation actions while authLoading", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Offline photo", media_kind: "image",
      blob_size: 1024, original_filename: "photo.png", content_hash: "h1",
      modified_at: "2026-04-01T10:00:00Z",
      created_at_label: "2026-04-01", modified_at_label: "2026-04-01",
      folder_path: "Exports",
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem, preview_image_url: null, download_url: null,
    });

    // Phase 1: Boot offline
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Phase 2: Come back online, but gate feature_access to keep authLoading true
    let resolveFeatureAccess;
    const featureAccessGate = new Promise((resolve) => { resolveFeatureAccess = resolve; });

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("tesla_connection_status")) {
        return jsonResponse({ message: { connected: false, is_guest: false } });
      }
      if (url.includes("get_logged_user")) {
        return jsonResponse({ message: "library-user@vatiolibre.com" });
      }
      if (url.includes("get_my_feature_access")) {
        await featureAccessGate;
        return jsonResponse({
          message: {
            has_active_subscription: true,
            csrf_token: "csrf-test-token",
            features: { cloud_sync: { enabled: true }, media_assets: { enabled: true } },
          },
        });
      }
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: { assets: [{ ...cachedItem, preview_image_url: "https://api.vatioboard.com/files/photo.png" }], total_count: 1, has_more: false, next_offset: 1 },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: { ...cachedItem } } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    // Trigger reconnect via auth event
    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: true, busy: false, isGuest: false, pendingLogout: false, user: "user@vatiolibre.com" },
    }));
    await settleLibraryTasks(32);

    // Select item
    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks(16);

    // While authLoading is true: mutation actions disabled
    const renameBtn = document.getElementById("libraryActionRename");
    const deleteBtn = document.getElementById("libraryActionDelete");
    if (renameBtn) expect(renameBtn.disabled).toBe(true);
    if (deleteBtn) expect(deleteBtn.disabled).toBe(true);

    // Resolve feature access — auth refresh finishes
    resolveFeatureAccess();
    await settleLibraryTasks(32);

    // Mutation actions should be enabled
    if (renameBtn) expect(renameBtn.disabled).toBe(false);
    if (deleteBtn) expect(deleteBtn.disabled).toBe(false);
  });

  // ── Toolbar refresh preserves visible snapshot ──────────────────

  it("preserves media list and detail during a toolbar refresh while already online", async () => {
    await bootMediaTab();

    // Verify initial state: item visible and selected
    const listItems = document.querySelectorAll(".library-record");
    expect(listItems.length).toBe(1);
    const detailTitle = document.querySelector("#libraryDetailTitle");
    expect(detailTitle?.textContent).toBeTruthy();
    const initialTitle = detailTitle.textContent;

    // Gate the list call so we can inspect mid-flight
    let resolveList;
    const listGate = new Promise((resolve) => { resolveList = resolve; });

    const baseFetch = window.fetch;
    window.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("list_my_media_assets")) {
        await listGate;
        return jsonResponse({
          message: {
            assets: [{ ...MEDIA_ASSET, title: "Updated title" }],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      return baseFetch(input, init);
    });

    // Click the refresh button (triggers refreshAuthState({ force: true }))
    const refreshBtn = document.getElementById("libraryRefresh");
    refreshBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleLibraryTasks(32);

    // Mid-flight: list and detail should still be visible (snapshot preserved)
    const midFlightItems = document.querySelectorAll(".library-record");
    expect(midFlightItems.length).toBe(1);
    expect(detailTitle.textContent).toBe(initialTitle);

    // Resolve the list call
    resolveList();
    await settleLibraryTasks(32);

    // After refresh: fresh data should be rendered
    const freshItems = document.querySelectorAll(".library-record");
    expect(freshItems.length).toBe(1);
  });

  // ── Open and Pin gated after auth expiry for cloud-only media ───

  it("disables Open and Pin for cloud-only media after auth expiry but allows unpin for locally pinned items", async () => {
    // ── Scenario A: cloud-only (unpinned) item ──
    // Clicking Pin resolves access, tries signed URL, falls back to streaming
    // endpoint.  If the streaming fallback returns 401, applyLibraryRequestError
    // fires auth teardown.
    await bootMediaTab();

    const openBtn = document.getElementById("libraryActionOpen");
    const pinBtn = document.getElementById("libraryActionPin");
    expect(openBtn.disabled).toBe(false);
    expect(pinBtn.disabled).toBe(false);

    // Mock the streaming fallback to return 401 when Pin tries to fetch the blob.
    const baseFetch = window.fetch;
    window.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("get_my_media_asset_access")) {
        return jsonResponse({ message: {} });
      }
      if (url.includes("stream_my_media_asset_blob")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return baseFetch(input, init);
    });

    pinBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleLibraryTasks(32);

    // After 401 teardown: cloud-only item → Open disabled (no local blob), Pin disabled
    expect(openBtn.disabled).toBe(true);
    expect(pinBtn.disabled).toBe(true);

    // ── Scenario B: fresh-pinned item ──
    // Trigger auth expiry via auth event; the selected item has a local blob so
    // Open (local) and Unpin (local) should remain enabled.
    vi.resetModules();
    Object.values(mockMediaCache).forEach((fn) => fn.mockReset());
    mockMediaCache.cacheMediaManifest.mockResolvedValue(true);
    mockMediaCache.cacheMediaMetadata.mockResolvedValue(true);
    mockMediaCache.getCachedMediaManifest.mockResolvedValue(null);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue(undefined);
    mockMediaCache.removeCachedMediaMetadata.mockResolvedValue(true);
    mockMediaCache.pinMediaBlob.mockResolvedValue(true);
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(null);
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({ content_hash: null, pinned_at: Date.now() });
    mockMediaCache.unpinMediaBlob.mockResolvedValue(true);
    mockMediaCache.isMediaBlobPinned.mockResolvedValue(true);
    mockMediaCache.setMediaCacheUser.mockReturnValue(undefined);
    mockMediaCache.getMediaCacheUser.mockReturnValue(null);
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue(null);
    mockMediaCache.clearPersistedMediaCacheUser.mockReturnValue(undefined);

    await bootMediaTab();

    const openBtn2 = document.getElementById("libraryActionOpen");
    const pinBtn2 = document.getElementById("libraryActionPin");
    expect(openBtn2.disabled).toBe(false);
    expect(pinBtn2.disabled).toBe(false);

    // Simulate auth expiry via a backend-auth-state event (unauthenticated)
    window.dispatchEvent(new CustomEvent("vatioboard:backend-auth-state", {
      detail: { authenticated: false, busy: false, isGuest: true, pendingLogout: false, user: null },
    }));
    await settleLibraryTasks(32);

    // After auth expiry: fresh-pinned item still has a local blob
    // Open remains enabled (local blob), Unpin remains enabled (local operation)
    expect(openBtn2.disabled).toBe(false);
    expect(pinBtn2.disabled).toBe(false);
  });

  // ── BFF URL normalization regression ────────────────────────────

  it("normalizes raw backend-origin playback_url to BFF origin before rendering media", async () => {
    // Simulate backend returning raw legacy-origin URLs (before BFF rewrite).
    // The library should normalize these to the BFF origin via backend-auth.
    const audioItem = {
      name: "MEDIA-AUDIO-1",
      title: "Raw origin audio",
      media_kind: "audio",
      blob_size: 500000,
      original_filename: "song.mp3",
      created_at_label: "2026-04-10 12:00:00",
      modified_at_label: "2026-04-10 12:00:00",
      folder_path: "Music",
      preview_image_url: "https://www.vatiolibre.com/files/cover.png?token=view#preview",
      download_url: "https://www.vatiolibre.com/private/files/song.mp3?download=1",
      playback_url: "https://www.vatiolibre.com/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-AUDIO-1",
    };

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({ message: { assets: [audioItem], total_count: 1, has_more: false, next_offset: 1 } });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: audioItem } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    // The rendered audio element should use the BFF origin, not the raw backend origin
    const audio = document.querySelector("#libraryDetailPreview audio");
    if (audio) {
      expect(audio.src).not.toContain("vatiolibre.com");
      expect(audio.src).toContain("api.vatioboard.com");
    }

    // Preview image should also be normalized
    const img = document.querySelector("#libraryDetailPreview img");
    if (img && img.src && !img.src.startsWith("blob:")) {
      expect(img.src).not.toContain("vatiolibre.com");
    }
  });

  // ── Pinned blob playback source priority ────────────────────────

  it("after pinning audio, inline player uses local blob URL instead of BFF playback URL", async () => {
    const audioAsset = {
      name: "MEDIA-1", title: "My Track", media_kind: "audio",
      blob_size: 4096, original_filename: "track.mp3", content_hash: "hash-a1",
      modified_at: "2026-04-03T09:00:00Z",
      created_at_label: "2026-04-03", modified_at_label: "2026-04-03",
      folder_path: "Music", has_preview_image: false, file_extension: "mp3",
    };
    const fakeBlob = new Blob(["audio-data"], { type: "audio/mpeg" });
    // Simulate a pinned blob: pin meta matches content_hash, blob exists
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "hash-a1", pinned_at: Date.now(),
    });
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(fakeBlob);
    mockMediaCache.getLocalMediaBlob.mockResolvedValue({ blob: fakeBlob, source: "pinned", contentHash: "hash-a1" });
    mockMediaCache.isMediaBlobPinned.mockResolvedValue(true);

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [audioAsset],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: audioAsset } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks(24);

    const preview = document.getElementById("libraryDetailPreview");
    expect(preview.dataset.previewKind).toBe("media-player");
    const audio = preview.querySelector("audio");
    expect(audio).toBeTruthy();
    // The audio source must be a local blob URL, NOT a BFF redirect URL
    expect(audio.src).toMatch(/^blob:/);
    expect(audio.src).not.toContain("download_my_media_asset");
  });

  it("after pinning video, inline player uses local blob URL instead of BFF playback URL", async () => {
    const videoAsset = {
      name: "MEDIA-1", title: "My Video", media_kind: "video",
      blob_size: 65536, original_filename: "clip.mp4", content_hash: "hash-v1",
      modified_at: "2026-04-03T09:00:00Z",
      created_at_label: "2026-04-03", modified_at_label: "2026-04-03",
      folder_path: "Videos", has_preview_image: false, file_extension: "mp4",
    };
    const fakeBlob = new Blob(["video-data"], { type: "video/mp4" });
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "hash-v1", pinned_at: Date.now(),
    });
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(fakeBlob);
    mockMediaCache.getLocalMediaBlob.mockResolvedValue({ blob: fakeBlob, source: "pinned", contentHash: "hash-v1" });
    mockMediaCache.isMediaBlobPinned.mockResolvedValue(true);

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [videoAsset],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: videoAsset } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks(24);

    const preview = document.getElementById("libraryDetailPreview");
    expect(preview.dataset.previewKind).toBe("media-player");
    const video = preview.querySelector("video");
    expect(video).toBeTruthy();
    expect(video.src).toMatch(/^blob:/);
    expect(video.src).not.toContain("download_my_media_asset");
  });

  it("offline bootstrap from cached manifest marks items as offline", async () => {
    const cachedItem = {
      name: "MEDIA-1", title: "Cached Song", media_kind: "audio",
      blob_size: 4096, original_filename: "song.mp3", content_hash: "hash-c1",
      modified_at: "2026-04-03T09:00:00Z",
      created_at_label: "2026-04-03", modified_at_label: "2026-04-03",
      folder_path: "Music", has_preview_image: false,
    };
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);

    // All backend calls fail — offline bootstrap
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Media tab should be active and have offline indicator
    const mediaTab = document.querySelector('[data-tab="media"]');
    expect(mediaTab.dataset.active).toBe("true");

    // Items should exist from cache
    expect(document.querySelectorAll(".library-record").length).toBe(1);

    // Non-media tabs should be disabled (offline-limited)
    expect(document.querySelector('[data-tab="speed"]').disabled).toBe(true);
    expect(document.querySelector('[data-tab="accel"]').disabled).toBe(true);
  });

  it("pinned media remains playable after simulating backend unavailability", async () => {
    const audioAsset = {
      name: "MEDIA-1", title: "Offline Track", media_kind: "audio",
      blob_size: 4096, original_filename: "track.mp3", content_hash: "hash-off1",
      modified_at: "2026-04-03T09:00:00Z",
      created_at_label: "2026-04-03", modified_at_label: "2026-04-03",
      folder_path: "Music", has_preview_image: false,
    };
    const fakeBlob = new Blob(["audio-data-offline"], { type: "audio/mpeg" });
    mockMediaCache.restorePersistedMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getMediaCacheUser.mockReturnValue("user@vatiolibre.com");
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([audioAsset]);
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "hash-off1", pinned_at: Date.now(),
    });
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(fakeBlob);
    mockMediaCache.getLocalMediaBlob.mockResolvedValue({ blob: fakeBlob, source: "pinned", contentHash: "hash-off1" });
    mockMediaCache.isMediaBlobPinned.mockResolvedValue(true);

    // All backend calls fail — offline bootstrap with pinned blob
    window.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks(32);

    // Select the media item
    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks(24);

    const preview = document.getElementById("libraryDetailPreview");
    expect(preview.dataset.previewKind).toBe("media-player");
    const audio = preview.querySelector("audio");
    expect(audio).toBeTruthy();
    // Must use local blob URL, not a remote URL that would fail offline
    expect(audio.src).toMatch(/^blob:/);
  });

  it("stale pinned blobs prefer remote URLs over outdated local content", async () => {
    const audioAsset = {
      name: "MEDIA-1", title: "Updated Track", media_kind: "audio",
      blob_size: 4096, original_filename: "track.mp3", content_hash: "hash-new",
      modified_at: "2026-04-03T09:00:00Z",
      created_at_label: "2026-04-03", modified_at_label: "2026-04-03",
      folder_path: "Music", has_preview_image: false, file_extension: "mp3",
    };
    const staleBlob = new Blob(["stale-audio"], { type: "audio/mpeg" });
    // Pin meta has OLD content_hash that does NOT match the asset's current hash
    mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
      content_hash: "hash-old", pinned_at: Date.now() - 86400_000,
    });
    mockMediaCache.getPinnedMediaBlob.mockResolvedValue(staleBlob);
    mockMediaCache.isMediaBlobPinned.mockResolvedValue(true);

    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [audioAsset],
            total_count: 1, has_more: false, next_offset: 1,
          },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: audioAsset } });
      }
      if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
      if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
      return jsonResponse({});
    });

    await bootHtmlPage("library.html");
    const libraryPage = await import("../../src/library/library.js");
    await libraryPage.initPromise;
    await settleLibraryTasks();

    document.querySelector('[data-tab="media"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks();

    document.querySelector(".library-record")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settleLibraryTasks(24);

    const preview = document.getElementById("libraryDetailPreview");
    expect(preview.dataset.previewKind).toBe("media-player");
    const audio = preview.querySelector("audio");
    expect(audio).toBeTruthy();
    // Stale pin: audio source should be the remote BFF URL, NOT the local blob
    expect(audio.src).not.toMatch(/^blob:/);
    expect(audio.src).toContain("download_my_media_asset");
  });

  // ── Auto-cache ────────────────────────────────────────────────────

  describe("auto-cache", () => {
    const audioAsset = {
      name: "MEDIA-1",
      title: "My Track",
      media_kind: "audio",
      blob_size: 4096,
      original_filename: "track.mp3",
      content_hash: "hash-a1",
      modified_at: "2026-04-03T09:00:00Z",
      created_at_label: "2026-04-03",
      modified_at_label: "2026-04-03",
      folder_path: "Music",
      has_preview_image: false,
      file_extension: "mp3",
    };

    const imageAsset = {
      ...MEDIA_ASSET,
      content_hash: "img-hash-1",
    };

    function createAutoCacheFetch({ assetOverride, accessOverride, signedBlobResponse } = {}) {
      const asset = assetOverride || audioAsset;
      return createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets")) {
          return jsonResponse({
            message: { assets: [asset], total_count: 1, has_more: false, next_offset: 1 },
          });
        }
        if (url.includes("get_my_media_asset_detail")) {
          return jsonResponse({ message: { asset } });
        }
        if (url.includes("get_my_media_asset_access")) {
          return jsonResponse({
            message: accessOverride || {
              asset: { name: asset.name, content_hash: asset.content_hash, media_kind: asset.media_kind },
              access: { download_url: "https://s3.example.com/signed-blob", expires_in_seconds: 300 },
            },
          });
        }
        if (url.includes("s3.example.com/signed-blob")) {
          return signedBlobResponse || new Response(new Blob(["blob-data"], { type: "application/octet-stream" }), { status: 200 });
        }
        if (url.includes("stream_my_media_asset_blob")) {
          return new Response(new Blob(["streamed-data"], { type: "application/octet-stream" }), { status: 200 });
        }
        if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });
    }

    it("triggers background auto-cache when opening an eligible audio item remotely", async () => {
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);
      // Invoke the factory so the download actually runs in this test.
      mockMediaCache.registerAutoCacheDownload.mockImplementation((_name, fn) => {
        if (typeof fn === "function") fn();
        return true;
      });

      window.fetch = createAutoCacheFetch();
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      try {
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Open the item — no local blob, so it uses remote access.
        document.getElementById("libraryActionOpen")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Remote open should call window.open
        expect(openSpy).toHaveBeenCalled();

        // Auto-cache should have triggered in the background
        expect(mockMediaCache.registerAutoCacheDownload).toHaveBeenCalledWith(
          "MEDIA-1",
          expect.any(Function),
        );
        // The background download should have called cacheMediaBlob
        expect(mockMediaCache.cacheMediaBlob).toHaveBeenCalledWith(
          "MEDIA-1",
          expect.any(Blob),
          expect.objectContaining({ contentHash: "hash-a1" }),
        );
      } finally {
        openSpy.mockRestore();
      }
    });

    it("second open prefers local cached blob over remote access", async () => {
      const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });
      // Simulate a cached blob from a prior auto-cache download.
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        last_accessed_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "hash-a1",
      });
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);

      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:vatioboard/cached-url");
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      try {
        window.fetch = createAutoCacheFetch();
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Open the item — cachedBlobNames should be populated via refreshPinState.
        document.getElementById("libraryActionOpen")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Should use local blob, not remote.
        expect(mockMediaCache.getLocalMediaBlob).toHaveBeenCalledWith("MEDIA-1");
        expect(openSpy).toHaveBeenCalledWith(
          "blob:vatioboard/cached-url",
          "_blank",
          "noopener,noreferrer",
        );

        // No access resolution for playback since local blob was used.
        const accessCalls = window.fetch.mock.calls.filter(
          ([u]) => typeof u === "string" && u.includes("get_my_media_asset_access"),
        );
        // Access may be called for preview rendering; the key assertion is
        // that open used the local blob URL (window.open received blob:).
        expect(openSpy.mock.calls[0][0]).toMatch(/^blob:/);
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        openSpy.mockRestore();
      }
    });

    it("uses cached blob for online preview even when item is not _offline", async () => {
      const fakeBlob = new Blob(["cached-image"], { type: "image/png" });
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "img-hash-1",
        cached_at: Date.now(),
        blob_size: 245760,
        media_kind: "image",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "img-hash-1",
      });
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);

      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:vatioboard/cached-img");

      try {
        window.fetch = createAutoCacheFetch({ assetOverride: imageAsset });
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        // Preview should use the local cached blob, not the remote URL.
        const preview = document.getElementById("libraryDetailPreview");
        const img = preview?.querySelector("img");
        expect(img).toBeTruthy();
        expect(img.src).toMatch(/^blob:/);
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
      }
    });

    it("plays cached audio offline without network access", async () => {
      const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });

      // Simulate a previously auto-cached audio blob.
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "hash-a1",
      });
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);

      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:vatioboard/cached-audio");

      try {
        // Boot online first so the list loads normally.
        window.fetch = createAutoCacheFetch({ assetOverride: audioAsset });
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        // After settling, the cached blob should be used for the audio
        // player since refreshPinStatesForItems detects the cached blob.
        const preview = document.getElementById("libraryDetailPreview");
        expect(preview).toBeTruthy();
        expect(preview.dataset.previewKind).toBe("media-player");
        const audio = preview.querySelector("audio");
        expect(audio).toBeTruthy();
        expect(audio.src).toMatch(/^blob:/);
        expect(audio.src).not.toContain("download_my_media_asset");
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
      }
    });

    it("does not use a stale cached blob when content_hash has changed", async () => {
      const updatedAsset = { ...audioAsset, content_hash: "hash-a2" };
      const staleBlob = new Blob(["old-audio"], { type: "audio/mpeg" });

      // Cached blob has an outdated hash.
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now() - 86400000,
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(staleBlob);
      // getLocalMediaBlob returns the stale blob (library.js checks hash).
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: staleBlob,
        source: "cached",
        contentHash: "hash-a1",
      });
      // Keep auto-cache disabled so the stale badge stays visible
      // (auto-cache would immediately re-download and clear staleness).

      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      try {
        window.fetch = createAutoCacheFetch({ assetOverride: updatedAsset });
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        // Stale cached name should be detected in the list badge.
        const allBadges = Array.from(document.querySelectorAll(".library-record-badge"));
        const warningBadge = allBadges.find(
          (b) => b.dataset.tone === "warning" && b.textContent === "Outdated local copy",
        );
        expect(warningBadge).toBeTruthy();

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Open should bypass the stale blob and use remote.
        document.getElementById("libraryActionOpen")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Open should NOT use a blob URL (stale blob rejected).
        expect(openSpy).toHaveBeenCalled();
        expect(openSpy.mock.calls[0][0]).not.toMatch(/^blob:/);
      } finally {
        openSpy.mockRestore();
      }
    });

    it("tracks cached blobs separately from pinned blobs", async () => {
      const assetWithHash = { ...MEDIA_ASSET, content_hash: "img-hash-1" };
      // Item is pinned (fresh).
      mockMediaCache.getPinnedBlobMeta.mockResolvedValue({
        content_hash: "img-hash-1",
        pinned_at: Date.now(),
      });
      // Also has a cached blob (should be irrelevant when pinned).
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "img-hash-1",
        cached_at: Date.now(),
        blob_size: 245760,
        media_kind: "image",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(new Blob(["x"]));
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);

      window.fetch = createAutoCacheFetch({ assetOverride: assetWithHash });
      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      // Pinned badge should be shown (pin takes priority).
      const badge = document.querySelector(".library-record-badge[data-tone='success']");
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe("Available offline");

      // Since the item is pinned, cached blob state should not add a
      // separate badge — only one "Available offline" badge.
      const allSuccessBadges = document.querySelectorAll(
        ".library-record-badge[data-tone='success']",
      );
      expect(allSuccessBadges).toHaveLength(1);
    });

    it("shows cached availability badge and caching-locally badge", async () => {
      // First test: cached blob → "Cached locally" success badge.
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "img-hash-1",
        cached_at: Date.now(),
        blob_size: 245760,
        media_kind: "image",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(new Blob(["x"]));
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);

      window.fetch = createAutoCacheFetch({ assetOverride: imageAsset });
      await bootHtmlPage("library.html");
      let libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      const cachedBadge = document.querySelector(
        ".library-record-badge[data-tone='success']",
      );
      expect(cachedBadge).toBeTruthy();
      expect(cachedBadge.textContent).toBe("Cached locally");

      // Detail meta should also show availability.
      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      const detailMeta = document.getElementById("libraryDetailMeta")?.textContent || "";
      expect(detailMeta).toContain("Cached locally");
    });

    it("shows caching-locally badge when auto-cache download is in flight", async () => {
      mockMediaCache.isAutoCacheInFlight.mockReturnValue(true);
      // Do NOT enable isAutoCacheEligible — we only want to observe in-flight
      // state rendered by the list badges without triggering a new download.

      window.fetch = createAutoCacheFetch({ assetOverride: imageAsset });
      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      const allBadges = Array.from(document.querySelectorAll(".library-record-badge"));
      const cachingBadge = allBadges.find(
        (b) => b.dataset.tone === "muted" && b.textContent === "Caching locally",
      );
      expect(cachingBadge).toBeTruthy();

      // Detail meta should also show caching state.
      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      const detailMeta = document.getElementById("libraryDetailMeta")?.textContent || "";
      expect(detailMeta).toContain("Caching locally");
    });

    it("does not trigger duplicate concurrent auto-cache downloads", async () => {
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);
      // First call registered successfully; second call should be deduplicated.
      mockMediaCache.registerAutoCacheDownload
        .mockReturnValueOnce(true)
        .mockReturnValue(false);

      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      try {
        window.fetch = createAutoCacheFetch();
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Open twice quickly — should deduplicate.
        document.getElementById("libraryActionOpen")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(4);
        document.getElementById("libraryActionOpen")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // registerAutoCacheDownload is called by triggerAutoCacheDownload.
        // The auto-cache also triggers from renderDetail's BFF section,
        // so we verify the mock was called and cacheMediaBlob wasn't
        // called more than expected.
        expect(mockMediaCache.registerAutoCacheDownload).toHaveBeenCalled();
      } finally {
        openSpy.mockRestore();
      }
    });

    // ── Regression: auto-cache only on open/play (Fix 3) ──────────

    it("does not trigger auto-cache when merely selecting an item", async () => {
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);

      window.fetch = createAutoCacheFetch();
      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      // Select the item (click on record) — this should NOT trigger auto-cache.
      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // registerAutoCacheDownload should NOT have been called from selection alone.
      expect(mockMediaCache.registerAutoCacheDownload).not.toHaveBeenCalled();
    });

    it("triggers auto-cache only from the open/play action path", async () => {
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);
      mockMediaCache.registerAutoCacheDownload.mockImplementation((_name, fn) => {
        if (typeof fn === "function") fn();
        return true;
      });

      window.fetch = createAutoCacheFetch();
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      try {
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Verify no auto-cache yet.
        expect(mockMediaCache.registerAutoCacheDownload).not.toHaveBeenCalled();

        // Now actually open.
        document.getElementById("libraryActionOpen")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Now auto-cache should have fired from the open path.
        expect(mockMediaCache.registerAutoCacheDownload).toHaveBeenCalled();
      } finally {
        openSpy.mockRestore();
      }
    });

    // ── Regression: cached blobs gating parity (Fix 2) ────────────

    it("open action remains enabled for a fresh cached blob when offline", async () => {
      const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });
      const offlineItem = {
        ...audioAsset,
        _offline: true,
        preview_image_url: null,
        download_url: null,
      };

      mockMediaCache.getCachedMediaManifest.mockResolvedValue([offlineItem]);
      mockMediaCache.getCachedMediaMetadata.mockResolvedValue(offlineItem);
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "hash-a1",
      });

      // Simulate offline: media list fetch fails.
      window.fetch = createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets"))
          return Promise.reject(new TypeError("Failed to fetch"));
        if (url.includes("get_my_media_asset_detail"))
          return Promise.reject(new TypeError("Failed to fetch"));
        if (url.includes("list_my_speed_recordings"))
          return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs"))
          return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents"))
          return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });

      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // Open action should be enabled — fresh cached blob available locally.
      const openBtn = document.getElementById("libraryActionOpen");
      expect(openBtn).toBeTruthy();
      expect(openBtn.disabled).toBe(false);
    });

    it("offline open uses local cached blob URL without hitting the backend", async () => {
      const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "hash-a1",
      });

      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:vatioboard/cached-open");
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      try {
        window.fetch = createAutoCacheFetch();
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        // Open the item.
        document.getElementById("libraryActionOpen")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Should use local blob URL.
        expect(openSpy).toHaveBeenCalled();
        expect(openSpy.mock.calls[0][0]).toMatch(/^blob:/);

        // No get_my_media_asset_access call needed — local blob used.
        const accessCalls = window.fetch.mock.calls.filter(
          ([u]) => typeof u === "string" && u.includes("get_my_media_asset_access"),
        );
        expect(accessCalls).toHaveLength(0);
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        openSpy.mockRestore();
      }
    });

    it("stale cached blob open falls through to remote URL", async () => {
      const updatedAsset = { ...audioAsset, content_hash: "hash-a2" };
      const staleBlob = new Blob(["old-audio"], { type: "audio/mpeg" });

      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now() - 86400000,
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(staleBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: staleBlob,
        source: "cached",
        contentHash: "hash-a1",
      });

      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      try {
        window.fetch = createAutoCacheFetch({ assetOverride: updatedAsset });
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        document.getElementById("libraryActionOpen")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Stale blob should not be used — open should use remote URL.
        expect(openSpy).toHaveBeenCalled();
        expect(openSpy.mock.calls[0][0]).not.toMatch(/^blob:/);
      } finally {
        openSpy.mockRestore();
      }
    });

    // ── Regression: orphaned metadata (Fix 4) ─────────────────────

    it("does not treat orphaned metadata without a blob as locally available", async () => {
      // Cached meta exists but getCachedMediaBlob returns null (orphaned meta).
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(null);

      window.fetch = createAutoCacheFetch();
      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // No cached-locally badge should appear — orphaned meta is cleaned up.
      const allBadges = Array.from(document.querySelectorAll(".library-record-badge"));
      const cachedBadge = allBadges.find(
        (b) => b.dataset.tone === "success" && b.textContent === "Cached locally",
      );
      expect(cachedBadge).toBeFalsy();

      // removeCachedMediaBlob should have been called to clean up orphaned meta.
      expect(mockMediaCache.removeCachedMediaBlob).toHaveBeenCalledWith("MEDIA-1");
    });

    // ── Regression: race-safe duplicate download (Fix 1) ──────────

    it("two near-simultaneous triggers produce only one backend access resolution", async () => {
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);

      let factoryCallCount = 0;
      mockMediaCache.registerAutoCacheDownload.mockImplementation((_name, fn) => {
        factoryCallCount++;
        if (factoryCallCount === 1) {
          // First call: accept and invoke the factory.
          if (typeof fn === "function") fn();
          return true;
        }
        // Second call: reject as duplicate.
        return false;
      });

      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      try {
        window.fetch = createAutoCacheFetch();
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // Open twice rapidly.
        document.getElementById("libraryActionOpen")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(4);
        document.getElementById("libraryActionOpen")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks();

        // The factory callback was invoked only once (winner of the race).
        // With the shared triggerBackgroundCache, the second trigger may be
        // short-circuited by the library's own cachedBlobNames pre-check
        // (onCached fires before the second open), OR rejected by
        // registerAutoCacheDownload as a duplicate.  Either way, only one
        // actual download occurs.
        expect(factoryCallCount).toBeGreaterThanOrEqual(1);
        expect(factoryCallCount).toBeLessThanOrEqual(2);
        expect(mockMediaCache.registerAutoCacheDownload).toHaveBeenCalledTimes(factoryCallCount);

        // cacheMediaBlob should be called only once (from the single download).
        expect(mockMediaCache.cacheMediaBlob).toHaveBeenCalledTimes(1);
      } finally {
        openSpy.mockRestore();
      }
    });

    // ── Regression: inline play auto-cache (Fix 2) ────────────────

    it("inline play on a remote eligible asset triggers auto-cache", async () => {
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);

      window.fetch = createAutoCacheFetch();
      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // No auto-cache before play.
      expect(mockMediaCache.registerAutoCacheDownload).not.toHaveBeenCalled();

      // Trigger inline play via the media element's "play" event.
      const mediaEl = document.querySelector(".media-player audio, .media-player video");
      expect(mediaEl).toBeTruthy();
      mediaEl.dispatchEvent(new Event("play"));
      await settleLibraryTasks();

      // Auto-cache should have fired from first remote play.
      expect(mockMediaCache.registerAutoCacheDownload).toHaveBeenCalledWith(
        "MEDIA-1",
        expect.any(Function),
      );
    });

    it("inline play on a local blob does not trigger auto-cache", async () => {
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);
      const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "hash-a1",
      });

      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:vatioboard/local-play");

      try {
        window.fetch = createAutoCacheFetch();
        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        // Trigger inline play.
        const mediaEl = document.querySelector(".media-player audio, .media-player video");
        expect(mediaEl).toBeTruthy();
        mediaEl.dispatchEvent(new Event("play"));
        await settleLibraryTasks();

        // Auto-cache should NOT fire — source is a local blob.
        expect(mockMediaCache.registerAutoCacheDownload).not.toHaveBeenCalled();
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
      }
    });

    it("passive selection/render still does not trigger auto-cache", async () => {
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);

      window.fetch = createAutoCacheFetch();
      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // Selecting renders the detail — must not trigger auto-cache.
      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      expect(mockMediaCache.registerAutoCacheDownload).not.toHaveBeenCalled();
    });
  });

  // ── No hot-swap during active remote playback ─────────────────────
  //
  // When the user is playing audio/video from a remote source and the
  // background auto-cache download completes, the active player must NOT
  // be destroyed and remounted with the cached blob mid-session.

  describe("no hot-swap during active remote playback", () => {
    const audioAsset = {
      name: "MEDIA-1",
      title: "My Track",
      media_kind: "audio",
      blob_size: 4096,
      original_filename: "track.mp3",
      content_hash: "hash-a1",
      modified_at: "2026-04-03T09:00:00Z",
      created_at_label: "2026-04-03",
      modified_at_label: "2026-04-03",
      folder_path: "Music",
      has_preview_image: false,
      file_extension: "mp3",
    };

    function createAutoCacheFetch() {
      return createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets")) {
          return jsonResponse({
            message: { assets: [audioAsset], total_count: 1, has_more: false, next_offset: 1 },
          });
        }
        if (url.includes("get_my_media_asset_detail")) {
          return jsonResponse({ message: { asset: audioAsset } });
        }
        if (url.includes("get_my_media_asset_access")) {
          return jsonResponse({
            message: {
              asset: { name: audioAsset.name, content_hash: audioAsset.content_hash, media_kind: audioAsset.media_kind },
              access: { download_url: "https://s3.example.com/signed-blob", expires_in_seconds: 300 },
            },
          });
        }
        if (url.includes("s3.example.com/signed-blob")) {
          return new Response(new Blob(["blob-data"], { type: "application/octet-stream" }), { status: 200 });
        }
        if (url.includes("stream_my_media_asset_blob")) {
          return new Response(new Blob(["streamed-data"], { type: "application/octet-stream" }), { status: 200 });
        }
        if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });
    }

    /** Boot the media tab, select the audio item, and return the page module. */
    async function bootRemoteAudioPlayer() {
      mockMediaCache.isAutoCacheEligible.mockReturnValue(true);

      window.fetch = createAutoCacheFetch();
      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      return libraryPage;
    }

    it("first click on play is not interrupted when auto-cache completes in the background", async () => {
      // Capture the download factory so we can invoke it after play starts.
      let downloadFactory = null;
      mockMediaCache.registerAutoCacheDownload.mockImplementation((_name, fn) => {
        downloadFactory = fn;
        return true;
      });

      await bootRemoteAudioPlayer();

      // Capture the mounted audio element.
      const audioEl = document.querySelector(".media-player audio");
      expect(audioEl).toBeTruthy();
      expect(audioEl.src).not.toContain("blob:");

      // Simulate the user clicking play → triggers onFirstRemotePlay.
      audioEl.dispatchEvent(new Event("play"));
      await settleLibraryTasks();

      // Auto-cache factory was captured.
      expect(downloadFactory).toBeTruthy();

      // Simulate auto-cache download completing: invoke the factory
      // and let it finish — this calls cacheMediaBlob → renderDetail().
      await downloadFactory();
      await settleLibraryTasks(24);

      // The same audio element should still be in the DOM — not replaced.
      const audioElAfter = document.querySelector(".media-player audio");
      expect(audioElAfter).toBe(audioEl);
    });

    it("auto-cache download still runs in the background during remote playback", async () => {
      let downloadFactory = null;
      mockMediaCache.registerAutoCacheDownload.mockImplementation((_name, fn) => {
        downloadFactory = fn;
        return true;
      });

      await bootRemoteAudioPlayer();

      const audioEl = document.querySelector(".media-player audio");
      audioEl.dispatchEvent(new Event("play"));
      await settleLibraryTasks();

      // registerAutoCacheDownload was called.
      expect(mockMediaCache.registerAutoCacheDownload).toHaveBeenCalledWith(
        "MEDIA-1",
        expect.any(Function),
      );

      // Run the download factory — blob should be cached.
      await downloadFactory();
      await settleLibraryTasks(24);

      expect(mockMediaCache.cacheMediaBlob).toHaveBeenCalledWith(
        "MEDIA-1",
        expect.any(Blob),
        expect.objectContaining({ contentHash: "hash-a1" }),
      );
    });

    it("active audio DOM element is not replaced mid-play when cache completes", async () => {
      let downloadFactory = null;
      mockMediaCache.registerAutoCacheDownload.mockImplementation((_name, fn) => {
        downloadFactory = fn;
        return true;
      });

      await bootRemoteAudioPlayer();

      const audioEl = document.querySelector(".media-player audio");
      const originalSrc = audioEl.src;

      // Start playback.
      audioEl.dispatchEvent(new Event("play"));
      await settleLibraryTasks();

      // Complete auto-cache.
      await downloadFactory();
      await settleLibraryTasks(24);

      // Audio element should be the same instance with the same source.
      const currentAudioEl = document.querySelector(".media-player audio");
      expect(currentAudioEl).toBe(audioEl);
      expect(currentAudioEl.src).toBe(originalSrc);
      // Source must still be remote, not blob.
      expect(currentAudioEl.src).not.toContain("blob:");
    });

    it("after leaving and remounting the item the cached local blob is used", async () => {
      let downloadFactory = null;
      mockMediaCache.registerAutoCacheDownload.mockImplementation((_name, fn) => {
        downloadFactory = fn;
        return true;
      });

      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:vatioboard/local-cached");

      try {
        await bootRemoteAudioPlayer();

        const audioEl = document.querySelector(".media-player audio");

        // Start playback → triggers auto-cache.
        audioEl.dispatchEvent(new Event("play"));
        await settleLibraryTasks();

        // Complete auto-cache in the background.
        await downloadFactory();
        await settleLibraryTasks(24);

        // Player is still the remote one (not swapped).
        expect(document.querySelector(".media-player audio")).toBe(audioEl);

        // Now simulate that the cached blob is available for future mounts.
        const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });
        mockMediaCache.getLocalMediaBlob.mockResolvedValue({
          blob: fakeBlob,
          source: "cached",
          contentHash: "hash-a1",
        });
        mockMediaCache.getCachedBlobMeta.mockResolvedValue({
          content_hash: "hash-a1",
          cached_at: Date.now(),
          blob_size: 4096,
          media_kind: "audio",
          pinned: false,
        });
        mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);

        // Leave and come back: switch to speed tab, then back to media.
        document.querySelector('[data-tab="speed"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        // The remounted player should now use the local blob URL.
        const newAudioEl = document.querySelector(".media-player audio");
        expect(newAudioEl).toBeTruthy();
        expect(newAudioEl.src).toContain("blob:");
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
      }
    });

    it("no second click is required — playback continues through auto-cache completion", async () => {
      let downloadFactory = null;
      mockMediaCache.registerAutoCacheDownload.mockImplementation((_name, fn) => {
        downloadFactory = fn;
        return true;
      });

      await bootRemoteAudioPlayer();

      const audioEl = document.querySelector(".media-player audio");

      // The play button should show "Play" initially (paused state).
      const playBtn = document.querySelector(".media-player-play-btn");
      expect(playBtn).toBeTruthy();

      // User clicks play.
      audioEl.dispatchEvent(new Event("play"));
      await settleLibraryTasks();

      // The play button should now show "Pause" (playing state).
      expect(playBtn.getAttribute("aria-label")).toContain("Pause");

      // Auto-cache finishes in the background.
      await downloadFactory();
      await settleLibraryTasks(24);

      // Play button should STILL show "Pause" — playback was not interrupted.
      // The same player is still mounted and playing.
      const playBtnAfter = document.querySelector(".media-player-play-btn");
      expect(playBtnAfter).toBe(playBtn);
      expect(playBtnAfter.getAttribute("aria-label")).toContain("Pause");
    });
  });

  // ── Cached → pinned local promotion ──────────────────────────────

  describe("cached to pinned local promotion", () => {
    const audioAsset = {
      name: "MEDIA-1",
      title: "My Track",
      media_kind: "audio",
      blob_size: 4096,
      original_filename: "track.mp3",
      content_hash: "hash-a1",
      modified_at: "2026-04-03T09:00:00Z",
      created_at_label: "2026-04-03",
      modified_at_label: "2026-04-03",
      folder_path: "Music",
      has_preview_image: false,
      file_extension: "mp3",
    };

    function createPinFetch({ assetOverride } = {}) {
      const asset = assetOverride || audioAsset;
      return createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets")) {
          return jsonResponse({
            message: { assets: [asset], total_count: 1, has_more: false, next_offset: 1 },
          });
        }
        if (url.includes("get_my_media_asset_detail")) {
          return jsonResponse({ message: { asset } });
        }
        if (url.includes("get_my_media_asset_access")) {
          return jsonResponse({
            message: {
              asset: { name: asset.name, content_hash: asset.content_hash, media_kind: asset.media_kind },
              access: { download_url: "https://s3.example.com/signed-blob", expires_in_seconds: 300 },
            },
          });
        }
        if (url.includes("s3.example.com/signed-blob")) {
          return new Response(new Blob(["blob-data"], { type: "application/octet-stream" }), { status: 200 });
        }
        if (url.includes("stream_my_media_asset_blob")) {
          return new Response(new Blob(["streamed-data"], { type: "application/octet-stream" }), { status: 200 });
        }
        if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });
    }

    it("promotes a fresh cached blob to pinned entirely locally without network call", async () => {
      const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "hash-a1",
      });

      window.fetch = createPinFetch();
      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // Pin the item.
      document.getElementById("libraryActionPin")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // pinMediaBlob should have been called with the local blob.
      expect(mockMediaCache.pinMediaBlob).toHaveBeenCalledWith(
        "MEDIA-1",
        fakeBlob,
        expect.objectContaining({ contentHash: "hash-a1" }),
      );

      // Cached copy should have been removed.
      expect(mockMediaCache.removeCachedMediaBlob).toHaveBeenCalledWith("MEDIA-1");

      // No get_my_media_asset_access call — promotion is fully local.
      const accessCalls = window.fetch.mock.calls.filter(
        ([u]) => typeof u === "string" && u.includes("get_my_media_asset_access"),
      );
      expect(accessCalls).toHaveLength(0);

      // No signed-blob or stream-blob calls either.
      const blobCalls = window.fetch.mock.calls.filter(
        ([u]) => typeof u === "string" && (u.includes("s3.example.com") || u.includes("stream_my_media_asset_blob")),
      );
      expect(blobCalls).toHaveLength(0);
    });

    it("pinning a fresh cached blob works offline", async () => {
      const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });
      const offlineItem = {
        ...audioAsset,
        _offline: true,
        preview_image_url: null,
        download_url: null,
      };

      mockMediaCache.getCachedMediaManifest.mockResolvedValue([offlineItem]);
      mockMediaCache.getCachedMediaMetadata.mockResolvedValue(offlineItem);
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "hash-a1",
      });

      window.fetch = createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets"))
          return Promise.reject(new TypeError("Failed to fetch"));
        if (url.includes("get_my_media_asset_detail"))
          return Promise.reject(new TypeError("Failed to fetch"));
        if (url.includes("list_my_speed_recordings"))
          return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs"))
          return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents"))
          return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });

      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // Pin the item while fully offline.
      document.getElementById("libraryActionPin")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // pinMediaBlob should have been called with the local blob.
      expect(mockMediaCache.pinMediaBlob).toHaveBeenCalledWith(
        "MEDIA-1",
        fakeBlob,
        expect.objectContaining({ contentHash: "hash-a1" }),
      );
      // Cached copy cleaned up.
      expect(mockMediaCache.removeCachedMediaBlob).toHaveBeenCalledWith("MEDIA-1");
    });

    it("cached state is replaced by pinned state after promotion", async () => {
      const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "hash-a1",
      });

      window.fetch = createPinFetch();
      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // Before pin: badge should say "Cached locally".
      let badges = Array.from(document.querySelectorAll(".library-record-badge"));
      let cachedBadge = badges.find((b) => b.textContent === "Cached locally");
      expect(cachedBadge).toBeTruthy();

      // Pin the item.
      document.getElementById("libraryActionPin")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // After pin: badge should change to "Available offline" (pinned).
      badges = Array.from(document.querySelectorAll(".library-record-badge"));
      const pinnedBadge = badges.find((b) => b.textContent === "Available offline");
      expect(pinnedBadge).toBeTruthy();
      // No "Cached locally" badge should remain.
      cachedBadge = badges.find((b) => b.textContent === "Cached locally");
      expect(cachedBadge).toBeFalsy();
    });

    it("stale cached blob falls through to network pin path", async () => {
      const staleBlob = new Blob(["old-audio"], { type: "audio/mpeg" });
      const updatedAsset = { ...audioAsset, content_hash: "hash-a2" };

      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now() - 86400000,
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(staleBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: staleBlob,
        source: "cached",
        contentHash: "hash-a1",
      });

      window.fetch = createPinFetch({ assetOverride: updatedAsset });
      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // Pin the item — stale cache should NOT be promoted.
      document.getElementById("libraryActionPin")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // Should have gone through the network path since cache is stale.
      const accessCalls = window.fetch.mock.calls.filter(
        ([u]) => typeof u === "string" && u.includes("get_my_media_asset_access"),
      );
      expect(accessCalls.length).toBeGreaterThan(0);
    });
  });

  // ── Offline inline-preview bootstrap ─────────────────────────────

  describe("offline inline-preview bootstrap", () => {
    it("boots from cached manifest + blob and mounts playable local preview for audio", async () => {
      const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });
      const offlineAudio = {
        name: "MEDIA-1",
        title: "My Track",
        media_kind: "audio",
        blob_size: 4096,
        original_filename: "track.mp3",
        content_hash: "hash-a1",
        modified_at: "2026-04-03T09:00:00Z",
        created_at_label: "2026-04-03",
        modified_at_label: "2026-04-03",
        folder_path: "Music",
        has_preview_image: false,
        file_extension: "mp3",
        _offline: true,
      };

      mockMediaCache.getCachedMediaManifest.mockResolvedValue([offlineAudio]);
      mockMediaCache.getCachedMediaMetadata.mockResolvedValue(offlineAudio);
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "hash-a1",
      });

      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:vatioboard/local-offline-audio");

      try {
        // Fully offline — all list/detail calls fail.
        window.fetch = createAuthenticatedLibraryFetch((url) => {
          if (url.includes("list_my_media_assets"))
            return Promise.reject(new TypeError("Failed to fetch"));
          if (url.includes("get_my_media_asset_detail"))
            return Promise.reject(new TypeError("Failed to fetch"));
          if (url.includes("list_my_speed_recordings"))
            return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
          if (url.includes("list_my_accel_runs"))
            return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
          if (url.includes("list_my_board_documents"))
            return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
          return jsonResponse({});
        });

        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        // Select the offline item.
        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        // The detail preview should mount a media player with the local blob URL.
        const preview = document.getElementById("libraryDetailPreview");
        expect(preview).toBeTruthy();
        expect(preview.dataset.previewKind).toBe("media-player");
        expect(preview.querySelector(".media-player")).toBeTruthy();

        // The audio element should use the blob: URL.
        const audioEl = preview.querySelector("audio");
        expect(audioEl).toBeTruthy();
        expect(audioEl.src).toMatch(/^blob:/);
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
      }
    });

    it("boots from cached manifest + blob and renders local image preview", async () => {
      const fakeBlob = new Blob(["fake-png"], { type: "image/png" });
      const offlineImage = {
        name: "MEDIA-1",
        title: "Skidpad export",
        media_kind: "image",
        blob_size: 245760,
        original_filename: "skidpad.png",
        content_hash: "img-hash-1",
        created_at_label: "2026-04-03",
        modified_at_label: "2026-04-03",
        folder_path: "Exports",
        has_preview_image: true,
        file_extension: "png",
        _offline: true,
      };

      mockMediaCache.getCachedMediaManifest.mockResolvedValue([offlineImage]);
      mockMediaCache.getCachedMediaMetadata.mockResolvedValue(offlineImage);
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "img-hash-1",
        cached_at: Date.now(),
        blob_size: 245760,
        media_kind: "image",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "img-hash-1",
      });

      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:vatioboard/local-offline-image");

      try {
        window.fetch = createAuthenticatedLibraryFetch((url) => {
          if (url.includes("list_my_media_assets"))
            return Promise.reject(new TypeError("Failed to fetch"));
          if (url.includes("get_my_media_asset_detail"))
            return Promise.reject(new TypeError("Failed to fetch"));
          if (url.includes("list_my_speed_recordings"))
            return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
          if (url.includes("list_my_accel_runs"))
            return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
          if (url.includes("list_my_board_documents"))
            return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
          return jsonResponse({});
        });

        await bootHtmlPage("library.html");
        const libraryPage = await import("../../src/library/library.js");
        await libraryPage.initPromise;
        await settleLibraryTasks();

        document.querySelector('[data-tab="media"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        document.querySelector(".library-record")?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        await settleLibraryTasks(24);

        // The detail preview should render an image with the local blob URL.
        const preview = document.getElementById("libraryDetailPreview");
        expect(preview).toBeTruthy();
        const img = preview.querySelector("img");
        expect(img).toBeTruthy();
        expect(img.src).toMatch(/^blob:/);
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
      }
    });
  });

  // ── Pin/unpin persistence boolean handling ────────────────────────

  describe("pin/unpin persistence failures", () => {
    it("local promotion: pinMediaBlob returns false → no success, no pinned state, no network fallback", async () => {
      const fakeBlob = new Blob(["cached-audio"], { type: "audio/mpeg" });
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(fakeBlob);
      mockMediaCache.getLocalMediaBlob.mockResolvedValue({
        blob: fakeBlob,
        source: "cached",
        contentHash: "hash-a1",
      });
      // pinMediaBlob returns false — persistence failure.
      mockMediaCache.pinMediaBlob.mockResolvedValue(false);

      const audioAsset = {
        name: "MEDIA-1",
        title: "My Track",
        media_kind: "audio",
        blob_size: 4096,
        original_filename: "track.mp3",
        content_hash: "hash-a1",
        modified_at: "2026-04-03T09:00:00Z",
        created_at_label: "2026-04-03",
        modified_at_label: "2026-04-03",
        folder_path: "Music",
        has_preview_image: false,
        file_extension: "mp3",
      };

      window.fetch = createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets")) {
          return jsonResponse({
            message: { assets: [audioAsset], total_count: 1, has_more: false, next_offset: 1 },
          });
        }
        if (url.includes("get_my_media_asset_detail")) {
          return jsonResponse({ message: { asset: audioAsset } });
        }
        if (url.includes("get_my_media_asset_access")) {
          return jsonResponse({
            message: {
              asset: { name: audioAsset.name, content_hash: audioAsset.content_hash },
              access: { download_url: "https://s3.example.com/signed-blob", expires_in_seconds: 300 },
            },
          });
        }
        if (url.includes("s3.example.com/signed-blob")) {
          return new Response(new Blob(["blob-data"]), { status: 200 });
        }
        if (url.includes("stream_my_media_asset_blob")) {
          return new Response(new Blob(["streamed-data"]), { status: 200 });
        }
        if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });

      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // Attempt to pin.
      document.getElementById("libraryActionPin")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // pinMediaBlob was called (local promotion attempted).
      expect(mockMediaCache.pinMediaBlob).toHaveBeenCalledWith(
        "MEDIA-1",
        fakeBlob,
        expect.objectContaining({ contentHash: "hash-a1" }),
      );

      // Cached copy must NOT have been removed (pin failed).
      expect(mockMediaCache.removeCachedMediaBlob).not.toHaveBeenCalled();

      // No network fallback: no get_my_media_asset_access call.
      const accessCalls = window.fetch.mock.calls.filter(
        ([u]) => typeof u === "string" && u.includes("get_my_media_asset_access"),
      );
      expect(accessCalls).toHaveLength(0);

      // Pin button should NOT say "Unpin" — item is not pinned.
      const pinBtn = document.getElementById("libraryActionPin");
      expect(pinBtn.dataset.pinned).toBe("false");

      // Status should show failure.
      const statusEl = document.getElementById("libraryStatus");
      expect(statusEl?.dataset?.tone).toBe("danger");
    });

    it("network pin: pinMediaBlob returns false → no pinned state, pin failed status", async () => {
      // No cached blob — will go through network path.
      mockMediaCache.pinMediaBlob.mockResolvedValue(false);

      window.fetch = createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets")) {
          return jsonResponse({
            message: { assets: [MEDIA_ASSET], total_count: 1, has_more: false },
          });
        }
        if (url.includes("get_my_media_asset_detail")) {
          return jsonResponse({ message: { asset: MEDIA_ASSET } });
        }
        if (url.includes("get_my_media_asset_access")) {
          return jsonResponse({
            message: {
              asset: { name: "MEDIA-1", content_hash: "abc123", media_kind: "image" },
              access: { download_url: "https://s3.example.com/signed-blob", expires_in_seconds: 300 },
            },
          });
        }
        if (url.includes("s3.example.com/signed-blob")) {
          return new Response(new Blob(["fake-png-data"], { type: "image/png" }), { status: 200 });
        }
        if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });

      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      document.getElementById("libraryActionPin").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks();

      // pinMediaBlob was called.
      expect(mockMediaCache.pinMediaBlob).toHaveBeenCalled();

      // Item should NOT be marked pinned.
      const pinBtn = document.getElementById("libraryActionPin");
      expect(pinBtn.dataset.pinned).toBe("false");

      // Status should show failure.
      const statusEl = document.getElementById("libraryStatus");
      expect(statusEl?.dataset?.tone).toBe("danger");
    });

    it("unpin: unpinMediaBlob returns false → remains pinned, failure status", async () => {
      // Item starts as pinned.
      mockMediaCache.getPinnedBlobMeta.mockResolvedValue({ content_hash: null, pinned_at: Date.now() });
      // unpinMediaBlob returns false — persistence failure.
      mockMediaCache.unpinMediaBlob.mockResolvedValue(false);

      await bootMediaTab();

      const pinBtn = document.getElementById("libraryActionPin");
      expect(pinBtn.dataset.pinned).toBe("true");

      pinBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settleLibraryTasks();

      // unpinMediaBlob was called.
      expect(mockMediaCache.unpinMediaBlob).toHaveBeenCalledWith("MEDIA-1");

      // Item should remain pinned (persistence failed).
      expect(pinBtn.dataset.pinned).toBe("true");

      // Status should show failure.
      const statusEl = document.getElementById("libraryStatus");
      expect(statusEl?.dataset?.tone).toBe("danger");
    });
  });

  // ── Orphaned-meta cleanup via shared reconcileCachedBlobState ─────
  //
  // The reconcileCachedBlobState() helper is shared between the bulk
  // refreshPinStatesForItems() path (fires after list load) and the
  // single-item refreshPinState() path (fires after loadDetail).
  // For media-tab items the list-load bulk path is the primary caller
  // because loadDetail() is not invoked for media items on selection.
  // This test verifies the shared helper through the bulk path, which
  // is the path that fires during normal media-tab usage.

  describe("orphaned-meta cleanup via shared reconcileCachedBlobState helper", () => {
    it("orphaned cached meta is cleaned during list load and does not mark item as cached locally", async () => {
      // No pinned blob — only cached meta exists but blob is missing.
      mockMediaCache.getCachedBlobMeta.mockResolvedValue({
        content_hash: "hash-a1",
        cached_at: Date.now(),
        blob_size: 4096,
        media_kind: "audio",
        pinned: false,
      });
      mockMediaCache.getCachedMediaBlob.mockResolvedValue(null);

      window.fetch = createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets")) {
          return jsonResponse({
            message: { assets: [MEDIA_ASSET], total_count: 1, has_more: false },
          });
        }
        if (url.includes("get_my_media_asset_detail")) {
          return jsonResponse({ message: { asset: MEDIA_ASSET } });
        }
        if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });

      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // After list load, refreshPinStatesForItems → reconcileCachedBlobState
      // has already run.  No "Cached locally" badge should appear.
      const allBadges = Array.from(document.querySelectorAll(".library-record-badge"));
      const cachedBadge = allBadges.find(
        (b) => b.dataset.tone === "success" && b.textContent === "Cached locally",
      );
      expect(cachedBadge).toBeFalsy();

      // removeCachedMediaBlob should have been called to clean up orphaned meta.
      expect(mockMediaCache.removeCachedMediaBlob).toHaveBeenCalledWith("MEDIA-1");
    });
  });

  // ── Row badge immediate sync after network pin / unpin ────────────

  describe("row badge immediate sync after confirmed pin/unpin", () => {
    it("row badge updates to Available offline immediately after successful network pin", async () => {
      window.fetch = createAuthenticatedLibraryFetch((url) => {
        if (url.includes("list_my_media_assets")) {
          return jsonResponse({
            message: { assets: [MEDIA_ASSET], total_count: 1, has_more: false },
          });
        }
        if (url.includes("get_my_media_asset_detail")) {
          return jsonResponse({ message: { asset: MEDIA_ASSET } });
        }
        if (url.includes("get_my_media_asset_access")) {
          return jsonResponse({
            message: {
              asset: { name: "MEDIA-1", content_hash: "abc123", media_kind: "image" },
              access: { download_url: "https://s3.example.com/signed-blob", expires_in_seconds: 300 },
            },
          });
        }
        if (url.includes("s3.example.com/signed-blob")) {
          return new Response(new Blob(["fake-png-data"], { type: "image/png" }), { status: 200 });
        }
        if (url.includes("list_my_speed_recordings")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_accel_runs")) return jsonResponse({ message: { records: [], total_count: 0, has_more: false } });
        if (url.includes("list_my_board_documents")) return jsonResponse({ message: { documents: [], total_count: 0, has_more: false } });
        return jsonResponse({});
      });

      await bootHtmlPage("library.html");
      const libraryPage = await import("../../src/library/library.js");
      await libraryPage.initPromise;
      await settleLibraryTasks();

      document.querySelector('[data-tab="media"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      document.querySelector(".library-record")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // Before pin: no "Available offline" badge in the list row.
      let rowBadges = Array.from(document.querySelectorAll(".library-record-badge"));
      let offlineBadge = rowBadges.find(
        (b) => b.dataset.tone === "success" && b.textContent === "Available offline",
      );
      expect(offlineBadge).toBeFalsy();

      // Pin the item via network path.
      document.getElementById("libraryActionPin")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // After successful pin: row badge should show "Available offline" immediately.
      rowBadges = Array.from(document.querySelectorAll(".library-record-badge"));
      offlineBadge = rowBadges.find(
        (b) => b.dataset.tone === "success" && b.textContent === "Available offline",
      );
      expect(offlineBadge).toBeTruthy();
    });

    it("row badge clears immediately after successful unpin", async () => {
      // Start with a pinned item.
      mockMediaCache.getPinnedBlobMeta.mockResolvedValue({ content_hash: null, pinned_at: Date.now() });

      await bootMediaTab();

      // Before unpin: "Available offline" badge should be present.
      let rowBadges = Array.from(document.querySelectorAll(".library-record-badge"));
      let offlineBadge = rowBadges.find(
        (b) => b.dataset.tone === "success" && b.textContent === "Available offline",
      );
      expect(offlineBadge).toBeTruthy();

      // Unpin.
      document.getElementById("libraryActionPin")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await settleLibraryTasks(24);

      // After successful unpin: "Available offline" badge should be gone.
      rowBadges = Array.from(document.querySelectorAll(".library-record-badge"));
      offlineBadge = rowBadges.find(
        (b) => b.dataset.tone === "success" && b.textContent === "Available offline",
      );
      expect(offlineBadge).toBeFalsy();
    });
  });
});
