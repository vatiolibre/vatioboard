import { expect, test, type Page } from "@playwright/test";

const consent = {
  accepted: true,
  acceptedAtMs: 1,
  locationChoice: "skipped",
  version: 1,
};

const transparentTile = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==",
  "base64",
);

async function prepare(page: Page) {
  await page.route(/(tiles\.maps\.eox\.at|services\.arcgisonline\.com|tile\.openstreetmap\.org|basemaps\.cartocdn\.com)/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: transparentTile }));
  await page.route("https://embed.waze.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Waze map fixture</title><div>Map</div>",
  }));
  await page.addInitScript((value) => {
    localStorage.setItem("vatioboard.welcome_consent.v1", JSON.stringify(value));
    localStorage.setItem("player_widget_visible_v1", "false");
    localStorage.setItem("vatioboard.calc_panel.visible_v1", "false");
  }, consent);
}

async function openRoute(page: Page, route: string) {
  await page.goto(`/#/${route}`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.locator("#app-view").getAttribute("data-vb-route"), {
    timeout: 30_000,
  }).toBe(route);
}

async function expectScrolllessRoute(page: Page) {
  const geometry = await page.evaluate(() => {
    const outlet = document.querySelector<HTMLElement>("#app-view");
    const routeRoot = Array.from(outlet?.children || []).find((candidate) => {
      if (!(candidate instanceof HTMLElement)) return false;
      const box = candidate.getBoundingClientRect();
      return box.width > 100 && box.height > 100;
    }) as HTMLElement | undefined;
    for (const target of [document.documentElement, document.body, outlet, routeRoot]) {
      if (target instanceof HTMLElement) target.scrollTop = 1000;
    }
    return {
      document: [document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.scrollTop],
      body: [document.body.clientHeight, document.body.scrollHeight, document.body.scrollTop],
      outlet: [outlet?.clientHeight || 0, outlet?.scrollHeight || 0, outlet?.scrollTop || 0],
      route: routeRoot ? [routeRoot.clientHeight, routeRoot.scrollHeight, routeRoot.scrollTop] : [0, 0, 0],
    };
  });
  for (const [clientHeight, scrollHeight, scrollTop] of Object.values(geometry)) {
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
    expect(scrollTop).toBe(0);
  }
}

test.beforeEach(async ({ page }) => {
  await prepare(page);
});

test("Speed exposes scrollless Gauge, Stats, and Globe views", async ({ page }) => {
  await openRoute(page, "speed");
  await expect(page.locator(".speed-focused-nav")).toBeVisible();
  await expectScrolllessRoute(page);

  const gaugePanel = page.locator("#speedGaugePanel");
  const statsPanel = page.locator("#speedStatsPanel");
  const globePanel = page.locator("#speedGlobePanel");
  await expect(gaugePanel).toBeVisible();
  await expect(statsPanel).toBeHidden();
  await expect(globePanel).toBeHidden();

  const gaugeGeometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#speedGaugePanel")!.getBoundingClientRect();
    const dial = document.querySelector<HTMLElement>(".gauge-stage-inner")!.getBoundingClientRect();
    return { panel, dial };
  });
  expect(gaugeGeometry.dial.width).toBeGreaterThan(250);
  expect(gaugeGeometry.dial.width).toBeLessThanOrEqual(gaugeGeometry.panel.width + 1);
  expect(gaugeGeometry.dial.height).toBeLessThanOrEqual(gaugeGeometry.panel.height + 1);

  await page.locator('[data-vb-focused-view-target="stats"]').click();
  await expect(statsPanel).toBeVisible();
  expect(await page.locator("#speedStatsPanel .metric-card").count()).toBe(8);
  const statsFit = await statsPanel.evaluate((panel) => panel.scrollHeight <= panel.clientHeight + 1);
  expect(statsFit).toBe(true);

  await page.locator('[data-vb-focused-view-target="globe"]').click();
  await expect(globePanel).toBeVisible();
  await expect(globePanel.locator(".globe-card-kicker")).toHaveCount(0);
  await expect(page.locator('[data-vb-focused-view-target="globe"]')).toHaveText("Live globe");
  await expect(globePanel).toHaveAttribute("aria-label", "Current location globe");
  await expect(globePanel.locator("#globeStatus")).toBeVisible();
  const globe = await page.locator("#speedGlobe").boundingBox();
  expect(globe).not.toBeNull();
  expect(globe!.height).toBeGreaterThan(220);

  const tabs = await page.locator(".speed-focused-tab").all();
  for (const tab of tabs) {
    const box = await tab.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
});

