import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

import { installPlaywrightGpsTrace, playGpsTrace } from "../helpers/playwright-gps-trace";

const routeTransition = JSON.parse(readFileSync(
  new URL("../fixtures/gps/route-transition.json", import.meta.url),
  "utf8",
));

const consent = {
  accepted: true,
  acceptedAtMs: 1,
  locationChoice: "enabled",
  version: 1,
};

async function navigate(page: Page, path: string, route: string) {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }, path);
  await expect(page.locator("#app-view")).toHaveAttribute("data-vb-route", route);
}

test("one GPS trace remains canonical across Speed, Board, and Map", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Canonical trace runs once in Chromium desktop");
  await installPlaywrightGpsTrace(page);
  await page.addInitScript((value) => {
    localStorage.setItem("vatioboard.welcome_consent.v1", JSON.stringify(value));
    localStorage.setItem("player_widget_visible_v1", "false");
  }, consent);
  await page.route("https://tiles.openfreemap.org/styles/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      version: 8,
      sources: {},
      layers: [{ id: "telemetry-test-background", type: "background" }],
    }),
  }));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app-view")).toHaveAttribute("data-vb-route", "speed");
  await expect(page.locator("#speedValue")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__vatioboardDrivingTelemetry?.getSnapshot().status
  ))).not.toBe("idle");
  await playGpsTrace(page, routeTransition.samples.slice(0, 2) as never, 20);
  const initial = await page.evaluate(() => (window as any).__vatioboardDrivingTelemetry.getSnapshot());
  expect(initial.sampleCount).toBe(2);

  await navigate(page, "/board", "board");
  await playGpsTrace(page, routeTransition.samples.slice(2, 3) as never, 20);
  const background = await page.evaluate(() => (window as any).__vatioboardDrivingTelemetry.getSnapshot());
  expect(background.tripId).toBe(initial.tripId);
  expect(background.sampleCount).toBe(3);

  await navigate(page, "/map", "map");
  await expect(page.locator("[data-driving-speed]")).toBeVisible();
  await playGpsTrace(page, routeTransition.samples.slice(3) as never, 20);
  await expect(page.locator("[data-driving-speed]")).toHaveText("36");
  await expect(page.locator("[data-driving-stat='maxSpeed']")).toHaveText("36 km/h");
  const mapSnapshot = await page.evaluate(() => (window as any).__vatioboardDrivingTelemetry.getSnapshot());
  expect(mapSnapshot.tripId).toBe(initial.tripId);
  expect(mapSnapshot.sampleCount).toBe(5);
  expect(mapSnapshot.totalDistanceM).toBeGreaterThan(35);

  await navigate(page, "/", "speed");
  await expect(page.locator("#speedValue")).toBeVisible();
  await expect(page.locator("#maxSpeed")).toHaveText("36");
  await expect(page.locator("#altitudeValue")).toHaveText("—");
  const final = await page.evaluate(() => (window as any).__vatioboardDrivingTelemetry.getSnapshot());
  expect(final.tripId).toBe(initial.tripId);
  expect(final.sampleCount).toBe(5);
  expect(final.totalDistanceM).toBe(mapSnapshot.totalDistanceM);
});
