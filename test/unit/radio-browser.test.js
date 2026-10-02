import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRadioBrowserClient,
  getRadioArtworkUrl,
  getRadioStreamRelayUrl,
  radioStationToTrack,
  setRadioExternalNetworkAccessCheck,
} from "../../src/shared/radio-browser.js";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("Radio Browser client", () => {
  beforeEach(() => setRadioExternalNetworkAccessCheck(() => true));
  afterEach(() => vi.restoreAllMocks());

  it("searches Radio Browser directly and normalizes safe station metadata", async () => {
    const fetchFn = vi.fn(async (url) => {
      if (String(url).endsWith("/json/servers")) return Response.json([{ name: "de1.api.radio-browser.info" }]);
      return Response.json([{
        stationuuid: UUID,
        name: "Station",
        url_resolved: "https://stream.example/live.mp3",
        favicon: "https://images.example/icon.png",
        countrycode: "us",
        language: "English",
        tags: "rock,live",
        codec: "mp3",
        bitrate: 128,
        hls: 0,
        lastcheckok: 1,
      }]);
    });
    const client = createRadioBrowserClient({ fetchFn, storage: null });
    const stations = await client.searchStations({ name: "Station" });
    expect(stations[0]).toMatchObject({ stationuuid: UUID, name: "Station", hls: 0 });
    expect(fetchFn.mock.calls.every(([url]) => !String(url).includes("radio-media"))).toBe(true);
  });

  it("uses one relay URL for playback and keeps artwork on the artwork service", () => {
    expect(getRadioStreamRelayUrl(UUID)).toContain(`/v1/stations/${UUID}/stream`);
    expect(getRadioArtworkUrl(UUID)).toContain(`/v1/stations/${UUID}/artwork`);
    const track = radioStationToTrack({
      stationuuid: UUID,
      name: "Station",
      url_resolved: "http://stream.example/live",
      has_favicon: false,
      favicon: "",
      countrycode: "US",
      language: "English",
      tags: [],
      codec: "MP3",
      bitrate: 128,
      hls: 0,
      lastcheckok: 1,
    });
    expect(track.artwork_ref).toContain("/artwork");
  });

  it("does not access the directory when external radio access is denied", async () => {
    setRadioExternalNetworkAccessCheck(() => false);
    const fetchFn = vi.fn();
    await expect(createRadioBrowserClient({ fetchFn, storage: null }).getPopularStations()).rejects.toThrow(
      "radio-network-permission-denied",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