test("registered routes keep page scrolling locked", async ({ page }) => {
  for (const route of ["accel", "replay", "waze", "board", "library", "apps", "delivery-checklist", "qr-scanner", "code-rain"]) {
    await openRoute(page, route);
    await expectScrolllessRoute(page);
  }
});

test("Acceleration and Library switch focused panels without moving the page", async ({ page }) => {
  await openRoute(page, "accel");
  await expect(page.locator("#accelGaugePanel")).toBeVisible();
  await page.locator('[data-vb-focused-view-target="status"]').click();
  await expect(page.locator("#accelStatusPanel")).toBeVisible();
  await expect(page.locator("#accelGaugePanel")).toBeHidden();
  await expectScrolllessRoute(page);

  await page.locator("#accelToolbarSetup").click();
  const setup = page.locator("#setupPanel");
  await expect(setup).toBeVisible();
  await expect(setup.locator("select")).toHaveCount(0);
  const setupScroll = await setup.locator(".accel-sheet-body").evaluate((body) => ({
    clientHeight: body.clientHeight,
    scrollHeight: body.scrollHeight,
  }));
  expect(setupScroll.scrollHeight).toBeLessThanOrEqual(setupScroll.clientHeight + 1);
  for (const control of await setup.locator("button, .vb-settings-switch-row").all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await setup.locator("#closeSetupPanel").click();
  await expect(setup).toBeHidden();

  await openRoute(page, "library");
  await expect(page.locator("#libraryListView")).toBeVisible();
  await page.locator("#libraryDetailViewTab").click();
  await expect(page.locator("#libraryDetailView")).toBeVisible();
  await expect(page.locator("#libraryListView")).toBeHidden();
  await expectScrolllessRoute(page);
});

test("focused view survives portrait-landscape-portrait rotation", async ({ page }, testInfo) => {
  test.skip(
    !["iphone-standard", "iphone-standard-webkit"].includes(testInfo.project.name),
    "Representative rotation profile",
  );
  await openRoute(page, "speed");
  await page.locator('[data-vb-focused-view-target="stats"]').click();
  await expect(page.locator("#speedStatsPanel")).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => page.locator("html").getAttribute("data-vb-layout-profile")).toBe("short-landscape");
  await expect(page.locator(".speed-focused-nav")).toBeHidden();
  await expectScrolllessRoute(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator("html").getAttribute("data-vb-layout-profile")).toBe("portrait");
  await expect(page.locator("#speedStatsPanel")).toBeVisible();
  await expect(page.locator("#speedGaugePanel")).toBeHidden();
  await expectScrolllessRoute(page);
});

