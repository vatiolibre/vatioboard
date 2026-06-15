import { describe, expect, it } from "vitest";

import { toAppRouteHash } from "../../src/app/router.js";

describe("app route hash conversion", () => {
  it("keeps QR scanner links inside the hash router", () => {
    expect(toAppRouteHash("/qr-scanner")).toBe("#/qr-scanner");
    expect(toAppRouteHash("https://example.com/qr-scanner")).toBe("");
    expect(toAppRouteHash(`${window.location.origin}/qr-scanner?source=test`)).toBe("#/qr-scanner?source=test");
  });
});
