import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

import { installPlaywrightGpsTrace, playGpsTrace } from "../helpers/playwright-gps-trace";

const routeTransition = JSON.parse(readFileSync(
  new URL("../fixtures/gps/route-transition.json", import.meta.url),
  "utf8",
));
const nearestCameraConsistency = JSON.parse(readFileSync(
  new URL("../fixtures/cameras/nearest-camera-consistency.json", import.meta.url),
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

async function installCameraFixture(page: Page) {
  const generatedAt = "2026-09-07T00:00:00.000Z";
  const tileId = "130_106";
  const tileUrl = `/geo/cameras/countries/us/tiles/${tileId}.json`;
  await page.route("**/geo/cameras/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown = null;
    if (pathname === "/geo/cameras/manifest.json") {
      body = {
        version: 2,
        generatedAt,
        countries: {
          us: {
            code: "us",
            name: "United States",
            count: 1,
            tiled: true,
            tileSize: 1,
            tiles: "/geo/cameras/countries/us/manifest.json",
            bbox: [-74.1, 40.7, -73.8, 41],
          },
        },
      };
    } else if (pathname === "/geo/cameras/countries/us/manifest.json") {
      body = {
        version: 2,
        country: "us",
        generatedAt,
        count: 1,
        tileSize: 1,
        tiles: {
          [tileId]: { id: tileId, count: 1, json: tileUrl },
        },
      };
    } else if (pathname === tileUrl) {
      const camera = nearestCameraConsistency.camera;
      body = {
        version: 2,
        country: "us",
        tile: tileId,
        generatedAt,
        count: 1,
        traps: [[camera.longitude, camera.latitude, camera.speedKph, camera.id]],
      };
    }
    if (!body) return route.fulfill({ status: 404, body: "Not found" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
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

test("nearest camera stays vehicle-centric across Speed and Map viewport changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Camera continuity runs once in Chromium desktop");
  await installPlaywrightGpsTrace(page);
  await installCameraFixture(page);
  await page.addInitScript(({ welcomeConsent }) => {
    localStorage.setItem("vatioboard.welcome_consent.v1", JSON.stringify(welcomeConsent));
    localStorage.setItem("player_widget_visible_v1", "false");
    localStorage.setItem("vatio_speed_unit", "mph");
    localStorage.setItem("vatio_speed_distance_unit", "ft");
    localStorage.setItem("vatio_speed_trap_alert_enabled", "true");
    localStorage.setItem("vatio_speed_trap_alert_distance_m", "500");
    localStorage.setItem("vatio_speed_trap_sound_enabled", "true");
    localStorage.setItem("vatio_unit_bootstrap_v1", JSON.stringify({
      speedUnit: "mph",
      distanceUnit: "ft",
      tripDistanceUnit: "mi",
      initializedAtMs: 1,
      updatedAtMs: 1,
      source: "manual",
      countryCode: "us",
    }));
    localStorage.setItem("vatioboard.os.sharedSettings.v1", JSON.stringify({
      speedUnit: "mph",
      distanceUnit: "ft",
      tripDistanceUnit: "mi",
    }));
  }, { welcomeConsent: consent });
  await page.route("https://tiles.openfreemap.org/styles/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      version: 8,
      sources: {},
      layers: [{ id: "camera-test-background", type: "background" }],
    }),
  }));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#speedValue")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__vatioboardDrivingTelemetry?.getSnapshot().status
  ))).not.toBe("idle");
  await playGpsTrace(page, [{
    offsetMs: 0,
    coords: nearestCameraConsistency.vehicle,
  }] as never, 20);

  await expect.poll(() => page.evaluate(() => (
    (window as any).__vatioboardDrivingAlerts.getSnapshot().nearestTrapDistanceM
  ))).toBeGreaterThan(3370);
  const speedDistance = page.locator("#nearestTrapDistance");
  const speedUnit = page.locator("#nearestTrapUnit");
  await expect(speedDistance).toHaveText("2.1");
  await expect(speedUnit).toHaveText("mi");
  const alertSnapshot = await page.evaluate(() => (window as any).__vatioboardDrivingAlerts.getSnapshot());
  expect(alertSnapshot.nearestTrapDistanceM).toBeLessThan(3390);
  expect(alertSnapshot.alertUiState.trapActive).toBe(false);
  expect(alertSnapshot.audio.trapAudible).toBe(false);
  await page.locator("#resetTrip").click();
  await expect(speedDistance).toHaveText("2.1");
  expect(await page.evaluate(() => (
    (window as any).__vatioboardDrivingAlerts.getSnapshot().nearestTrapDistanceM
  ))).toBe(alertSnapshot.nearestTrapDistanceM);

  await navigate(page, "/map", "map");
  const mapDistance = page.locator("[data-driving-camera-distance]");
  await expect(mapDistance).toHaveText(nearestCameraConsistency.expectedImperialLabel);
  const canonicalDistanceM = await page.evaluate(() => (
    (window as any).__vatioboardDrivingAlerts.getSnapshot().nearestTrapDistanceM
  ));

  const canvas = page.locator(".maplibregl-canvas").first();
  if (await canvas.isVisible()) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40);
      await page.mouse.up();
      await page.mouse.wheel(0, -600);
    }
  }
  await expect(mapDistance).toHaveText(nearestCameraConsistency.expectedImperialLabel);
  expect(await page.evaluate(() => (
    (window as any).__vatioboardDrivingAlerts.getSnapshot().nearestTrapDistanceM
  ))).toBe(canonicalDistanceM);

  await navigate(page, "/", "speed");
  await expect(speedDistance).toHaveText("2.1");
  await expect(speedUnit).toHaveText("mi");
  expect(await page.evaluate(() => (
    (window as any).__vatioboardDrivingAlerts.getSnapshot().nearestTrapDistanceM
  ))).toBe(canonicalDistanceM);
});
