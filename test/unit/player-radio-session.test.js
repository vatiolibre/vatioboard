import { beforeEach, describe, expect, it } from "vitest";
import { loadPlayerSession, savePlayerSession } from "../../src/shared/player-session.js";

const UUID = "11111111-1111-4111-8111-111111111111";

function radioEntry() {
  return {
    entryId: "radio-entry",
    name: `radio:${UUID}`,
    title: "Test Radio",
    artist: "US · English",
    album: "Internet Radio",
    genre: "jazz",
    duration: null,
    artwork_ref: `https://radio-media.vatioboard.com/v1/stations/${UUID}/artwork`,
    media_kind: "radio",
    original_filename: "",
    content_hash: "",
    mime_type: "",
    blob_size: 0,
    file_extension: "",
    folder_path: "",
    src: "https://must-not-persist.example/live.mp3",
    station_uuid: UUID,
    countrycode: "US",
    language: "English",
    codec: "MP3",
    bitrate: 128,
    hls: 0,
    url_resolved: "https://must-not-persist.example/live.mp3",
  };
}

beforeEach(() => localStorage.clear());

describe("player session v4 radio persistence", () => {

  it("persists only UUID and safe radio display metadata with position zero", () => {
    savePlayerSession({
      queueEntries: [radioEntry()],
      currentEntryId: "radio-entry",
      currentIndex: 0,
      currentTime: 87,
      paused: false,
    });
    const raw = localStorage.getItem("vatioboard_player_session_v3");
    expect(raw).not.toContain("must-not-persist.example");
    const saved = JSON.parse(raw);
    expect(saved.version).toBe(3);
    expect(saved.currentTime).toBe(0);
    expect(saved.queueEntries[0]).toMatchObject({
      station_uuid: UUID,
      media_kind: "radio",
      countrycode: "US",
      codec: "MP3",
      bitrate: 128,
      src: "",
      artwork_ref: `https://radio-media.vatioboard.com/v1/stations/${UUID}/artwork`,
    });
  });

  it("keeps durable radio logo URLs while excluding temporary audio URLs", () => {
    savePlayerSession({ queueEntries: [radioEntry()], currentEntryId: "radio-entry", currentIndex: 0 });
    const restored = loadPlayerSession();
    expect(restored.queueEntries[0].artwork_ref).toBe(radioEntry().artwork_ref);
  });

  it("migrates v2 finite queues into v4 without dropping duplicates", () => {
    const entry = { ...radioEntry(), media_kind: "audio", name: "asset-a", station_uuid: "", artwork_ref: "", src: "" };
    localStorage.setItem("vatioboard_player_session_v2", JSON.stringify({
      version: 2,
      queueEntries: [{ ...entry, entryId: "one" }, { ...entry, entryId: "two" }],
      playedEntries: [],
      currentEntryId: "two",
      currentIndex: 1,
      currentTime: 42,
      paused: true,
    }));
    const restored = loadPlayerSession();
    expect(restored.version).toBe(4);
    expect(restored.queueEntries.map((item) => item.entryId)).toEqual(["one", "two"]);
    expect(restored.currentTime).toBe(42);
  });

  it("migrates the v1 name queue while preserving playback preferences", () => {
    localStorage.setItem("vatioboard_player_session_v1", JSON.stringify({
      version: 1,
      queue: ["asset-a", "asset-a", "asset-b"],
      currentTrackName: "asset-a",
      currentTime: 19,
      paused: false,
      volume: 0.4,
      muted: true,
      repeat: "all",
      shuffle: true,
      backgroundMode: true,
    }));
    const restored = loadPlayerSession();
    expect(restored).toMatchObject({
      version: 4,
      queue: ["asset-a", "asset-a", "asset-b"],
      currentIndex: 0,
      currentTime: 19,
      paused: false,
      volume: 0.4,
      muted: true,
      repeat: "all",
      shuffle: true,
      backgroundMode: true,
    });
    expect(new Set(restored.queueEntries.map((entry) => entry.entryId)).size).toBe(3);
  });
});

it("writes v4 intent and backward-readable mirrors", () => {
  savePlayerSession({ queueEntries: [radioEntry()], paused: false });
  expect(JSON.parse(localStorage.getItem("vatioboard_player_session_v4"))).toMatchObject({ version: 4, playbackIntent: "playing", paused: false });
  expect(JSON.parse(localStorage.getItem("vatioboard_player_session_v3"))).toMatchObject({ version: 3, paused: false });
});

it("keeps stopped queues without restoring an implicit selection", () => {
  savePlayerSession({ queueEntries: [radioEntry()], currentEntryId: "radio-entry", currentIndex: 0, playbackIntent: "stopped" });
  expect(loadPlayerSession()).toMatchObject({ playbackIntent: "stopped", currentIndex: -1, currentEntryId: "", paused: true });
});

it("normalizes continuation tracks without persisting resolved URLs", () => {
  savePlayerSession({
    libraryContinuation: { tracks: [radioEntry()], lastTrackName: radioEntry().name, shuffleCycle: [radioEntry().name, "missing"] },
  });
  expect(loadPlayerSession().libraryContinuation).toMatchObject({
    tracks: [expect.objectContaining({ src: "" })], shuffleCycle: [radioEntry().name],
  });
  expect(localStorage.getItem("vatioboard_player_session_v4")).not.toContain("must-not-persist.example");
});

it("falls back past malformed storage and migrates v3 playing intent", () => {
  localStorage.setItem("vatioboard_player_session_v4", "null");
  localStorage.setItem("vatioboard_player_session_v3", JSON.stringify({ queueEntries: [radioEntry()], paused: false }));
  expect(loadPlayerSession()).toMatchObject({ version: 4, playbackIntent: "playing" });
});
