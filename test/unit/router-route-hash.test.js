import { describe, expect, it } from "vitest";

import { parseAppLocation, toAppRouteUrl } from "../../src/app/router.js";
import { routeRegistry } from "../../src/app/route-registry.js";

describe("clean app route conversion", () => {
  it("keeps QR scanner links inside the History router", () => {
    expect(toAppRouteUrl("/qr-scanner")).toBe("/qr-scanner");
    expect(toAppRouteUrl("https://example.com/qr-scanner")).toBe("");
    expect(toAppRouteUrl(`${window.location.origin}/qr-scanner?source=test`)).toBe("/qr-scanner?source=test");
  });

  it("keeps every registered route and alias inside the current SPA document", () => {
    const paths = routeRegistry.flatMap((route) => [route.path, ...(route.aliases || [])]);

    for (const path of paths) {
      const canonicalPath = routeRegistry.find((route) => route.path === path || route.aliases?.includes(path))?.path;
      expect(toAppRouteUrl(path), path).toBe(canonicalPath);
      expect(toAppRouteUrl(`${window.location.origin}${path}?source=launcher`), path)
        .toBe(`${canonicalPath}?source=launcher`);
    }

    expect(toAppRouteUrl("/not-a-vatioboard-route")).toBe("");
  });

  it("reads path and query without interpreting legacy fragments", () => {
    const route = parseAppLocation({ pathname: "/board/", search: "?source=test" });
    expect(route.path).toBe("/board");
    expect(route.query.get("source")).toBe("test");
    expect(route.url).toBe("/board?source=test");
  });
});
