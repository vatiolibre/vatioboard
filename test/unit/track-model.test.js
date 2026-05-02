import { describe, expect, it } from "vitest";

import {
  normalizeTrack,
  normalizeTracks,
  titleFromFilename,
  formatDuration,
} from "../../src/shared/track-model.js";

describe("titleFromFilename", () => {
  it("strips extension and title-cases", () => {
    expect(titleFromFilename("my_cool-song.mp3")).toBe("My Cool Song");
  });

  it("returns empty for falsy input", () => {
    expect(titleFromFilename("")).toBe("");
    expect(titleFromFilename(null)).toBe("");
  });
});

describe("formatDuration", () => {
  it("formats short durations as m:ss", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(0)).toBe("0:00");
  });

  it("formats long durations as h:mm:ss", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("returns empty for invalid input", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(NaN)).toBe("");
  });
});

describe("normalizeTrack", () => {
  it("returns null for null input", () => {
    expect(normalizeTrack(null)).toBeNull();
  });

  it("normalizes a manifest asset with metadata_json", () => {
    const raw = {
      name: "abc123",
      title: "My Song",
      media_kind: "audio",
      mime_type: "audio/mpeg",
      original_filename: "my_song.mp3",
      blob_size: 5000000,
      content_hash: "sha256-abc",
      metadata_json: JSON.stringify({
        artist: "Test Artist",
        album: "Test Album",
        genre: "Rock",
        duration: 240.5,
        track_number: 3,
      }),
    };

    const track = normalizeTrack(raw);
    expect(track.name).toBe("abc123");
    expect(track.title).toBe("My Song");
    expect(track.artist).toBe("Test Artist");
    expect(track.album).toBe("Test Album");
    expect(track.duration).toBe(240.5);
    expect(track._demo).toBe(false);
  });

  it("marks demo tracks", () => {
    const track = normalizeTrack({ name: "demo:song", title: "Demo" });
    expect(track._demo).toBe(true);
    expect(track.media_kind).toBe("audio");
  });

  it("uses snapshot fields as fallback", () => {
    const track = normalizeTrack({
      name: "snap",
      snapshot_title: "Snap Title",
      snapshot_artist: "Snap Artist",
      snapshot_duration: 120,
    });
    expect(track.title).toBe("Snap Title");
    expect(track.artist).toBe("Snap Artist");
    expect(track.duration).toBe(120);
  });
});

describe("normalizeTracks", () => {
  it("filters nulls from array", () => {
    const result = normalizeTracks([{ name: "a" }, null, undefined]);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for non-array", () => {
    expect(normalizeTracks(null)).toEqual([]);
  });
});

// ── Contract governance fixtures ─────────────────────────────────────
// These tests are mirrored in both vatioboard and vatiolibre repos.
// If you edit track-model.js in one repo, copy the change to the other
// and verify these fixtures still pass in both.

const GOV_FIXTURES = {
  fullManifest: {
    name: "gov-full",
    title: "Governance Song",
    media_kind: "audio",
    mime_type: "audio/mpeg",
    original_filename: "governance_song.mp3",
    file_extension: "mp3",
    blob_size: 4200000,
    content_hash: "sha256-gov",
    folder_path: "/uploads/gov",
    metadata_json: JSON.stringify({
      artist: "Gov Artist",
      album: "Gov Album",
      genre: "Governance",
      duration: 195.7,
      track_number: 5,
    }),
  },
  minimal: { name: "gov-min" },
  demo: { name: "demo:gov-demo", title: "Demo Gov", src: "/audio/gov.mp3" },
  snapshot: {
    name: "gov-snap",
    snapshot_title: "Snap Title",
    snapshot_artist: "Snap Artist",
    snapshot_album: "Snap Album",
    snapshot_genre: "Snap Genre",
    snapshot_artwork_ref: "MEDIA-gov-snap",
    snapshot_content_hash: "sha256-snap-hash",
    snapshot_duration: 60,
  },
  metaObject: {
    name: "gov-meta-obj",
    metadata_json: { artist: "Obj Artist", duration: 88, album: "Obj Album" },
  },
  priorityConflict: {
    name: "gov-prio",
    title: "Explicit",
    artist: "Explicit Artist",
    duration: 300,
    metadata_json: JSON.stringify({ title: "Meta", artist: "Meta Artist", duration: 999 }),
    snapshot_title: "Snap",
    snapshot_artist: "Snap Artist",
    snapshot_duration: 111,
  },
  numericEdges: {
    name: "gov-nums",
    duration: "120.5",
    blob_size: 0,
    metadata_json: JSON.stringify({ track_number: "7" }),
  },
  filenameOnly: {
    name: "gov-fname",
    original_filename: "great_new-track.flac",
  },
};