test("calculator is work-area clamped with fixed primary controls", async ({ page }) => {
  await openRoute(page, "board");
  await page.evaluate(() => (window as any).__vatioboardFloatingTools.openCalculator());
  const calculator = page.locator(".calc-panel");
  await expect(calculator).toBeVisible();
  await expect(calculator).toHaveAttribute("data-vb-shell-layout-mode", "portrait");
  const geometry = await calculator.evaluate((panel) => {
    const rootStyle = getComputedStyle(document.documentElement);
    const number = (name: string) => Number.parseFloat(rootStyle.getPropertyValue(name)) || 0;
    const bounds = panel.getBoundingClientRect();
    const keys = Array.from(panel.querySelectorAll<HTMLElement>(".calc-key")).map((key) => {
      const rect = key.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    const primaryKeys = Array.from(panel.querySelectorAll<HTMLElement>(".calc-keys > .calc-key:not(.zero)")).map((key) => {
      const rect = key.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    const display = panel.querySelector<HTMLElement>(".calc-display")!.getBoundingClientRect();
    const expression = panel.querySelector<HTMLElement>(".calc-expr")!.getBoundingClientRect();
    const utility = panel.querySelector<HTMLElement>(".calc-utility-row")!.getBoundingClientRect();
    const secondary = panel.querySelector<HTMLElement>(".calc-secondary-keys")!.getBoundingClientRect();
    const history = panel.querySelector<HTMLElement>(".calc-history-text")!;
    return {
      bounds,
      workArea: {
        left: number("--vb-work-area-left"),
        top: number("--vb-work-area-top"),
        width: number("--vb-work-area-width"),
        height: number("--vb-work-area-height"),
      },
      display: { width: display.width, height: display.height },
      expression: { width: expression.width, height: expression.height },
      utility: { top: utility.top, bottom: utility.bottom },
      secondary: { top: secondary.top, bottom: secondary.bottom },
      historyFontSize: getComputedStyle(history).fontSize,
      keys,
      primaryKeys,
    };
  });
  expect(geometry.bounds.left).toBeGreaterThanOrEqual(geometry.workArea.left - 1);
  expect(geometry.bounds.top).toBeGreaterThanOrEqual(geometry.workArea.top - 1);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.workArea.left + geometry.workArea.width + 1);
  expect(geometry.bounds.bottom).toBeLessThanOrEqual(geometry.workArea.top + geometry.workArea.height + 1);
  expect(geometry.bounds.height).toBeLessThanOrEqual(557);
  expect(geometry.display.height).toBeGreaterThanOrEqual(64);
  expect(geometry.display.height).toBeLessThanOrEqual(73);
  expect(geometry.expression.height).toBeGreaterThanOrEqual(44);
  expect(geometry.secondary.top - geometry.utility.bottom).toBeGreaterThanOrEqual(3);
  expect(geometry.secondary.top - geometry.utility.bottom).toBeLessThanOrEqual(5);
  expect(geometry.historyFontSize).toBe("13px");
  for (const key of geometry.keys) {
    expect(key.width).toBeGreaterThanOrEqual(44);
    expect(key.height).toBeGreaterThanOrEqual(44);
    expect(key.height).toBeLessThanOrEqual(65);
  }
  for (const key of geometry.primaryKeys) {
    expect(key.width / key.height).toBeGreaterThanOrEqual(1.08);
    expect(key.width / key.height).toBeLessThanOrEqual(1.65);
  }

  await page.evaluate(() => (
    (window as any).__vatioboardFloatingTools.calcWidget.setExpression("40-31.37")
  ));
  await calculator.locator(".calc-key.eq").click();
  await expect(calculator.locator(".calc-expr")).toHaveValue("8.63");
});

test("Clock blocks double-tap zoom and cannot unlock page scrolling", async ({ page }, testInfo) => {
  test.skip(
    !["iphone-compact", "iphone-se-webkit"].includes(testInfo.project.name),
    "Representative Chromium and WebKit touch regression coverage",
  );
  await openRoute(page, "board");
  await page.locator("[data-vb-shell-start-button]").click();
  const tile = page.locator(".vb-app-launcher-tile-main[data-app-id='vatio.premiumClock']");
  const pageIndex = await tile.evaluate((element) => (
    element.closest<HTMLElement>("[data-vb-app-launcher-page]")?.dataset.page || "0"
  ));
  await page.locator(`.vb-app-launcher-page-dot[data-page='${pageIndex}']`).click();
  await tile.click();

  const panel = page.locator(".premium-clock-panel");
  await expect(panel).toBeVisible();
  const interaction = await panel.evaluate((element) => {
    const doubleClick = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    element.dispatchEvent(doubleClick);
    window.scrollTo(0, 1000);
    document.documentElement.scrollTop = 1000;
    document.body.scrollTop = 1000;
    const close = element.querySelector<HTMLElement>("[aria-label='Close clock']");
    return {
      doubleClickPrevented: doubleClick.defaultPrevented,
      panelOverscroll: getComputedStyle(element).overscrollBehavior,
      closeTouchAction: close ? getComputedStyle(close).touchAction : "",
      windowScrollY: window.scrollY,
      documentScrollTop: document.documentElement.scrollTop,
      bodyScrollTop: document.body.scrollTop,
    };
  });
  expect(interaction.doubleClickPrevented).toBe(true);
  expect(interaction.panelOverscroll).toBe("none");
  expect(interaction.closeTouchAction).toBe("manipulation");
  expect(interaction.windowScrollY).toBe(0);
  expect(interaction.documentScrollTop).toBe(0);
  expect(interaction.bodyScrollTop).toBe(0);
  await expectScrolllessRoute(page);

  await panel.locator("[aria-label='Close clock']").click();
  await expect(panel).toBeHidden();
});
