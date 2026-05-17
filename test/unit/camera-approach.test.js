import KDBush from "kdbush";
import { describe, expect, it } from "vitest";

import {
  angularDifferenceDeg,
  bearingFromVehicleToCamera,
  distancePointToSegmentMeters,
  findApproachingTrapAcrossDatasets,
  isDistanceDecreasing,
  isHeadingTowardCamera,
  normalizeHeadingDeg,
  scoreApproachCandidate,
} from "../../src/speed/camera-approach.js";
import { buildTrapIndex } from "../../src/speed/traps.js";

function dataset(traps, key = "test") {
  return {
    key,
    traps,
    index: buildTrapIndex(traps, KDBush),
  };
}

function position(overrides = {}) {
  return {
    latitude: 0,
    longitude: 0,
    speedMs: 12,
    timestampMs: 2000,
    accuracyM: 5,
    ...overrides,
  };
}

function approach(overrides = {}) {
  return {
    bearingDeg: 90,
    reverseBearingDeg: 270,
    direction: "both",
    confidence: "high",
    roadDistanceM: 6,
    segment: [[-0.002, 0.001], [0.002, 0.001]],
    ...overrides,
  };
}

describe("camera approach matching", () => {
  it("normalizes heading and measures angular differences across north", () => {
    expect(normalizeHeadingDeg(361)).toBe(1);
    expect(normalizeHeadingDeg(-1)).toBe(359);
    expect(angularDifferenceDeg(350, 10)).toBe(20);
    expect(angularDifferenceDeg(90, 270)).toBe(180);
  });

  it("computes bearing to a camera and heading-toward checks", () => {
    const bearing = bearingFromVehicleToCamera(
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0 },
    );

    expect(bearing).toBeCloseTo(0, 0);
    expect(isHeadingTowardCamera(5, bearing, 30)).toBe(true);
    expect(isHeadingTowardCamera(90, bearing, 30)).toBe(false);
  });

  it("detects decreasing distance from previous position", () => {
    const camera = { latitude: 0.002, longitude: 0 };
    expect(isDistanceDecreasing(position({
      latitude: 0.001,
      previousPosition: { latitude: 0, longitude: 0, timestampMs: 1000 },
    }), camera)).toBe(true);
    expect(isDistanceDecreasing(position({
      latitude: -0.001,
      previousPosition: { latitude: 0, longitude: 0, timestampMs: 1000 },
    }), camera)).toBe(false);
  });

  it("measures point-to-segment distance at runtime", () => {
    expect(distancePointToSegmentMeters(
      { latitude: 0.0001, longitude: 0.0001 },
      [0, 0],
      [0, 0.001],
    )).toBeCloseTo(11.1, 0);
  });

  it("accepts heading-only approach when metadata is missing", () => {
    const result = scoreApproachCandidate({
      trap: [0, 0.001, 50, "north"],
      distanceM: 111,
    }, position({
      headingDeg: 0,
      previousPosition: { latitude: -0.001, longitude: 0, timestampMs: 1000 },
    }), {
      alertDistanceM: 300,
    });

    expect(result).toMatchObject({
      accepted: true,
      state: "missing-metadata",
      reason: "heading-to-camera",
    });
  });

  it("derives heading from previous movement when GPS heading is missing", () => {
    const result = scoreApproachCandidate({
      trap: [0, 0.002, 50, "north"],
      distanceM: 111,
    }, position({
      latitude: 0.001,
      headingDeg: null,
      previousPosition: { latitude: 0, longitude: 0, timestampMs: 1000 },
    }), {
      alertDistanceM: 300,
    });

    expect(result).toMatchObject({
      accepted: true,
      headingSource: "movement",
    });
  });

  it("selects the approaching candidate when the nearest camera is a side false positive", () => {
    const traps = [
      [0.00015, 0, 50, "side"],
      [0, 0.001, 80, "ahead"],
    ];
    const result = findApproachingTrapAcrossDatasets([dataset(traps, "city")], position({
      headingDeg: 0,
      previousPosition: { latitude: -0.001, longitude: 0, timestampMs: 1000 },
    }), {
      alertDistanceM: 300,
      maxCandidateCount: 4,
    });

    expect(result).toMatchObject({
      nearestTrapId: "city:1",
      nearestTrapSpeedKph: 80,
      cameraApproachState: "missing-metadata",
    });
  });

  it("uses legacy radius fallback when heading and metadata are unavailable", () => {
    const result = findApproachingTrapAcrossDatasets([dataset([[0, 0.001, 50, "camera"]])], position({
      speedMs: null,
      headingDeg: null,
    }), {
      alertDistanceM: 300,
      fallbackMode: "legacy-radius",
    });

    expect(result).toMatchObject({
      nearestTrapId: "test:0",
      cameraApproachState: "legacy-radius",
      cameraApproachReason: "missing-metadata-heading-unavailable",
    });
  });

  it("can suppress missing-heading fallback when configured heading-only", () => {
    const result = findApproachingTrapAcrossDatasets([dataset([[0, 0.001, 50, "camera"]])], position({
      speedMs: null,
      headingDeg: null,
    }), {
      alertDistanceM: 300,
      fallbackMode: "heading-only",
    });

    expect(result.nearestTrapId).toBeNull();
    expect(result.cameraApproachState).toBe("unknown-heading");
  });

  it("requires high-confidence metadata to match the road approach", () => {
    const trap = [0, 0.001, 50, "camera", {
      approach: [approach({
        bearingDeg: 90,
        reverseBearingDeg: 270,
        direction: "both",
      })],
    }];

    expect(scoreApproachCandidate({ trap, distanceM: 111 }, position({
      latitude: 0.001,
      longitude: -0.001,
      headingDeg: 90,
    }), { alertDistanceM: 300 }).accepted).toBe(true);

    expect(scoreApproachCandidate({ trap, distanceM: 111 }, position({
      latitude: 0,
      longitude: 0,
      headingDeg: 0,
    }), { alertDistanceM: 300 })).toMatchObject({
      accepted: false,
      reason: "metadata-heading-mismatch",
    });
  });

  it("honors one-way metadata direction", () => {
    const trap = [0, 0.001, 50, "camera", {
      approach: [approach({ direction: "forward" })],
    }];

    expect(scoreApproachCandidate({ trap, distanceM: 111 }, position({
      latitude: 0.001,
      longitude: -0.001,
      headingDeg: 90,
    }), { alertDistanceM: 300 }).accepted).toBe(true);

    expect(scoreApproachCandidate({ trap, distanceM: 111 }, position({
      latitude: 0.001,
      longitude: 0.001,
      headingDeg: 270,
    }), { alertDistanceM: 300 }).accepted).toBe(false);
  });

  it("accepts a camera when any approach corridor matches and reports the matched corridor", () => {
    const trap = [0, 0.001, 50, "camera", {
      approach: [
        approach({
          wayId: 10,
          role: "primary",
          bearingDeg: 0,
          reverseBearingDeg: 180,
          segment: [[0, -0.001], [0, 0.002]],
        }),
        approach({
          wayId: 20,
          role: "intersection",
          bearingDeg: 90,
          reverseBearingDeg: 270,
          segment: [[-0.002, 0.001], [0.002, 0.001]],
        }),
      ],
    }];

    expect(scoreApproachCandidate({ trap, distanceM: 111 }, position({
      latitude: 0.001,
      longitude: -0.001,
      headingDeg: 90,
    }), { alertDistanceM: 300 })).toMatchObject({
      accepted: true,
      reason: "metadata-approach-match",
      matchedApproachIndex: 1,
      matchedWayId: 20,
      matchedRole: "intersection",
      matchedConfidence: "high",
      matchedBearingDeg: 90,
      matchedDirection: "both",
      corridorCount: 2,
    });
  });

  it("chooses the best matching corridor deterministically", () => {
    const trap = [0, 0.001, 50, "camera", {
      approach: [
        approach({ wayId: 30, role: "primary", confidence: "low", bearingDeg: 2, reverseBearingDeg: 182, segment: null }),
        approach({ wayId: 40, role: "intersection", confidence: "medium", bearingDeg: 4, reverseBearingDeg: 184, segment: null }),
      ],
    }];

    expect(scoreApproachCandidate({ trap, distanceM: 111 }, position({
      latitude: 0,
      longitude: 0,
      headingDeg: 3,
    }), { alertDistanceM: 300 })).toMatchObject({
      accepted: true,
      matchedApproachIndex: 1,
      matchedWayId: 40,
      matchedConfidence: "medium",
    });
  });

  it("does not over-trigger low-confidence ambiguous corridors outside legacy fallback", () => {
    const trap = [0, 0.001, 50, "camera", {
      approach: [approach({
        wayId: 50,
        role: "ambiguous",
        confidence: "low",
        ambiguous: true,
        bearingDeg: 90,
        reverseBearingDeg: 270,
        segment: [[-0.002, 0.001], [0.002, 0.001]],
      })],
    }];

    expect(scoreApproachCandidate({ trap, distanceM: 111 }, position({
      latitude: 0,
      longitude: 0,
      headingDeg: 0,
    }), { alertDistanceM: 300, fallbackMode: "heading-only" })).toMatchObject({
      accepted: false,
      reason: "metadata-heading-mismatch",
    });

    expect(scoreApproachCandidate({ trap, distanceM: 111 }, position({
      latitude: 0,
      longitude: 0,
      headingDeg: 0,
    }), { alertDistanceM: 300, fallbackMode: "legacy-radius" })).toMatchObject({
      accepted: true,
      reason: "low-metadata-heading-to-camera",
    });
  });

  it("uses GPS accuracy to widen, but not erase, the road corridor", () => {
    const trap = [0, 0.001, 50, "camera", {
      approach: [approach({
        segment: [[-0.002, 0.001], [0.002, 0.001]],
      })],
    }];

    expect(scoreApproachCandidate({ trap, distanceM: 111 }, position({
      latitude: 0.0016,
      longitude: -0.001,
      headingDeg: 90,
      accuracyM: 50,
    }), { alertDistanceM: 300, roadCorridorM: 20 }).accepted).toBe(true);

    expect(scoreApproachCandidate({ trap, distanceM: 111 }, position({
      latitude: 0.003,
      longitude: -0.001,
      headingDeg: 90,
      accuracyM: 20,
    }), { alertDistanceM: 300, roadCorridorM: 20 })).toMatchObject({
      accepted: false,
      reason: "metadata-corridor-mismatch",
    });
  });

  it("suppresses parked or very low-speed samples", () => {
    const result = scoreApproachCandidate({
      trap: [0, 0.001, 50, "camera"],
      distanceM: 111,
    }, position({
      headingDeg: 0,
      speedMs: 0.2,
    }), {
      alertDistanceM: 300,
      minimumSpeedMs: 1.5,
    });

    expect(result).toMatchObject({
      accepted: false,
      reason: "below-minimum-speed",
    });
  });
});
