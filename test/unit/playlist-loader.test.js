import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────

const mockCache = vi.hoisted(() => ({
  getCachedPlaylistsManifestSnapshot: vi.fn().mockResolvedValue(null),
  cachePlaylistsManifestSnapshot: vi.fn().mockResolvedValue(true),
  getCachedPlaylistDetail: vi.fn().mockResolvedValue(null),
  cachePlaylistDetail: vi.fn().mockResolvedValue(true),
  getCachedPlaylistsList: vi.fn().mockResolvedValue(null),
  getCachedPlaylistsToken: vi.fn().mockResolvedValue(null),
  fanOutManifestDetails: vi.fn().mockResolvedValue(undefined),
}));

const mockBackend = vi.hoisted(() => ({
  getBackendPlaylistsManifest: vi.fn(),
  getBackendPlaylistsManifestVersion: vi.fn(),
  getBackendPlaylistDetail: vi.fn(),
  getProtectedMediaRequestGate: vi.fn(),
}));

vi.mock("../../src/shared/playlist-cache.js", () => mockCache);
vi.mock("../../src/shared/backend-auth.js", () => mockBackend);

// ── Helpers ──────────────────────────────────────────────────────────

async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function allowGate() {
  mockBackend.getProtectedMediaRequestGate.mockResolvedValue({
    allowed: true,
    cleanup: vi.fn(),
    signal: undefined,
  });
}

function blockGate() {
  mockBackend.getProtectedMediaRequestGate.mockResolvedValue({
    allowed: false,
    cleanup: vi.fn(),
    signal: undefined,
  });
}

// ── Import ───────────────────────────────────────────────────────────

import {
  loadPlaylists,
  loadPlaylistDetail,
  syncPlaylistsManifest,
} from "../../src/shared/playlist-loader.js";

// ── Tests ────────────────────────────────────────────────────────────

