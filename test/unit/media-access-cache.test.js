import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  getCachedMediaAccess,
  setCachedMediaAccess,
  clearMediaAccessCache,
} from "../../src/shared/media-access-cache.js";

describe("media-access-cache", () => {
  beforeEach(() => {
    clearMediaAccessCache();
  });

  it("returns null for unknown asset", () => {
    expect(getCachedMediaAccess("unknown", "hash1")).toBeNull();
  });

  it("returns cached access within expiry window", () => {
    const access = { download_url: "https://s3/signed", playback_url: "https://s3/play" };
    setCachedMediaAccess("asset-1", "abc123", access, 300);

    const result = getCachedMediaAccess("asset-1", "abc123");
    expect(result).toEqual(access);
  });

  it("returns null after expiry (with safety margin)", () => {
    const access = { download_url: "https://s3/signed" };
    setCachedMediaAccess("asset-2", "hash2", access, 300);

    // Fast-forward past expiry minus safety margin
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 300 * 1000);

    expect(getCachedMediaAccess("asset-2", "hash2")).toBeNull();

    vi.restoreAllMocks();
  });

  it("returns access before safety margin boundary", () => {
    const access = { download_url: "https://s3/signed" };
    setCachedMediaAccess("asset-3", "hash3", access, 300);

    const now = Date.now();
    // 200 seconds later — well within the 300s expiry minus 30s margin
    vi.spyOn(Date, "now").mockReturnValue(now + 200 * 1000);

    expect(getCachedMediaAccess("asset-3", "hash3")).toEqual(access);

    vi.restoreAllMocks();
  });

  it("clears specific asset (all content hashes)", () => {
    setCachedMediaAccess("a", "h1", { download_url: "u1" }, 300);
    setCachedMediaAccess("a", "h2", { download_url: "u1b" }, 300);
    setCachedMediaAccess("b", "h3", { download_url: "u2" }, 300);

    clearMediaAccessCache("a");

    expect(getCachedMediaAccess("a", "h1")).toBeNull();
    expect(getCachedMediaAccess("a", "h2")).toBeNull();
    expect(getCachedMediaAccess("b", "h3")).not.toBeNull();
  });

  it("clears all assets when called without argument", () => {
    setCachedMediaAccess("x", "hx", { download_url: "u1" }, 300);
    setCachedMediaAccess("y", "hy", { download_url: "u2" }, 300);

    clearMediaAccessCache();

    expect(getCachedMediaAccess("x", "hx")).toBeNull();
    expect(getCachedMediaAccess("y", "hy")).toBeNull();
  });

  it("overwrites previous entry for same asset and hash", () => {
    setCachedMediaAccess("z", "hz", { download_url: "old" }, 300);
    setCachedMediaAccess("z", "hz", { download_url: "new" }, 300);

    expect(getCachedMediaAccess("z", "hz")).toEqual({ download_url: "new" });
  });

  it("isolates entries with different content hashes", () => {
    setCachedMediaAccess("a", "hash-old", { download_url: "old" }, 300);
    setCachedMediaAccess("a", "hash-new", { download_url: "new" }, 300);

    expect(getCachedMediaAccess("a", "hash-old")).toEqual({ download_url: "old" });
    expect(getCachedMediaAccess("a", "hash-new")).toEqual({ download_url: "new" });
  });

  it("falls back to name-only key when contentHash is falsy", () => {
    setCachedMediaAccess("fallback", null, { download_url: "u1" }, 300);

    expect(getCachedMediaAccess("fallback", null)).toEqual({ download_url: "u1" });
    expect(getCachedMediaAccess("fallback", undefined)).toEqual({ download_url: "u1" });
  });
});
