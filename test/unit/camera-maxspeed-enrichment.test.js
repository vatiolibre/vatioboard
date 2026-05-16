import { describe, expect, it, vi } from "vitest";
import {
  clusterApproachCandidatesByBearing,
  createRoadSegmentIndex,
  distancePointToSegmentMeters,
  enrichCameraRecordsWithRoadSpeeds,
  fetchOverpassJsonWithRetry,
  fetchRoadWaysForCameraBatch,
  findApproachRoadCandidates,
  getPrivateCarRoadEligibility,
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

function roadEligibility(tags, options = {}, cameraOverrides = {}) {
  return getPrivateCarRoadEligibility(
    way({ tags: { maxspeed: "50", ...tags } }),
    camera(cameraOverrides),
    options,
  );
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

  it.each(["residential", "primary", "motorway"])("allows private-car highway class %s", (highway) => {
    expect(roadEligibility({ highway })).toMatchObject({ eligible: true, reason: "allowed" });
  });

  it.each(["footway", "path", "cycleway", "pedestrian", "track"])(
    "rejects non-private-car highway class %s by default",
    (highway) => {
      expect(roadEligibility({ highway })).toMatchObject({
        eligible: false,
        reason: "ignored-highway",
      });
    },
  );

  it("rejects service roads by default and allows only opted-in public service roads", () => {
    expect(roadEligibility({ highway: "service" })).toMatchObject({
      eligible: false,
      reason: "service-private",
    });
    expect(roadEligibility({ highway: "service", service: "alley" }, {
      includePublicServiceRoads: true,
    })).toMatchObject({ eligible: true });
    expect(roadEligibility({ highway: "service", service: "alley", access: "private" }, {
      includePublicServiceRoads: true,
    })).toMatchObject({ eligible: false, reason: "access-private" });
  });

  it("rejects unknown highway classes unless explicitly included", () => {
    expect(roadEligibility({ highway: "byway" })).toMatchObject({
      eligible: false,
      reason: "unknown-highway",
    });
    expect(roadEligibility({ highway: "byway" }, {
      includeUnknownHighwayClasses: true,
    })).toMatchObject({ eligible: true });
  });

  it("preserves the camera-tagged ignored-highway fallback without overriding hard access restrictions", () => {
    expect(roadEligibility({ highway: "footway" }, {}, {
      tags: { "road:highway": "footway" },
    })).toMatchObject({
      eligible: true,
      reason: "camera-tagged-ignored-highway",
    });

    expect(roadEligibility({ highway: "footway", access: "no" }, {}, {
      tags: { "road:highway": "footway" },
    })).toMatchObject({
      eligible: false,
      reason: "access-private",
    });
  });

  it.each([
    [{ access: "private" }, "access-private"],
    [{ access: "no" }, "access-private"],
    [{ vehicle: "no" }, "motor-vehicle-restricted"],
    [{ motor_vehicle: "no" }, "motor-vehicle-restricted"],
    [{ motorcar: "no" }, "motor-vehicle-restricted"],
    [{ motorcar: "delivery" }, "motor-vehicle-restricted"],
  ])("rejects private-car access restriction %o", (tags, reason) => {
    expect(roadEligibility({ highway: "residential", ...tags })).toMatchObject({
      eligible: false,
      reason,
    });
  });

  it("lets specific private-car permission override generic access restrictions", () => {
    expect(roadEligibility({
      highway: "residential",
      access: "private",
      motorcar: "yes",
    })).toMatchObject({ eligible: true });

    expect(roadEligibility({
      highway: "residential",
      vehicle: "no",
      motor_vehicle: "designated",
    })).toMatchObject({ eligible: true });
  });

  it("allows destination and customer access for normal private-car users", () => {
    expect(roadEligibility({ highway: "residential", access: "destination" })).toMatchObject({
      eligible: true,
    });
    expect(roadEligibility({ highway: "residential", access: "customers" })).toMatchObject({
      eligible: true,
    });
  });

  it("rejects conditional restrictions for private cars", () => {
    expect(roadEligibility({
      highway: "residential",
      "motor_vehicle:conditional": "no @ (22:00-06:00)",
    })).toMatchObject({
      eligible: false,
      reason: "motor-vehicle-restricted",
    });
  });

  it("rejects bus-only and transit-only roads without rejecting normal bus-designated roads", () => {
    expect(roadEligibility({ highway: "busway" })).toMatchObject({
      eligible: false,
      reason: "bus-only",
    });
    expect(roadEligibility({ highway: "primary", busway: "lane", motor_vehicle: "no" })).toMatchObject({
      eligible: false,
      reason: "bus-only",
    });
    expect(roadEligibility({ highway: "primary", access: "no", bus: "yes" })).toMatchObject({
      eligible: false,
      reason: "bus-only",
    });
    expect(roadEligibility({ highway: "primary", vehicle: "no", bus: "designated" })).toMatchObject({
      eligible: false,
      reason: "bus-only",
    });
    expect(roadEligibility({ highway: "primary", bus: "designated" })).toMatchObject({
      eligible: true,
    });
    expect(roadEligibility({ highway: "primary", busway: "lane", motorcar: "yes" })).toMatchObject({
      eligible: true,
    });
  });

  it.each(["driveway", "parking_aisle", "emergency_access", "bus", "private"])(
    "rejects private service value %s",
    (service) => {
      expect(roadEligibility({ highway: "service", service }, {
        includePublicServiceRoads: true,
      })).toMatchObject({
        eligible: false,
        reason: "service-private",
      });
    },
  );

  it("rejects roads only when lane tags clearly leave no private-car lane", () => {
    expect(roadEligibility({
      highway: "primary",
      "motor_vehicle:lanes": "no|no",
    })).toMatchObject({
      eligible: false,
      reason: "motor-vehicle-restricted",
    });

    expect(roadEligibility({
      highway: "primary",
      "motor_vehicle:lanes": "yes|no",
    })).toMatchObject({ eligible: true });

    expect(roadEligibility({
      highway: "primary",
      "vehicle:lanes": "bus|bus",
    })).toMatchObject({
      eligible: false,
      reason: "bus-only",
    });

    expect(roadEligibility({
      highway: "primary",
      "vehicle:lanes": "no|no",
      "motorcar:lanes": "yes|no",
    })).toMatchObject({ eligible: true });

    expect(roadEligibility({
      highway: "primary",
      "motor_vehicle:lanes": "no @ (Mo-Fr)|unknown",
    })).toMatchObject({ eligible: true });
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

  it("does not index hard-rejected roads and records skip reasons", () => {
    const stats = {};
    const segmentIndex = createRoadSegmentIndex([
      way({
        id: 451,
        tags: { highway: "primary", maxspeed: "50", access: "no" },
      }),
      way({
        id: 452,
        tags: { highway: "primary", maxspeed: "50" },
      }),
      way({
        id: 453,
        tags: { highway: "primary", maxspeed: "50" },
        geometry: [{ lat: 0, lon: 0 }],
      }),
    ], { stats });

    expect(segmentIndex.indexedWayCount).toBe(1);
    expect(segmentIndex.skippedReasonCounts).toMatchObject({
      "access-private": 1,
      "malformed-geometry": 1,
    });
    expect(stats.skippedRoadReasons).toMatchObject({
      "access-private": 1,
      "malformed-geometry": 1,
    });
  });

  it("does not include rejected road types in approach candidates", () => {
    const segmentIndex = createRoadSegmentIndex([
      way({
        id: 461,
        tags: { highway: "footway", maxspeed: "10" },
        geometry: [
          { lat: -0.001, lon: 0 },
          { lat: 0.001, lon: 0 },
        ],
      }),
      way({
        id: 462,
        tags: { highway: "primary", maxspeed: "50" },
        geometry: [
          { lat: -0.001, lon: 0.0001 },
          { lat: 0.001, lon: 0.0001 },
        ],
      }),
    ]);
    const result = findApproachRoadCandidates(camera(), segmentIndex);

    expect(result.approaches).toEqual([
      expect.objectContaining({ wayId: 462 }),
    ]);
  });

  it("chooses a residential road over a closer footway with maxspeed", () => {
    const result = enrichCameraRecordsWithRoadSpeeds(
      [camera()],
      [
        way({
          id: 471,
          tags: { highway: "footway", maxspeed: "10" },
          geometry: [
            { lat: -0.001, lon: 0 },
            { lat: 0.001, lon: 0 },
          ],
        }),
        way({
          id: 472,
          tags: { highway: "residential", maxspeed: "50" },
          geometry: [
            { lat: -0.001, lon: 0.0001 },
            { lat: 0.001, lon: 0.0001 },
          ],
        }),
      ],
    );

    expect(result[0]).toMatchObject({
      speedKph: 50,
      speedEnrichmentStatus: "inferred",
      speedMeta: expect.objectContaining({
        wayId: 472,
      }),
    });
  });

  it("chooses a primary road over a bus-only road", () => {
    const result = enrichCameraRecordsWithRoadSpeeds(
      [camera()],
      [
        way({
          id: 481,
          tags: { highway: "busway", maxspeed: "30" },
          geometry: [
            { lat: -0.001, lon: 0 },
            { lat: 0.001, lon: 0 },
          ],
        }),
        way({
          id: 482,
          tags: { highway: "primary", maxspeed: "70" },
          geometry: [
            { lat: -0.001, lon: 0.0001 },
            { lat: 0.001, lon: 0.0001 },
          ],
        }),
      ],
    );

    expect(result[0]).toMatchObject({
      speedKph: 70,
      speedEnrichmentStatus: "inferred",
      speedMeta: expect.objectContaining({
        wayId: 482,
      }),
    });
  });

  it("falls back safely when only private roads are nearby", () => {
    const result = enrichCameraRecordsWithRoadSpeeds(
      [camera()],
      [
        way({
          id: 491,
          tags: { highway: "primary", maxspeed: "50", access: "no" },
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
      speedMeta: null,
      approachMeta: [],
    });
  });

  it("rejects restricted roads in speed-only and approach-only enrichment paths", () => {
    expect(getWayCandidateSpeed(
      way({ tags: { highway: "residential", maxspeed: "30", access: "no" } }),
      camera(),
    )).toBeNull();

    const result = enrichCameraRecordsWithRoadSpeeds(
      [camera({ tags: { maxspeed: "60" } })],
      [
        way({
          id: 492,
          tags: { highway: "primary", access: "private" },
          geometry: [
            { lat: -0.001, lon: 0 },
            { lat: 0.001, lon: 0 },
          ],
        }),
      ],
    );

    expect(result[0]).toMatchObject({
      speedKph: 60,
      speedEnrichmentStatus: "explicit",
      approachMeta: [],
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
