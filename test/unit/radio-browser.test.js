import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/environment.js", () => ({
  getEnvironmentConfig: () => ({
    radioMediaBase: "https://radio-media.dev.vatioboard.com",
    radioMediaEnvironment: "development",
  }),
}));

import {
  createRadioBrowserClient,
  getRadioRelayHealth,
  getRadioLogoUrl,
  probeRadioStation,
  radioStationToTrack,
  resetRadioRelayHealthForTesting,
  setRadioExternalNetworkAccessCheck,
} from "../../src/shared/radio-browser.js";

const UUID = "11111111-1111-4111-8111-111111111111";

function station(overrides = {}) {
  return {
    stationuuid: UUID,
    name: " Test Radio ",
    url_resolved: "https://stream.example.com/live.mp3",
    favicon: "https://images.example.com/logo.png",
    countrycode: "us",
    language: "English",
    tags: "jazz, instrumental, late night, extra",
    codec: "mp3",
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    ...overrides,
  };
}

describe("Radio Browser client", () => {
  beforeEach(() => {
    setRadioExternalNetworkAccessCheck(() => true);
    vi.restoreAllMocks();
    resetRadioRelayHealthForTesting();
  });

  it("accepts only trusted HTTPS mirrors, fails over, and constrains popular results", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(Response.json([
        { name: "evil.example.com" },
        { name: "http.api.radio-browser.info" },
        { name: "de1.api.radio-browser.info" },
      ]))
      .mockRejectedValueOnce(new Error("mirror down"))
      .mockResolvedValueOnce(Response.json([
        station(),
        station({ stationuuid: "22222222-2222-4222-8222-222222222222", hls: 1 }),
        station({ stationuuid: "33333333-3333-4333-8333-333333333333", lastcheckok: 0 }),
      ]));
    const client = createRadioBrowserClient({ fetchFn, storage: null });
    const result = await client.getPopularStations();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Test Radio", countrycode: "US", hls: 0 });
    const requestUrl = String(fetchFn.mock.calls.at(-1)[0]);
    expect(requestUrl).toContain("hidebroken=true");
    expect(requestUrl).toContain("limit=30");
    expect(requestUrl).toContain("order=clickcount");
    expect(requestUrl).toContain("reverse=true");
    expect(fetchFn.mock.calls.flat().join(" ")).not.toContain("evil.example.com/json/stations");
  });

  it("uses explicit search filters and safe UUID-derived track contracts", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(Response.json([{ name: "de1.api.radio-browser.info" }]))
      .mockResolvedValueOnce(Response.json([station()]));
    const client = createRadioBrowserClient({ fetchFn, storage: null });
    const [result] = await client.searchStations({ name: "Test", country: "us", tag: "jazz" });
    const requestUrl = String(fetchFn.mock.calls.at(-1)[0]);
    expect(requestUrl).toContain("name=Test");
    expect(requestUrl).toContain("countrycode=US");
    expect(requestUrl).toContain("tag=jazz");
    const track = radioStationToTrack(result);
    expect(track).toMatchObject({
      media_kind: "radio",
      name: `radio:${UUID}`,
      station_uuid: UUID,
      artwork_ref: getRadioLogoUrl(UUID),
      hls: 0,
    });
  });

  it("blocks future directory requests when external network permission is revoked", async () => {
    setRadioExternalNetworkAccessCheck(() => false);
    const fetchFn = vi.fn();
    const client = createRadioBrowserClient({ fetchFn, storage: null });
    await expect(client.getPopularStations()).rejects.toThrow("radio-network-permission-denied");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("de-duplicates successful click reports for a station", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(Response.json([{ name: "de1.api.radio-browser.info" }]))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const client = createRadioBrowserClient({ fetchFn, storage: null });
    expect(await client.registerStationClick(UUID)).toBe(true);
    expect(await client.registerStationClick(UUID)).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("reuses trusted session mirror discovery for one hour and expires it afterward", async () => {
    let stored = "";
    const storage = {
      getItem: vi.fn(() => stored || null),
      setItem: vi.fn((_key, value) => { stored = value; }),
    };
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const firstFetch = vi.fn()
      .mockResolvedValueOnce(Response.json([{ name: "de1.api.radio-browser.info" }]))
      .mockResolvedValueOnce(Response.json([station()]));
    await createRadioBrowserClient({ fetchFn: firstFetch, storage }).getPopularStations();
    expect(storage.setItem).toHaveBeenCalledOnce();

    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 30 * 60 * 1000);
    const cachedFetch = vi.fn().mockResolvedValueOnce(Response.json([station()]));
    await createRadioBrowserClient({ fetchFn: cachedFetch, storage }).getPopularStations();
    expect(String(cachedFetch.mock.calls[0][0])).toMatch(/^https:\/\/de1\.api\.radio-browser\.info\/json\/stations/);
    expect(cachedFetch).toHaveBeenCalledOnce();

    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 60 * 60 * 1000 + 1);
    const expiredFetch = vi.fn()
      .mockResolvedValueOnce(Response.json([{ name: "nl1.api.radio-browser.info" }]))
      .mockResolvedValueOnce(Response.json([station()]));
    await createRadioBrowserClient({ fetchFn: expiredFetch, storage }).getPopularStations();
    expect(String(expiredFetch.mock.calls[0][0])).toBe("https://all.api.radio-browser.info/json/servers");
  });

  it("filters malicious cached mirrors and resolves a healthy station by UUID", async () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        savedAt: Date.now(),
        mirrors: ["https://evil.example", "http://de1.api.radio-browser.info", "https://de1.api.radio-browser.info"],
      })),
      setItem: vi.fn(),
    };
    const fetchFn = vi.fn().mockResolvedValueOnce(Response.json([
      station({ favicon: "", bitrate: "192", tags: "one,two,three" }),
    ]));
    const result = await createRadioBrowserClient({ fetchFn, storage }).getStationByUuid(UUID);
    expect(result).toMatchObject({
      stationuuid: UUID,
      has_favicon: false,
      bitrate: 192,
      tags: ["one", "two", "three"],
    });
    expect(String(fetchFn.mock.calls[0][0])).toBe(`https://de1.api.radio-browser.info/json/stations/byuuid/${UUID}`);
    expect(fetchFn.mock.calls.flat().join(" ")).not.toContain("evil.example");
  });

  it("checks and caches the development relay health without exposing its URL in state", async () => {
    const fetchFn = vi.fn().mockResolvedValue(Response.json({
      ok: true,
      status: "ready",
      version: "dev-build",
    }));
    expect(await getRadioRelayHealth({ fetchFn })).toEqual({
      ok: true,
      status: "ready",
      environment: "development",
      version: "dev-build",
    });
    expect((await getRadioRelayHealth({ fetchFn })).ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toBe("https://radio-media.dev.vatioboard.com/v1/health");
  });

  it("normalizes station probe outcomes and forwards cancellation", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn().mockResolvedValue(Response.json({
      ok: false,
      outcome: "unsupported-content",
      stage: "content",
      version: "dev-build",
    }, { status: 502 }));
    expect(await probeRadioStation(UUID, { fetchFn, signal: controller.signal })).toEqual({
      ok: false,
      outcome: "unsupported-content",
      stage: "content",
      version: "dev-build",
    });
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
