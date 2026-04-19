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
