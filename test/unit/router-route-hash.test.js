import { describe, expect, it } from "vitest";

import { toAppRouteHash } from "../../src/app/router.js";
import { routeRegistry } from "../../src/app/route-registry.js";

describe("app route hash conversion", () => {
  it("keeps QR scanner links inside the hash router", () => {
    expect(toAppRouteHash("/qr-scanner")).toBe("#/qr-scanner");
    expect(toAppRouteHash("https://example.com/qr-scanner")).toBe("");
    expect(toAppRouteHash(`${window.location.origin}/qr-scanner?source=test`)).toBe("#/qr-scanner?source=test");
  });

  it("keeps every registered route and alias inside the current SPA document", () => {
    const paths = routeRegistry.flatMap((route) => [route.path, ...(route.aliases || [])]);

    for (const path of paths) {
      expect(toAppRouteHash(path), path).toBe(`#${path}`);
      expect(toAppRouteHash(`${window.location.origin}${path}?source=launcher`), path)
        .toBe(`#${path}?source=launcher`);
    }

    expect(toAppRouteHash("/not-a-vatioboard-route")).toBe("");
  });
});
