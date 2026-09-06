import { describe, expect, it } from "vitest";

import { createReplaySession } from "../../src/replay/session.js";

describe("replay session metadata", () => {
  it("preserves a valid recording source", () => {
    expect(createReplaySession({ source: "map" }).source).toBe("map");
    expect(createReplaySession({ source: "speed" }).source).toBe("speed");
    expect(createReplaySession({ source: "unknown" }).source).toBe("speed");
  });

  it("stores explicit short and trip distance units", () => {
    expect(createReplaySession({
      unit: "mph",
      distanceUnit: "ft",
      tripDistanceUnit: "mi",
    })).toMatchObject({ unit: "mph", distanceUnit: "ft", tripDistanceUnit: "mi" });
  });
});
