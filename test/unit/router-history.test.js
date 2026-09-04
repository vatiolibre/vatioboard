import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testRoutes = [
  { path: "/", aliases: ["/speed"], title: "Speed", load: vi.fn() },
  { path: "/board", title: "Board", load: vi.fn() },
  { path: "/accel", title: "Acceleration", load: vi.fn() },
  { path: "/replay", title: "Replay", load: vi.fn() },
];

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("History API router", () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.__vatioboardCanLeaveAccel;
  });

  afterEach(() => {
    window.__vatioboardRouter?.destroy?.();
    delete window.__vatioboardRouter;
    delete window.__vatioboardCanLeaveAccel;
  });

  it("mounts a clean direct path and strips a legacy fragment without interpreting it", async () => {
    window.history.replaceState({}, "", "https://vatioboard.com/board/#/replay?record=old");
    const { createHistoryRouter } = await import("../../src/app/router.js");
    const routes = [];
    const router = createHistoryRouter({
      routes: testRoutes,
      onRouteChange: (route) => routes.push(route),
    });
    await settle();

    expect(routes.at(-1)).toMatchObject({ path: "/board", url: "/board", requestedPath: "/board" });
    expect(window.location.pathname).toBe("/board");
    expect(window.location.hash).toBe("");
    router.destroy();
  });

  it("normalizes aliases and updates queries without a document navigation", async () => {
    window.history.replaceState({}, "", "https://vatioboard.com/speed?source=direct");
    const routerModule = await import("../../src/app/router.js");
    const changes = [];
    const router = routerModule.createHistoryRouter({
      routes: testRoutes,
      onRouteChange: (route) => changes.push(route.url),
    });
    await settle();

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?source=direct");
    expect(changes).toEqual(["/?source=direct"]);

    expect(routerModule.navigateToAppRoute("/replay?record=run-1")).toBe(true);
    await settle();
    expect(window.location.pathname).toBe("/replay");
    expect(window.location.search).toBe("?record=run-1");

    routerModule.replaceAppRouteQuery({ record: "run-2", view: "details" });
    expect(window.location.search).toBe("?record=run-2&view=details");
    expect(changes).toHaveLength(2);
    router.destroy();
  });

  it("does not recognize hash route inputs", async () => {
    window.history.replaceState({}, "", "https://vatioboard.com/");
    const { toAppRouteUrl } = await import("../../src/app/router.js");
    expect(toAppRouteUrl("#/replay")).toBe("");
    expect(toAppRouteUrl("/#/replay")).toBe("");
  });

  it("keeps the current Acceleration route when navigation is rejected", async () => {
    window.history.replaceState({}, "", "https://vatioboard.com/accel");
    const routerModule = await import("../../src/app/router.js");
    const router = routerModule.createHistoryRouter({ routes: testRoutes, onRouteChange: vi.fn() });
    await settle();
    window.__vatioboardCanLeaveAccel = () => false;

    expect(routerModule.navigateToAppRoute("/board")).toBe(false);
    expect(window.location.pathname).toBe("/accel");
    router.destroy();
  });
});