describe("track-model contract governance", () => {
  // ── Output shape ─────────────────────────────────────────────

  const EXPECTED_KEYS = [
    "name", "title", "artist", "album", "genre", "duration",
    "track_number", "artwork_ref", "media_kind", "original_filename",
    "content_hash", "mime_type", "blob_size", "file_extension",
    "folder_path", "src", "has_preview_image", "has_artwork", "created_at",
    "modified_at", "sort_timestamp", "_offline", "_demo",
  ].sort();

  it("output shape has exactly the canonical keys", () => {
    const track = normalizeTrack(GOV_FIXTURES.fullManifest);
    expect(Object.keys(track).sort()).toEqual(EXPECTED_KEYS);
  });

  it("minimal input still produces all canonical keys", () => {
    const track = normalizeTrack(GOV_FIXTURES.minimal);
    expect(Object.keys(track).sort()).toEqual(EXPECTED_KEYS);
  });

  // ── Full manifest ────────────────────────────────────────────

  it("full manifest: all fields resolve correctly", () => {
    const t = normalizeTrack(GOV_FIXTURES.fullManifest);
    expect(t.name).toBe("gov-full");
    expect(t.title).toBe("Governance Song");
    expect(t.artist).toBe("Gov Artist");
    expect(t.album).toBe("Gov Album");
    expect(t.genre).toBe("Governance");
    expect(t.duration).toBe(195.7);
    expect(t.track_number).toBe(5);
    expect(t.media_kind).toBe("audio");
    expect(t.mime_type).toBe("audio/mpeg");
    expect(t.original_filename).toBe("governance_song.mp3");
    expect(t.file_extension).toBe("mp3");
    expect(t.content_hash).toBe("sha256-gov");
    expect(t.blob_size).toBe(4200000);
    expect(t.folder_path).toBe("/uploads/gov");
    expect(t._demo).toBe(false);
    expect(t._offline).toBe(false);
  });

  // ── Minimal input defaults ───────────────────────────────────

  it("minimal: defaults to name as title, empty strings, nulls", () => {
    const t = normalizeTrack(GOV_FIXTURES.minimal);
    expect(t.name).toBe("gov-min");
    expect(t.title).toBe("gov-min");
    expect(t.artist).toBe("");
    expect(t.album).toBe("");
    expect(t.genre).toBe("");
    expect(t.duration).toBeNull();
    expect(t.track_number).toBeNull();
    expect(t.media_kind).toBe("other");
    expect(t.blob_size).toBe(0);
    expect(t._demo).toBe(false);
  });

  // ── Demo track ───────────────────────────────────────────────

  it("demo: _demo true, media_kind forced to audio, src preserved", () => {
    const t = normalizeTrack(GOV_FIXTURES.demo);
    expect(t._demo).toBe(true);
    expect(t.media_kind).toBe("audio");
    expect(t.src).toBe("/audio/gov.mp3");
    expect(t.title).toBe("Demo Gov");
  });

  // ── Snapshot fallback ────────────────────────────────────────

  it("snapshot: all snapshot_* fields used as fallback", () => {
    const t = normalizeTrack(GOV_FIXTURES.snapshot);
    expect(t.title).toBe("Snap Title");
    expect(t.artist).toBe("Snap Artist");
    expect(t.album).toBe("Snap Album");
    expect(t.genre).toBe("Snap Genre");
    expect(t.artwork_ref).toBe("MEDIA-gov-snap");
    expect(t.content_hash).toBe("sha256-snap-hash");
    expect(t.duration).toBe(60);
  });

  // ── Artwork ref ──────────────────────────────────────────────

  it("artwork_ref: preserves URL-shaped preview_image_url into artwork_ref", () => {
    const t = normalizeTrack({
      name: "gov-art-url",
      preview_image_url: "https://cdn.example.com/thumb.jpg",
    });
    expect(t.artwork_ref).toBe("https://cdn.example.com/thumb.jpg");
  });

  it("artwork_ref: prefers explicit artwork_ref over URL fallbacks", () => {
    const t = normalizeTrack({
      name: "gov-art-prio",
      artwork_ref: "MEDIA-ASSET-cover",
      preview_image_url: "https://cdn.example.com/thumb.jpg",
    });
    expect(t.artwork_ref).toBe("MEDIA-ASSET-cover");
  });

  it("has_artwork: true when source data flags it", () => {
    const t = normalizeTrack({ name: "gov-art-flag", has_artwork: true });
    expect(t.has_artwork).toBe(true);
  });

  it("has_artwork: false by default", () => {
    const t = normalizeTrack({ name: "gov-no-art" });
    expect(t.has_artwork).toBe(false);
  });

  // ── metadata_json as object ──────────────────────────────────

  it("metaObject: metadata_json as plain object is accepted", () => {
    const t = normalizeTrack(GOV_FIXTURES.metaObject);
    expect(t.artist).toBe("Obj Artist");
    expect(t.album).toBe("Obj Album");
    expect(t.duration).toBe(88);
  });

  // ── Priority chain ───────────────────────────────────────────

  it("priority: explicit > metadata_json > snapshot", () => {
    const t = normalizeTrack(GOV_FIXTURES.priorityConflict);
    expect(t.title).toBe("Explicit");
    expect(t.artist).toBe("Explicit Artist");
    expect(t.duration).toBe(300);
  });

  // ── Numeric coercion ─────────────────────────────────────────

  it("numericEdges: string numbers coerced, track_number from meta", () => {
    const t = normalizeTrack(GOV_FIXTURES.numericEdges);
    expect(t.duration).toBe(120.5);
    expect(t.track_number).toBe(7);
    expect(t.blob_size).toBe(0);
  });

  // ── Filename-derived title ───────────────────────────────────

  it("filenameOnly: title derived from original_filename", () => {
    const t = normalizeTrack(GOV_FIXTURES.filenameOnly);
    expect(t.title).toBe("Great New Track");
  });

  // ── Null / undefined ─────────────────────────────────────────

  it("null and undefined return null", () => {
    expect(normalizeTrack(null)).toBeNull();
    expect(normalizeTrack(undefined)).toBeNull();
  });

  // ── Batch normalization ──────────────────────────────────────

  it("normalizeTracks processes governance fixtures as batch", () => {
    const all = Object.values(GOV_FIXTURES);
    const result = normalizeTracks(all);
    expect(result).toHaveLength(all.length);
    result.forEach((t) => {
      expect(Object.keys(t).sort()).toEqual(EXPECTED_KEYS);
    });
  });
});
