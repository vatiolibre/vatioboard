import { beforeEach, describe, expect, it, vi } from "vitest";

const UUID = "11111111-1111-4111-8111-111111111111";
const { getStationByUuid } = vi.hoisted(() => ({ getStationByUuid: vi.fn() }));

vi.mock("../../src/shared/media-cache.js", () => ({
  getLocalMediaBlob: vi.fn(),
  getLocalBlobMeta: vi.fn(),
  isAutoCacheEligible: vi.fn(),
  registerAutoCacheDownload: vi.fn(),
  cacheMediaFromResponse: vi.fn(),
}));
vi.mock("../../src/shared/demo-cache.js", () => ({
  getCachedDemoTrackBlob: vi.fn(),
  triggerDemoTrackCache: vi.fn(),
}));
vi.mock("../../src/shared/environment.js", () => ({
  getEnvironmentConfig: () => ({ apiBase: "", backendEnabled: false }),
}));
vi.mock("../../src/shared/backend-auth.js", () => ({
  fetchBackendMediaAssetBlob: vi.fn(),
  getBackendMediaAssetAccess: vi.fn(),
  getProtectedMediaRequestGate: vi.fn(),
}));
vi.mock("../../src/shared/media-access-cache.js", () => ({
  getCachedMediaAccess: vi.fn(),
  setCachedMediaAccess: vi.fn(),
}));
vi.mock("../../src/shared/track-source-policy.js", () => ({
  isDemoTrackName: vi.fn(() => false),
  isPublicStaticTrack: vi.fn(() => false),
  shouldUseBackendMediaAccess: vi.fn(() => false),
}));
vi.mock("../../src/shared/radio-browser.js", () => ({
  getRadioStreamRelayUrl: (uuid) => `https://radio-media.vatioboard.com/v1/stations/${uuid}/stream`,
  hasRadioExternalNetworkAccess: () => true,
  isRadioStationUuid: (uuid) => uuid === UUID,
  radioBrowser: { getStationByUuid },
}));

import { resolveAudioSource } from "../../src/shared/audio-source-resolver.js";

function radio(overrides = {}) {
  return {
    name: `radio:${UUID}`,
    media_kind: "radio",
    station_uuid: UUID,
    hls: 0,
    ...overrides,
  };
}

describe("radio audio source resolution", () => {
  beforeEach(() => getStationByUuid.mockReset());

  it("starts HTTPS streams direct with one UUID relay fallback", async () => {
    const result = await resolveAudioSource(`radio:${UUID}`, radio({
      url_resolved: "https://stream.example.com/live.mp3",
    }));
    expect(result).toMatchObject({
      sourceType: "live",
      sourceTransport: "radio-direct-cors",
      isLive: true,
      seekable: false,
      cacheable: false,
      analysisEligible: true,
      fallbackSrc: `https://radio-media.vatioboard.com/v1/stations/${UUID}/stream`,
    });
  });

  it("routes HTTP stations through the relay immediately", async () => {
    const result = await resolveAudioSource(`radio:${UUID}`, radio({
      url_resolved: "http://stream.example.com/live.mp3",
    }));
    expect(result).toMatchObject({
      sourceType: "live",
      sourceTransport: "radio-relay",
      isLive: true,
    });
    expect(result.src).toContain(`/v1/stations/${UUID}/stream`);
  });

  it("rejects HLS and invalid station identities", async () => {
    expect(await resolveAudioSource(`radio:${UUID}`, radio({ hls: 1 }))).toBeNull();
    expect(await resolveAudioSource("radio:bad", radio({ station_uuid: "bad" }))).toBeNull();
  });

  it("re-resolves a restored UUID when transient stream metadata is absent", async () => {
    getStationByUuid.mockResolvedValue({
      stationuuid: UUID,
      url_resolved: "https://fresh.example.com/live.ogg",
      hls: 0,
      lastcheckok: 1,
    });
    const result = await resolveAudioSource(`radio:${UUID}`, radio());
    expect(getStationByUuid).toHaveBeenCalledWith(UUID);
    expect(result.src).toBe("https://fresh.example.com/live.ogg");
  });
});