describe("playlist-loader", () => {
  beforeEach(() => {
    Object.values(mockCache).forEach((fn) => fn.mockReset());
    Object.values(mockBackend).forEach((fn) => fn.mockReset());
    mockCache.getCachedPlaylistsManifestSnapshot.mockResolvedValue(null);
    mockCache.cachePlaylistsManifestSnapshot.mockResolvedValue(true);
    mockCache.getCachedPlaylistDetail.mockResolvedValue(null);
    mockCache.cachePlaylistDetail.mockResolvedValue(true);
    mockCache.fanOutManifestDetails.mockResolvedValue(undefined);
    allowGate();
  });

  // ── loadPlaylists ──────────────────────────────────────────────

  describe("loadPlaylists", () => {
    it("returns cached playlists when manifest snapshot exists", async () => {
      mockCache.getCachedPlaylistsManifestSnapshot.mockResolvedValue({
        playlists: [
          { name: "pl1", title: "My Playlist" },
          { name: "pl2", title: "Chill Mix" },
        ],
        token: "tok1",
      });

      const result = await loadPlaylists();
      expect(result.playlists).toHaveLength(2);
      expect(result.total).toBe(2);
      // Should not hit backend when cache is present
      expect(mockBackend.getBackendPlaylistsManifest).not.toHaveBeenCalled();
    });

    it("fetches from backend when cache is empty", async () => {
      mockBackend.getBackendPlaylistsManifest.mockResolvedValue({
        ok: true,
        playlists: [{ name: "pl1", title: "Fetched" }],
        manifestToken: "new_tok",
        isTruncated: false,
      });

      const result = await loadPlaylists();
      expect(result.playlists).toHaveLength(1);
      expect(result.playlists[0].title).toBe("Fetched");
      expect(mockBackend.getBackendPlaylistsManifest).toHaveBeenCalledOnce();
      // Should cache the fetched manifest
      await flushMicrotasks();
      expect(mockCache.cachePlaylistsManifestSnapshot).toHaveBeenCalled();
    });

    it("does not cache token when manifest is truncated", async () => {
      mockBackend.getBackendPlaylistsManifest.mockResolvedValue({
        ok: true,
        playlists: [{ name: "pl1", title: "Fetched" }],
        manifestToken: "tok",
        isTruncated: true,
      });

      await loadPlaylists();
      await flushMicrotasks();
      const cacheCall = mockCache.cachePlaylistsManifestSnapshot.mock.calls[0]?.[0];
      expect(cacheCall?.token).toBeNull();
    });

    it("returns empty when gate is blocked", async () => {
      blockGate();
      const result = await loadPlaylists();
      expect(result.playlists).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(mockBackend.getBackendPlaylistsManifest).not.toHaveBeenCalled();
    });

    it("filters playlists by search query", async () => {
      mockCache.getCachedPlaylistsManifestSnapshot.mockResolvedValue({
        playlists: [
          { name: "pl1", title: "Road Trip Mix" },
          { name: "pl2", title: "Chill Vibes" },
          { name: "pl3", title: "Morning Road" },
        ],
        token: "tok1",
      });

      const result = await loadPlaylists({ search: "road" });
      expect(result.playlists).toHaveLength(2);
      expect(result.playlists.every((p) => p.title.toLowerCase().includes("road"))).toBe(true);
    });

    it("fans out manifest details into per-playlist cache on cold boot", async () => {
      const manifestPlaylists = [
        { name: "pl1", title: "Mix A", items: [{ media_asset_name: "a1", position: 1 }] },
        { name: "pl2", title: "Mix B", items: [{ media_asset_name: "a2", position: 1 }] },
      ];
      mockBackend.getBackendPlaylistsManifest.mockResolvedValue({
        ok: true,
        playlists: manifestPlaylists,
        manifestToken: "tok",
        isTruncated: false,
      });

      await loadPlaylists();
      await flushMicrotasks();
      expect(mockCache.fanOutManifestDetails).toHaveBeenCalledWith(manifestPlaylists);
    });

    it("returns empty playlists on network failure (offline)", async () => {
      mockBackend.getBackendPlaylistsManifest.mockRejectedValue(new Error("Network error"));

      const result = await loadPlaylists();
      expect(result.playlists).toHaveLength(0);
    });
  });

  // ── loadPlaylistDetail ─────────────────────────────────────────

  describe("loadPlaylistDetail", () => {
    it("returns cached detail when present (fan-out scenario)", async () => {
      // Simulates the offline case where detail was populated via fan-out
      mockCache.getCachedPlaylistDetail.mockResolvedValue({
        name: "pl1",
        title: "My Playlist",
        items: [
          { media_asset_name: "a1", position: 1 },
          { media_asset_name: "a2", position: 2 },
        ],
      });

      const detail = await loadPlaylistDetail("pl1");
      expect(detail.name).toBe("pl1");
      expect(detail.items).toHaveLength(2);
      expect(mockBackend.getBackendPlaylistDetail).not.toHaveBeenCalled();
    });

    it("fetches from backend when not cached", async () => {
      mockBackend.getBackendPlaylistDetail.mockResolvedValue({
        ok: true,
        playlist: {
          name: "pl1",
          title: "Backend Playlist",
          items: [{ media_asset_name: "a2", position: 1 }],
        },
      });

      const detail = await loadPlaylistDetail("pl1");
      expect(detail.name).toBe("pl1");
      expect(detail.title).toBe("Backend Playlist");
      expect(mockBackend.getBackendPlaylistDetail).toHaveBeenCalledOnce();
      // Should cache the fetched detail
      await flushMicrotasks();
      expect(mockCache.cachePlaylistDetail).toHaveBeenCalledWith("pl1", expect.objectContaining({ name: "pl1" }));
    });

    it("returns null for null/empty name", async () => {
      expect(await loadPlaylistDetail(null)).toBeNull();
      expect(await loadPlaylistDetail("")).toBeNull();
    });

    it("returns null when gate is blocked", async () => {
      blockGate();
      const detail = await loadPlaylistDetail("pl1");
      expect(detail).toBeNull();
      expect(mockBackend.getBackendPlaylistDetail).not.toHaveBeenCalled();
    });

    it("returns null on network failure", async () => {
      mockBackend.getBackendPlaylistDetail.mockRejectedValue(new Error("offline"));
      const detail = await loadPlaylistDetail("pl1");
      expect(detail).toBeNull();
    });
  });

  // ── syncPlaylistsManifest ──────────────────────────────────────

  describe("syncPlaylistsManifest", () => {
    it("returns false when cache is already fresh (tokens match)", async () => {
      mockBackend.getBackendPlaylistsManifestVersion.mockResolvedValue({
        ok: true,
        manifestToken: "tok_v1",
      });
      mockCache.getCachedPlaylistsManifestSnapshot.mockResolvedValue({
        playlists: [{ name: "pl1" }],
        token: "tok_v1",
      });

      const refreshed = await syncPlaylistsManifest();
      expect(refreshed).toBe(false);
      // Should not download full manifest
      expect(mockBackend.getBackendPlaylistsManifest).not.toHaveBeenCalled();
    });

    it("downloads full manifest when tokens differ", async () => {
      mockBackend.getBackendPlaylistsManifestVersion.mockResolvedValue({
        ok: true,
        manifestToken: "tok_v2",
      });
      mockCache.getCachedPlaylistsManifestSnapshot.mockResolvedValue({
        playlists: [{ name: "pl1" }],
        token: "tok_v1",
      });
      mockBackend.getBackendPlaylistsManifest.mockResolvedValue({
        ok: true,
        playlists: [{ name: "pl1" }, { name: "pl2" }],
        manifestToken: "tok_v2",
        isTruncated: false,
      });

      const refreshed = await syncPlaylistsManifest();
      expect(refreshed).toBe(true);
      expect(mockBackend.getBackendPlaylistsManifest).toHaveBeenCalledOnce();
      expect(mockCache.cachePlaylistsManifestSnapshot).toHaveBeenCalled();
      expect(mockCache.fanOutManifestDetails).toHaveBeenCalled();
    });

    it("fans out manifest details into per-playlist cache after sync", async () => {
      const items = [{ media_asset_name: "a1", position: 1 }];
      mockBackend.getBackendPlaylistsManifestVersion.mockResolvedValue({
        ok: true,
        manifestToken: "tok_v3",
      });
      mockCache.getCachedPlaylistsManifestSnapshot.mockResolvedValue({
        playlists: [],
        token: "tok_v2",
      });
      mockBackend.getBackendPlaylistsManifest.mockResolvedValue({
        ok: true,
        playlists: [{ name: "pl1", items }],
        manifestToken: "tok_v3",
        isTruncated: false,
      });

      await syncPlaylistsManifest();
      await flushMicrotasks();
      expect(mockCache.fanOutManifestDetails).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: "pl1", items })]),
      );
    });

    it("downloads manifest when no cached snapshot exists", async () => {
      mockBackend.getBackendPlaylistsManifestVersion.mockResolvedValue({
        ok: true,
        manifestToken: "tok_v1",
      });
      // getCachedPlaylistsManifestSnapshot default is null
      mockBackend.getBackendPlaylistsManifest.mockResolvedValue({
        ok: true,
        playlists: [{ name: "pl1" }],
        manifestToken: "tok_v1",
        isTruncated: false,
      });

      const refreshed = await syncPlaylistsManifest();
      expect(refreshed).toBe(true);
    });

    it("returns false when gate is blocked", async () => {
      blockGate();
      const refreshed = await syncPlaylistsManifest();
      expect(refreshed).toBe(false);
      expect(mockBackend.getBackendPlaylistsManifestVersion).not.toHaveBeenCalled();
      expect(mockBackend.getBackendPlaylistsManifest).not.toHaveBeenCalled();
    });

    it("returns false when version check is auth-blocked", async () => {
      mockBackend.getBackendPlaylistsManifestVersion.mockResolvedValue({
        blockedByAuth: true,
      });

      const refreshed = await syncPlaylistsManifest();
      expect(refreshed).toBe(false);
    });

    it("returns false on network error", async () => {
      mockBackend.getBackendPlaylistsManifestVersion.mockRejectedValue(new Error("offline"));

      const refreshed = await syncPlaylistsManifest();
      expect(refreshed).toBe(false);
    });
  });
});
