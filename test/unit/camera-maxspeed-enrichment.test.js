import { describe, expect, it, vi } from "vitest";
import {
  distancePointToSegmentMeters,
  enrichCameraRecordsWithRoadSpeeds,
  fetchOverpassJsonWithRetry,
  fetchRoadWaysForCameraBatch,
  getWayCandidateSpeed,
  parseMaxspeed,
  parseRetryAfterMs,
} from "../../scripts/camera-maxspeed-enrichment.mjs";

function camera(overrides = {}) {
  return {
    type: "node",
    id: 100,
    lon: 0,
    lat: 0,
    tags: {},
    ...overrides,
  };
}

function way(overrides = {}) {
  return {
    type: "way",
    id: 200,
    tags: { highway: "residential", maxspeed: "50" },
    geometry: [
      { lat: -0.001, lon: 0 },
      { lat: 0.001, lon: 0 },
    ],
    ...overrides,
  };
}

describe("camera maxspeed enrichment", () => {
  it("parses only unambiguous explicit maxspeed values", () => {
    expect(parseMaxspeed("50")).toMatchObject({ parsed: true, speedKph: 50, raw: "50" });
    expect(parseMaxspeed("50 km/h")).toMatchObject({ parsed: true, speedKph: 50 });
    expect(parseMaxspeed("50 kph")).toMatchObject({ parsed: true, speedKph: 50 });
    expect(parseMaxspeed("30 mph")).toMatchObject({ parsed: true, speedKph: 48 });
    expect(parseMaxspeed("signals").parsed).toBe(false);
    expect(parseMaxspeed("none").parsed).toBe(false);
    expect(parseMaxspeed("walk").parsed).toBe(false);
    expect(parseMaxspeed("DE:urban").parsed).toBe(false);
    expect(parseMaxspeed("50;60").parsed).toBe(false);
    expect(parseMaxspeed("50 @ (22:00-06:00)").parsed).toBe(false);
    expect(parseMaxspeed("30 mph; 50 mph").parsed).toBe(false);
  });

  it("measures point-to-segment distance in meters", () => {
    const distance = distancePointToSegmentMeters(
      { lat: 0.0001, lon: 0.0001 },
      { lat: 0, lon: 0 },
      { lat: 0.001, lon: 0 },
    );

    expect(distance).toBeCloseTo(11.1, 0);
  });

  it("selects the closest parseable road segment", () => {
    const result = enrichCameraRecordsWithRoadSpeeds(
      [camera()],
      [
        way({ id: 201, tags: { highway: "residential", maxspeed: "50" } }),
        way({
          id: 202,
          tags: { highway: "residential", maxspeed: "30" },
          geometry: [
            { lat: -0.001, lon: 0.0004 },
            { lat: 0.001, lon: 0.0004 },
          ],
        }),
      ],
    );

    expect(result[0]).toMatchObject({
      speedKph: 50,
      speedEnrichmentStatus: "inferred",
      speedMeta: expect.objectContaining({
        source: "nearest_road:maxspeed",
        confidence: "high",
        wayId: 201,
      }),
    });
  });

  it("rejects roads beyond the threshold", () => {
    const result = enrichCameraRecordsWithRoadSpeeds(
      [camera()],
      [
        way({
          geometry: [
            { lat: -0.001, lon: 0.001 },
            { lat: 0.001, lon: 0.001 },
          ],
        }),
      ],
      { maxDistanceM: 50 },
    );

    expect(result[0]).toMatchObject({
      speedKph: null,
      speedEnrichmentStatus: "unknown",
    });
  });

  it("rejects ambiguous near-ties with different speeds", () => {
    const result = enrichCameraRecordsWithRoadSpeeds(
      [camera()],
      [
        way({
          id: 301,
          tags: { highway: "primary", maxspeed: "50" },
          geometry: [
            { lat: -0.001, lon: 0.00004 },
            { lat: 0.001, lon: 0.00004 },
          ],
        }),
        way({
          id: 302,
          tags: { highway: "primary", maxspeed: "80" },
          geometry: [
            { lat: -0.001, lon: -0.00005 },
            { lat: 0.001, lon: -0.00005 },
          ],
        }),
      ],
    );

    expect(result[0]).toMatchObject({
      speedKph: null,
      speedEnrichmentStatus: "ambiguous",
    });
  });

  it("converts mph road speed to kph", () => {
    const candidate = getWayCandidateSpeed(
      way({ tags: { highway: "residential", maxspeed: "30 mph" } }),
      camera(),
    );

    expect(candidate).toMatchObject({
      speedKph: 48,
      speedMeta: expect.objectContaining({ raw: "30 mph" }),
    });
  });

  it("ignores unparseable road maxspeed values", () => {
    const candidate = getWayCandidateSpeed(
      way({ tags: { highway: "residential", maxspeed: "signals" } }),
      camera(),
    );

    expect(candidate).toBeNull();
  });

  it("handles directional maxspeed tags conservatively", () => {
    expect(getWayCandidateSpeed(
      way({ tags: { highway: "residential", "maxspeed:forward": "40" } }),
      camera(),
    )).toMatchObject({
      speedKph: 40,
      speedMeta: expect.objectContaining({ source: "nearest_road:maxspeed:forward" }),
    });

    expect(getWayCandidateSpeed(
      way({ tags: { highway: "residential", "maxspeed:forward": "40", "maxspeed:backward": "60" } }),
      camera(),
    )).toBeNull();
  });

  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfterMs("2", Date.UTC(2026, 4, 10, 7, 0, 0))).toBe(2000);
    expect(parseRetryAfterMs(
      "Sun, 10 May 2026 07:01:00 GMT",
      Date.UTC(2026, 4, 10, 7, 0, 0),
    )).toBe(60000);
    expect(parseRetryAfterMs("not-a-date")).toBeNull();
  });

  it("backs off and retries retryable Overpass responses", async () => {
    const sleeps = [];
    const retries = [];
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Response("busy", { status: 504 });
      }
      return new Response(JSON.stringify({ elements: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const payload = await fetchOverpassJsonWithRetry({
      overpassUrl: "https://overpass.test/api/interpreter",
      query: "[out:json];node(0,0,0,0);out;",
      fetchImpl,
      maxRetries: 2,
      retryInitialDelayMs: 100,
      retryMaxDelayMs: 1000,
      random: () => 0.5,
      sleepImpl: async (delayMs) => {
        sleeps.push(delayMs);
      },
      onRetry: (retry) => retries.push(retry),
    });

    expect(payload).toEqual({ elements: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([100]);
    expect(retries[0]).toMatchObject({
      attempt: 1,
      maxRetries: 2,
      delayMs: 100,
    });
  });

  it("honors Retry-After when road batch requests are rate limited", async () => {
    const sleeps = [];
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      }
      return new Response(JSON.stringify({
        elements: [
          way({ id: 501 }),
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await fetchRoadWaysForCameraBatch([camera()], {
      overpassUrl: "https://overpass.test/api/interpreter",
      fetchImpl,
      maxRetries: 1,
      sleepImpl: async (delayMs) => {
        sleeps.push(delayMs);
      },
    });

    expect(result.ways).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([2000]);
  });
});
