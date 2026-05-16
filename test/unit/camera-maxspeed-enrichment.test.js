import { describe, expect, it, vi } from "vitest";
import {
  clusterApproachCandidatesByBearing,
  createRoadSegmentIndex,
  distancePointToSegmentMeters,
  enrichCameraRecordsWithRoadSpeeds,
  fetchOverpassJsonWithRetry,
  fetchRoadWaysForCameraBatch,
  findApproachRoadCandidates,
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
        approach: [
          expect.objectContaining({
            bearingDeg: 0,
            reverseBearingDeg: 180,
            direction: "both",
            confidence: "high",
          }),
        ],
      }),
    });
  });

  it("adds road approach metadata for explicit camera speeds", () => {
    const result = enrichCameraRecordsWithRoadSpeeds(
      [camera({ tags: { maxspeed: "60" } })],
      [way({
        id: 210,
        tags: { highway: "primary", maxspeed: "60", oneway: "yes" },
        geometry: [
          { lat: 0, lon: -0.001 },
          { lat: 0, lon: 0.001 },
        ],
      })],
    );

    expect(result[0]).toMatchObject({
      speedKph: 60,
      speedEnrichmentStatus: "explicit",
      speedMeta: expect.objectContaining({
        source: "camera:maxspeed",
        approach: [
          expect.objectContaining({
            bearingDeg: 90,
            reverseBearingDeg: 270,
            direction: "forward",
            roadDistanceM: 0,
          }),
        ],
      }),
    });
  });

  it("uses the closest local segment bearing for bent road approach metadata", () => {
    const candidate = getWayCandidateSpeed(
      way({
        id: 211,
        tags: { highway: "primary", maxspeed: "70" },
        geometry: [
          { lat: 0, lon: -0.001 },
          { lat: 0, lon: 0 },
          { lat: 0.001, lon: 0 },
        ],
      }),
      camera({ lat: 0.0005, lon: 0.00002 }),
    );

    expect(candidate).toMatchObject({
      speedKph: 70,
      speedMeta: expect.objectContaining({
        approach: [
          expect.objectContaining({
            bearingDeg: 0,
            reverseBearingDeg: 180,
          }),
        ],
      }),
    });
    expect(candidate.speedMeta.approach[0].segment).toEqual([[0, 0], [0, 0.001]]);
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
      speedMeta: expect.objectContaining({
        source: "nearest_road:approach",
        confidence: "low",
        ambiguous: true,
        ambiguityReason: "nearby-different-speed",
        nearbyCandidateCount: 2,
        approach: expect.arrayContaining([
          expect.objectContaining({
            confidence: "low",
            ambiguous: true,
            ambiguityReason: "nearby-different-speed",
          }),
        ]),
      }),
    });
  });

  it("stores same-speed perpendicular roads as bounded intersection corridors", () => {
    const result = enrichCameraRecordsWithRoadSpeeds(
      [camera()],
      [
        way({
          id: 311,
          tags: { highway: "primary", maxspeed: "50" },
          geometry: [
            { lat: -0.001, lon: 0.00004 },
            { lat: 0.001, lon: 0.00004 },
          ],
        }),
        way({
          id: 312,
          tags: { highway: "primary", maxspeed: "50" },
          geometry: [
            { lat: 0.00005, lon: -0.001 },
            { lat: 0.00005, lon: 0.001 },
          ],
        }),
      ],
    );

    expect(result[0]).toMatchObject({
      speedKph: 50,
      speedEnrichmentStatus: "inferred",
      speedMeta: expect.objectContaining({
        source: "nearest_road:maxspeed",
        confidence: "medium",
        nearbyCandidateCount: 2,
        bearingSpreadDeg: 90,
        approach: expect.arrayContaining([
          expect.objectContaining({
            wayId: 311,
            confidence: "medium",
            role: "primary",
            bearingDeg: 0,
          }),
          expect.objectContaining({
            wayId: 312,
            confidence: "medium",
            role: "intersection",
            bearingDeg: 90,
          }),
        ]),
      }),
    });
  });

  it("clusters near-identical approach bearings and handles 0/360 wrap", () => {
    const clustered = clusterApproachCandidatesByBearing([
      { distanceM: 8, speedKph: 50, sourceWayId: 1, speedMeta: { approach: [{ bearingDeg: 2 }] } },
      { distanceM: 6, speedKph: 50, sourceWayId: 2, speedMeta: { approach: [{ bearingDeg: 358 }] } },
      { distanceM: 7, speedKph: 50, sourceWayId: 3, speedMeta: { approach: [{ bearingDeg: 90 }] } },
    ], { approachBearingClusterDeg: 15 });

    expect(clustered).toHaveLength(2);
    expect(clustered.map((candidate) => candidate.sourceWayId)).toEqual([2, 3]);
  });

  it("caps plausible approach corridors deterministically", () => {
    const roads = [0, 30, 70, 110, 155].map((bearingDeg, index) => {
      const radians = bearingDeg * Math.PI / 180;
      const dx = Math.sin(radians) * 0.001;
      const dy = Math.cos(radians) * 0.001;
      return way({
        id: 400 + index,
        tags: { highway: "primary", maxspeed: "50" },
        geometry: [
          { lat: -dy, lon: -dx },
          { lat: dy, lon: dx },
        ],
      });
    });
    const result = enrichCameraRecordsWithRoadSpeeds([camera()], roads, { maxApproachCorridors: 3 });

    expect(result[0].speedEnrichmentStatus).toBe("ambiguous");
    expect(result[0].speedMeta.approach).toHaveLength(3);
    expect(result[0].speedMeta).toMatchObject({
      ambiguous: true,
      ambiguityReason: "too-many-plausible-corridors",
      nearbyCandidateCount: 5,
    });
  });

  it("stores approach-only corridors when road speed cannot be inferred", () => {
    const result = enrichCameraRecordsWithRoadSpeeds(
      [camera()],
      [
        way({
          id: 430,
          tags: { highway: "primary" },
          geometry: [
            { lat: -0.001, lon: 0 },
            { lat: 0.001, lon: 0 },
          ],
        }),
      ],
    );

    expect(result[0]).toMatchObject({
      speedKph: null,
      speedEnrichmentStatus: "unknown",
      speedMeta: expect.objectContaining({
        source: "nearest_road:approach",
        approach: [
          expect.objectContaining({
            wayId: 430,
            role: "primary",
            confidence: "high",
            source: "osm-road-segment",
          }),
        ],
      }),
    });
  });

  it("finds multiple approach corridors from the segment index", () => {
    const segmentIndex = createRoadSegmentIndex([
      way({
        id: 441,
        tags: { highway: "primary", maxspeed: "50" },
        geometry: [
          { lat: -0.001, lon: 0 },
          { lat: 0.001, lon: 0 },
        ],
      }),
      way({
        id: 442,
        tags: { highway: "primary", maxspeed: "50" },
        geometry: [
          { lat: 0, lon: -0.001 },
          { lat: 0, lon: 0.001 },
        ],
      }),
    ]);
    const result = findApproachRoadCandidates(camera(), segmentIndex);

    expect(result.approaches).toEqual(expect.arrayContaining([
      expect.objectContaining({ wayId: 441, role: "primary" }),
      expect.objectContaining({ wayId: 442, role: "intersection" }),
    ]));
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
