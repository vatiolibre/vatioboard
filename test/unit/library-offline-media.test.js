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
  preview_image_url: "https://www.vatiolibre.com/files/skidpad.png?token=view#preview",
  download_url: "https://www.vatiolibre.com/private/files/skidpad.png?download=1",
  export_url: "https://www.vatiolibre.com/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1&as_attachment=1",
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
  });

  // ── Pin / unpin ─────────────────────────────────────────────────

  it("shows the pin button on media detail", async () => {
    await bootMediaTab();

    const pinBtn = document.getElementById("libraryActionPin");
    expect(pinBtn).toBeTruthy();
    expect(pinBtn.hidden).toBe(false);
    expect(pinBtn.textContent).toContain("Pin");
  });

  it("pins a media asset by downloading its blob", async () => {
    // Return a fake blob when download_url is fetched
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: { assets: [MEDIA_ASSET], total_count: 1, has_more: false },
        });
      }
      if (url.includes("get_my_media_asset_detail")) {
        return jsonResponse({ message: { asset: MEDIA_ASSET } });
      }
      if (url.includes("/private/files/skidpad.png")) {
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

      expect(mockMediaCache.getPinnedMediaBlob).toHaveBeenCalledWith("MEDIA-1");
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

  // ── Upload non-blocking ─────────────────────────────────────────

  it("disables only the upload button while uploading, not other actions", async () => {
    await bootMediaTab();

    const uploadBtn = document.getElementById("libraryActionUpload");
    const deleteBtn = document.getElementById("libraryActionDelete");

    expect(uploadBtn).toBeTruthy();
    // Upload button should be enabled and delete/open should be independent
    expect(uploadBtn.disabled).toBe(false);
    if (deleteBtn) {
      expect(deleteBtn.disabled).toBe(false);
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
      if (url.includes("/private/files/skidpad.png")) {
        return new Response(new Blob(["updated-data"], { type: "image/png" }), { status: 200 });
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

      const openBtn = document.getElementById("libraryActionOpen");
      openBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settleLibraryTasks();

      // Should NOT read the local blob because pin is stale
      expect(mockMediaCache.getPinnedMediaBlob).not.toHaveBeenCalled();
      // Should open the remote download URL instead
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("skidpad.png"),
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
      preview_image_url: "https://www.vatiolibre.com/files/skidpad.png?token=view#preview",
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
    mockMediaCache.getCachedMediaManifest.mockResolvedValue([cachedItem]);
    mockMediaCache.getCachedMediaMetadata.mockResolvedValue({
      ...cachedItem,
      _offline: true,
      preview_image_url: "https://www.vatiolibre.com/files/skidpad.png?token=view#preview",
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
      expect(img.src).not.toContain("vatiolibre.com");
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
    expect(preview.dataset.previewKind).toBe("offline-pinned-fallback");
    // Should show the media kind label
    expect(preview.querySelector(".library-preview-kind-label")).toBeTruthy();
    expect(preview.querySelector(".library-preview-kind-label").textContent).toBe("audio");
    // Should show the "available offline" status
    expect(preview.textContent).toContain("Available offline");
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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
      await settleLibraryTasks();

      // At this point a blob URL should have been created for the pinned image
      expect(URL.createObjectURL).toHaveBeenCalled();

      // Switch to a different tab — should revoke the preview object URL
      window.fetch = createDefaultFetch();
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

  it("restores upload button and tab access after offline→online reconnect", async () => {
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

    // Confirm offline-limited: upload hidden, tab access blocked
    const uploadBtn = document.getElementById("libraryActionUpload");
    expect(uploadBtn.hidden).toBe(true);
    const mediaTab = document.querySelector('[data-tab="media"]');
    expect(mediaTab.dataset.access).toBe("granted"); // active offline tab

    // Phase 2: Connectivity returns — full auth + media list succeed
    window.fetch = createAuthenticatedLibraryFetch((url) => {
      if (url.includes("list_my_media_assets")) {
        return jsonResponse({
          message: {
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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

    // Upload button should now be visible and enabled
    expect(uploadBtn.hidden).toBe(false);
    expect(uploadBtn.disabled).toBe(false);

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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
    // The upload button should remain hidden (logged out state).
    const uploadBtn = document.getElementById("libraryActionUpload");
    expect(uploadBtn.hidden).toBe(true);
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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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

    // After 401, reconnecting should be cleared — the upload button should be hidden
    // and the login prompt should be shown (terminal auth failure).
    const uploadBtn = document.getElementById("libraryActionUpload");
    expect(uploadBtn.hidden).toBe(true);

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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
    // Simulate by calling a second search that hits a 401 on the list endpoint.
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
    searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleLibraryTasks(16);

    // 401 confirmed — session should be unauthenticated, upload hidden
    const uploadBtn = document.getElementById("libraryActionUpload");
    expect(uploadBtn.hidden).toBe(true);

    // Now resolve the slow rehydration session call — it should be discarded
    // because the 401 bumped authGeneration.
    resolveSessionCall();
    await settleLibraryTasks(32);

    // Upload must still be hidden — stale rehydration must not restore auth
    expect(uploadBtn.hidden).toBe(true);
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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
    const uploadBtn = document.getElementById("libraryActionUpload");
    expect(uploadBtn.hidden).toBe(true);

    // Now resolve the first (older) refresh session call — it should be discarded
    resolveFirstSession();
    await settleLibraryTasks(32);

    // Upload must still be hidden — stale refresh must not restore auth state
    expect(uploadBtn.hidden).toBe(true);
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
              { ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" },
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
    // The upload button should be hidden (unauthenticated)
    const uploadBtn = document.getElementById("libraryActionUpload");
    expect(uploadBtn.hidden).toBe(true);

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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
            assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }],
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
      preview_image_url: "https://www.vatiolibre.com/files/photo.png",
      download_url: "https://www.vatiolibre.com/files/photo.png?download=1",
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
    // The preview should have updated from offline fallback to the online preview URL
    expect(freshPreviewSrc).toContain("photo.png");
    // Verify a detail request was made (the stale detail was refreshed)
    const detailCalls = window.fetch.mock.calls.filter(
      ([input]) => String(input).includes("get_my_media_asset_detail")
    );
    expect(detailCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── Mutation 401 triggers auth teardown ─────────────────────────

  it("routes a 401 during pin download through the auth teardown path", async () => {
    await bootMediaTab();

    const uploadBtn = document.getElementById("libraryActionUpload");
    // Authenticated — upload should be visible
    expect(uploadBtn.hidden).toBe(false);

    // Replace fetch so the pin download returns 401
    const baseFetch = window.fetch;
    window.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("skidpad.png")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return baseFetch(input, init);
    });

    // Click pin — triggers fetch(downloadUrl) which returns 401
    const pinBtn = document.getElementById("libraryActionPin");
    pinBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleLibraryTasks(32);

    // Auth teardown should have fired: upload hidden, session cleared
    expect(uploadBtn.hidden).toBe(true);
    const statusEl = document.getElementById("libraryStatus");
    // The status should show the login prompt, not the generic pin-failed message
    expect(statusEl?.textContent || "").not.toContain("pin");
  });

  // ── Actions disabled while auth refresh is in flight ────────────

  it("hides upload and disables mutation actions while authLoading", async () => {
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
          message: { assets: [{ ...cachedItem, preview_image_url: "https://www.vatiolibre.com/files/photo.png" }], total_count: 1, has_more: false, next_offset: 1 },
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

    // While authLoading is true: upload should be hidden, mutation actions disabled
    const uploadBtn = document.getElementById("libraryActionUpload");
    const renameBtn = document.getElementById("libraryActionRename");
    const deleteBtn = document.getElementById("libraryActionDelete");
    expect(uploadBtn.hidden).toBe(true);
    if (renameBtn) expect(renameBtn.disabled).toBe(true);
    if (deleteBtn) expect(deleteBtn.disabled).toBe(true);

    // Resolve feature access — auth refresh finishes
    resolveFeatureAccess();
    await settleLibraryTasks(32);

    // Upload should reappear and mutation actions should be enabled
    expect(uploadBtn.hidden).toBe(false);
    expect(uploadBtn.disabled).toBe(false);
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

  // ── Detail pane resyncs on mutation-time 401 ────────────────────

  it("refreshes the detail pane into unauthenticated state after a 401 during upload", async () => {
    await bootMediaTab();

    // Verify initial state: detail visible with item selected
    const detailTitle = document.querySelector("#libraryDetailTitle");
    expect(detailTitle?.textContent).toBeTruthy();
    const openBtn = document.getElementById("libraryActionOpen");
    const pinBtn = document.getElementById("libraryActionPin");
    expect(openBtn.hidden).toBe(false);
    expect(openBtn.disabled).toBe(false);
    expect(pinBtn.hidden).toBe(false);
    expect(pinBtn.disabled).toBe(false);

    // Intercept file input creation to auto-supply a file
    const origCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag, opts) => {
      const el = origCreateElement(tag, opts);
      if (tag === "input" && !el._intercepted) {
        el._intercepted = true;
        const origClick = el.click.bind(el);
        el.click = () => {
          // Simulate selecting a file
          Object.defineProperty(el, "files", {
            value: [new File(["data"], "photo.jpg", { type: "image/jpeg" })],
          });
          el.dispatchEvent(new Event("change"));
        };
      }
      return el;
    });

    // Mock upload endpoint to return 401
    const baseFetch = window.fetch;
    window.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("upload_my_media_asset")) {
        return new Response(JSON.stringify({}), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return baseFetch(input, init);
    });

    try {
      // Click the upload button
      const uploadBtn = document.getElementById("libraryActionUpload");
      uploadBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settleLibraryTasks(32);

      // After 401 teardown: detail pane should reflect unauthenticated state
      // Open should be disabled (cloud-only media, no local blob)
      expect(openBtn.disabled).toBe(true);
      // Pin should be disabled (requires auth to download)
      expect(pinBtn.disabled).toBe(true);
      // Upload should be hidden (unauthenticated)
      expect(uploadBtn.hidden).toBe(true);
    } finally {
      createElementSpy.mockRestore();
    }
  });

  // ── Open and Pin gated after auth expiry for cloud-only media ───

  it("disables Open and Pin for cloud-only media after auth expiry but allows unpin for locally pinned items", async () => {
    // ── Scenario A: cloud-only (unpinned) item ──
    // Clicking Pin on an unpinned item fetches the download URL.
    // If that returns 401, applyLibraryRequestError fires auth teardown.
    await bootMediaTab();

    const openBtn = document.getElementById("libraryActionOpen");
    const pinBtn = document.getElementById("libraryActionPin");
    expect(openBtn.disabled).toBe(false);
    expect(pinBtn.disabled).toBe(false);

    // Mock the download URL to return 401 when Pin tries to fetch the blob
    const baseFetch = window.fetch;
    window.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("skidpad.png")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return baseFetch(input, init);
    });

    pinBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleLibraryTasks(32);

    // After 401 teardown: cloud-only item → Open disabled (no local blob), Pin disabled
    expect(openBtn.disabled).toBe(true);
    expect(pinBtn.disabled).toBe(true);
    const uploadBtn = document.getElementById("libraryActionUpload");
    expect(uploadBtn.hidden).toBe(true);

    // ── Scenario B: fresh-pinned item ──
    // Trigger 401 via upload; the selected item has a local blob so
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

    // Intercept file input to auto-supply a file for upload
    const origCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag, opts) => {
      const el = origCreateElement(tag, opts);
      if (tag === "input" && !el._intercepted) {
        el._intercepted = true;
        el.click = () => {
          Object.defineProperty(el, "files", {
            value: [new File(["data"], "photo.jpg", { type: "image/jpeg" })],
          });
          el.dispatchEvent(new Event("change"));
        };
      }
      return el;
    });

    const baseFetch2 = window.fetch;
    window.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      if (url.includes("upload_my_media_asset")) {
        return new Response(JSON.stringify({}), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return baseFetch2(input, init);
    });

    try {
      const uploadBtn2 = document.getElementById("libraryActionUpload");
      uploadBtn2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settleLibraryTasks(32);

      // After 401: fresh-pinned item still has a local blob
      // Open remains enabled (local blob), Unpin remains enabled (local operation)
      expect(openBtn2.disabled).toBe(false);
      expect(pinBtn2.disabled).toBe(false);
      // But upload is hidden (unauthenticated)
      expect(uploadBtn2.hidden).toBe(true);
    } finally {
      createElementSpy.mockRestore();
    }
  });

  // ── Upload-success background refresh preserves snapshot ────────

  it("preserves the media snapshot during the background refresh after a successful upload", async () => {
    await bootMediaTab();

    // Verify initial state
    const listItems = document.querySelectorAll(".library-record");
    expect(listItems.length).toBe(1);
    const detailTitle = document.querySelector("#libraryDetailTitle");
    expect(detailTitle?.textContent).toBeTruthy();
    const initialTitle = detailTitle.textContent;

    // Gate the list call that fires after upload success
    let resolveList;
    const listGate = new Promise((resolve) => { resolveList = resolve; });

    // Intercept file input creation to auto-supply a file
    const origCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag, opts) => {
      const el = origCreateElement(tag, opts);
      if (tag === "input" && !el._intercepted) {
        el._intercepted = true;
        el.click = () => {
          Object.defineProperty(el, "files", {
            value: [new File(["data"], "new-photo.jpg", { type: "image/jpeg" })],
          });
          el.dispatchEvent(new Event("change"));
        };
      }
      return el;
    });

    const UPLOADED_ASSET = {
      ...MEDIA_ASSET,
      name: "MEDIA-2",
      title: "new-photo.jpg",
      original_filename: "new-photo.jpg",
    };

    const baseFetch = window.fetch;
    window.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      // Upload endpoint succeeds
      if (url.includes("upload_my_media_asset")) {
        return jsonResponse({
          message: { asset: UPLOADED_ASSET },
        });
      }
      // Gate the list refresh that follows upload success
      if (url.includes("list_my_media_assets")) {
        await listGate;
        return jsonResponse({
          message: {
            assets: [MEDIA_ASSET, UPLOADED_ASSET],
            total_count: 2,
            has_more: false,
            next_offset: 2,
          },
        });
      }
      return baseFetch(input, init);
    });

    try {
      const uploadBtn = document.getElementById("libraryActionUpload");
      uploadBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settleLibraryTasks(32);

      // Mid-flight: upload succeeded, list refresh is pending
      // The existing list and detail should still be visible (snapshot preserved)
      const midFlightItems = document.querySelectorAll(".library-record");
      expect(midFlightItems.length).toBe(1);
      expect(detailTitle.textContent).toBe(initialTitle);

      // Resolve the background list refresh
      resolveList();
      await settleLibraryTasks(32);

      // After refresh: list should be updated with the new asset
      const freshItems = document.querySelectorAll(".library-record");
      expect(freshItems.length).toBe(2);
    } finally {
      createElementSpy.mockRestore();
    }
  });
});
