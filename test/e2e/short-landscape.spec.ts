import { expect, test, type Page, type TestInfo } from "@playwright/test";

const consent = {
  accepted: true,
  acceptedAtMs: 1,
  locationChoice: "skipped",
  version: 1,
};

async function preparePage(page: Page) {
  await page.addInitScript((value) => {
    localStorage.setItem("vatioboard.welcome_consent.v1", JSON.stringify(value));
    localStorage.setItem("player_widget_visible_v1", "false");
    localStorage.setItem("vatioboard.calc_panel.visible_v1", "false");
  }, consent);
}

async function openRoute(page: Page, route = "speed") {
  // Map/media embeds may keep the page load event pending; the SPA mounts on DOMContentLoaded.
  await page.goto(`/#/${route}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app-view > *").first()).toBeVisible();
  await expect(page.locator(".vb-shell-taskbar")).toBeVisible();
}

async function getWorkArea(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const number = (name: string) => Number.parseFloat(style.getPropertyValue(name)) || 0;
    return {
      left: number("--vb-work-area-left"),
      top: number("--vb-work-area-top"),
      width: number("--vb-work-area-width"),
      height: number("--vb-work-area-height"),
    };
  });
}

function isTeslaProject(testInfo: TestInfo) {
  return ["model-y-2024", "model-y-2026"].includes(testInfo.project.name);
}

test.beforeEach(async ({ page }) => {
  await preparePage(page);
});

test("selects layout profiles from CSS viewport geometry", async ({ page }, testInfo) => {
  await openRoute(page);
  const profile = await page.locator("html").getAttribute("data-vb-layout-profile");
  if (testInfo.project.name.startsWith("model-y-")) expect(profile).toBe("short-landscape");
  else if (testInfo.project.name === "phone-portrait") expect(profile).toBe("portrait");
  else expect(profile).toBe("standard");
});

test("speed dashboard contains a large dial without outer scrolling", async ({ page }, testInfo) => {
  test.skip(!isTeslaProject(testInfo), "Exact Tesla geometry assertion");
  await openRoute(page, "speed");
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });

  await expect.poll(() => page.evaluate(() => {
    const dial = document.querySelector<HTMLElement>(".gauge-stage-inner");
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>(".gauge-stage-inner canvas"));
    if (!dial || canvases.length !== 2 || dial.getBoundingClientRect().width < 300) return false;
    return canvases.every((canvas) => {
      return Math.abs(canvas.width - Math.floor(canvas.clientWidth * window.devicePixelRatio)) <= 1
        && Math.abs(canvas.height - Math.floor(canvas.clientHeight * window.devicePixelRatio)) <= 1;
    });
  })).toBe(true);

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    const main = document.querySelector(".speed-main") as HTMLElement;
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>(".gauge-stage-inner canvas")).map((canvas) => {
      const bounds = canvas.getBoundingClientRect();
      return {
        cssWidth: bounds.width,
        cssHeight: bounds.height,
        layoutWidth: canvas.clientWidth,
        layoutHeight: canvas.clientHeight,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
      };
    });
    return {
      alertTrigger: rect(".speed-alert-trigger"),
      card: rect(".gauge-card"),
      dial: rect(".gauge-stage-inner"),
      canvases,
      devicePixelRatio: window.devicePixelRatio,
      mainClientHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });

  expect(geometry.dial.width).toBeGreaterThanOrEqual(300);
  expect(geometry.dial.left).toBeGreaterThanOrEqual(geometry.card.left);
  expect(geometry.dial.right).toBeLessThanOrEqual(geometry.card.right + 1);
  expect(geometry.dial.bottom).toBeLessThanOrEqual(geometry.card.bottom + 3);
  expect(Math.abs(
    (geometry.dial.top - geometry.card.top) - (geometry.card.bottom - geometry.dial.bottom)
  )).toBeLessThanOrEqual(3);
  const dialCenter = {
    x: geometry.dial.left + (geometry.dial.width / 2),
    y: geometry.dial.top + (geometry.dial.height / 2),
  };
  expect(
    dialCenter.x >= geometry.alertTrigger.left
    && dialCenter.x <= geometry.alertTrigger.right
    && dialCenter.y >= geometry.alertTrigger.top
    && dialCenter.y <= geometry.alertTrigger.bottom
  ).toBe(false);
  expect(geometry.mainScrollHeight).toBeLessThanOrEqual(geometry.mainClientHeight + 1);
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  const expectedDpr = testInfo.project.name === "model-y-2024" ? 1.53 : 1.96;
  expect(geometry.devicePixelRatio).toBeCloseTo(expectedDpr, 2);
  expect(geometry.canvases).toHaveLength(2);
  for (const canvas of geometry.canvases) {
    expect(Math.abs(canvas.backingWidth - Math.floor(canvas.layoutWidth * geometry.devicePixelRatio))).toBeLessThanOrEqual(1);
    expect(Math.abs(canvas.backingHeight - Math.floor(canvas.layoutHeight * geometry.devicePixelRatio))).toBeLessThanOrEqual(1);
  }
  await expect(page).toHaveScreenshot("speed-dashboard.png", {
    animations: "disabled",
    mask: [page.locator("canvas"), page.locator("iframe"), page.locator(".speed-globe")],
    maxDiffPixelRatio: 0.01,
  });
});

test("Waze route fills the shell work area with an overlaid driving HUD", async ({ page, context }, testInfo) => {
  test.skip(!isTeslaProject(testInfo), "Exact Tesla geometry assertion");
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4175" });
  await context.setGeolocation({ latitude: 40.7484, longitude: -73.9857, accuracy: 5 });
  await page.route("https://embed.waze.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body style='margin:0;background:#dfe9ef'></body></html>",
  }));
  await openRoute(page, "waze");
  await page.locator("#wazeLocationPrompt").click();
  await expect(page.locator("#wazeFrame")).toHaveAttribute("src", /embed\.waze\.com\/iframe/);

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    const controls = Array.from(document.querySelectorAll<HTMLElement>(".waze-hud-actions button")).map((button) => {
      const bounds = button.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    return {
      app: rect(".waze-app"),
      frame: rect("#wazeFrame"),
      hud: rect(".waze-hud"),
      taskbar: rect(".vb-shell-taskbar"),
      controls,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
    };
  });
  const workArea = await getWorkArea(page);

  expect(Math.abs(geometry.app.left - workArea.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.app.top - workArea.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.app.width - workArea.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.app.height - workArea.height)).toBeLessThanOrEqual(1);
  expect(geometry.frame.width).toBeGreaterThanOrEqual(workArea.width - 12);
  expect(geometry.frame.height).toBeGreaterThanOrEqual(workArea.height - 12);
  expect(geometry.app.bottom).toBeLessThanOrEqual(geometry.taskbar.top + 1);
  expect(geometry.hud.left).toBeGreaterThanOrEqual(geometry.app.left);
  expect(geometry.hud.right).toBeLessThanOrEqual(geometry.app.right);
  expect(geometry.hud.bottom).toBeLessThanOrEqual(geometry.app.bottom);
  for (const control of geometry.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }
  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth + 1);
  expect(geometry.documentScrollHeight).toBeLessThanOrEqual(geometry.documentClientHeight + 1);
  await expect(page).toHaveScreenshot("waze-map.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
});

test("compact trip stats keep the live globe visible", async ({ page }, testInfo) => {
  test.skip(!isTeslaProject(testInfo), "Exact Tesla geometry assertion");
  await openRoute(page, "speed");
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });

  await page.evaluate(() => {
    const notice = document.querySelector<HTMLElement>("#notice");
    if (notice) notice.hidden = false;
  });

  await expect.poll(() => page.locator(".speed-globe").evaluate((element) => (
    element.getBoundingClientRect().height
  ))).toBeGreaterThanOrEqual(60);

  const geometry = await page.evaluate(() => {
    const rect = (element: Element) => element.getBoundingClientRect().toJSON();
    const main = document.querySelector<HTMLElement>(".speed-main")!;
    const stats = document.querySelector<HTMLElement>(".stats-grid")!;
    const globeCard = document.querySelector<HTMLElement>(".globe-card")!;
    const globe = document.querySelector<HTMLElement>(".speed-globe")!;
    const taskbar = document.querySelector<HTMLElement>(".vb-shell-taskbar")!;
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".metric-card")).map((card) => {
      const label = card.querySelector<HTMLElement>(".metric-label")!;
      const unit = card.querySelector<HTMLElement>(".metric-unit")!;
      const value = card.querySelector<HTMLElement>("strong")!;
      return {
        card: rect(card),
        label: rect(label),
        unit: rect(unit),
        value: rect(value),
        labelFits: label.scrollWidth <= label.clientWidth + 1,
        unitFits: unit.scrollWidth <= unit.clientWidth + 1,
      };
    });
    return {
      cards,
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      globe: rect(globe),
      globeCard: rect(globeCard),
      mainClientHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight,
      stats: rect(stats),
      taskbar: rect(taskbar),
    };
  });

  expect(geometry.cards).toHaveLength(8);
  for (const card of geometry.cards) {
    expect(Math.abs(card.label.top - card.unit.top)).toBeLessThanOrEqual(3);
    expect(card.label.right).toBeLessThanOrEqual(card.unit.left - 2);
    expect(card.value.top).toBeGreaterThanOrEqual(Math.max(card.label.bottom, card.unit.bottom) - 1);
    expect(card.value.right).toBeLessThanOrEqual(card.card.right);
    expect(card.labelFits).toBe(true);
    expect(card.unitFits).toBe(true);
  }
  expect(geometry.stats.bottom).toBeLessThanOrEqual(geometry.globeCard.top);
  expect(geometry.globe.height).toBeGreaterThanOrEqual(60);
  expect(geometry.globe.bottom).toBeLessThanOrEqual(geometry.globeCard.bottom);
  expect(geometry.globe.bottom).toBeLessThanOrEqual(geometry.taskbar.top);
  expect(geometry.mainScrollHeight).toBeLessThanOrEqual(geometry.mainClientHeight + 1);
  expect(geometry.documentScrollHeight).toBeLessThanOrEqual(geometry.documentClientHeight + 1);

  await page.evaluate(() => {
    const notice = document.querySelector<HTMLElement>("#notice");
    if (notice) notice.hidden = true;
  });
  await expect(page.locator(".speed-globe")).toBeVisible();
  expect(await page.locator(".speed-globe").evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(60);
});

test("trip metric units still update from Speed Alerts", async ({ page }, testInfo) => {
  test.skip(!isTeslaProject(testInfo), "Tesla metric behavior regression");
  await openRoute(page, "speed");
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });

  await page.locator("#alertTrigger").click();
  const panel = page.locator(".speed-alert-window");
  await expect(panel).toBeVisible();
  await panel.locator("button[data-unit='mph']").click();
  await expect(page.locator("#maxSpeedUnit")).toHaveText("mph");
  await expect(page.locator("#avgSpeedUnit")).toHaveText("mph");

  await panel.locator("button[data-distance-unit='ft']").click();
  await expect(page.locator("#distanceUnit")).toHaveText("mi");
  await expect(page.locator("#altitudeUnit")).toHaveText("ft");
  await expect(page.locator("#maxAltitudeUnit")).toHaveText("ft");
  await expect(page.locator("#minAltitudeUnit")).toHaveText("ft");
});

test("player Browse content becomes a full-height right sidecar", async ({ page }, testInfo) => {
  test.skip(!isTeslaProject(testInfo), "Exact Tesla geometry assertion");
  await openRoute(page, "speed");
  await page.evaluate(() => (window as any).__vatioboardPlayerWidget.open());
  const player = page.locator(".player-panel");
  await expect(player).toBeVisible();
  await player.locator(".player-content-toggle-btn").click();
  await expect(player).toHaveClass(/is-content-open/);
  await expect(player).toHaveAttribute("data-vb-shell-layout-mode", "short-landscape");

  const [panel, body, sheet, pane, workArea] = await Promise.all([
    player.boundingBox(),
    player.locator(".player-body").boundingBox(),
    player.locator(".player-content-sheet").boundingBox(),
    player.locator(".player-content-pane:not([hidden])").boundingBox(),
    getWorkArea(page),
  ]);
  expect(sheet!.x).toBeGreaterThanOrEqual(body!.x + body!.width - 1);
  expect(pane!.height).toBeGreaterThanOrEqual(250);
  expect(panel!.x).toBeGreaterThanOrEqual(workArea.left - 1);
  expect(panel!.y).toBeGreaterThanOrEqual(workArea.top - 1);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(workArea.left + workArea.width + 1);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(workArea.top + workArea.height + 1);
  await expect(page).toHaveScreenshot("player-sidecar.png", {
    animations: "disabled",
    mask: [page.locator("canvas"), page.locator("iframe")],
    maxDiffPixelRatio: 0.01,
  });
});

test("calculator uses a unified keypad with vertical side rails", async ({ page }, testInfo) => {
  test.skip(!isTeslaProject(testInfo), "Exact Tesla geometry assertion");
  await openRoute(page, "board");
  await page.evaluate(() => (window as any).__vatioboardFloatingTools.openCalculator());
  const calculator = page.locator(".calc-panel");
  await expect(calculator).toBeVisible();
  await expect(calculator).toHaveAttribute("data-vb-shell-layout-mode", "short-landscape");

  const [panel, display, keypad, utilityRail, secondaryRail, keys, utilityButtons, secondaryButtons, utilityPresentation, workArea] = await Promise.all([
    calculator.boundingBox(),
    calculator.locator(".calc-display").boundingBox(),
    calculator.locator(".calc-keys").boundingBox(),
    calculator.locator(".calc-utility-row").boundingBox(),
    calculator.locator(".calc-secondary-keys").boundingBox(),
    calculator.locator(".calc-keys .calc-key").evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    })),
    calculator.locator(".calc-utility-btn").evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    })),
    calculator.locator(".calc-secondary-keys .calc-key").evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    })),
    calculator.evaluate((element) => ({
      expressionAlignment: getComputedStyle(element.querySelector(".calc-expr")!).textAlign,
      historyAlignment: getComputedStyle(element.querySelector(".calc-history-text")!).textAlign,
      labels: Array.from(element.querySelectorAll<HTMLElement>(".calc-utility-btn-label")).map((label) => ({
        display: getComputedStyle(label).display,
        text: label.textContent,
      })),
      controls: Array.from(element.querySelectorAll<HTMLButtonElement>(".calc-utility-btn")).map((button) => ({
        ariaLabel: button.getAttribute("aria-label"),
        i18nAria: button.getAttribute("data-i18n-aria"),
      })),
      iconSizes: Array.from(element.querySelectorAll<SVGElement>(".calc-utility-btn svg")).map((icon) => {
        const rect = icon.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    })),
    getWorkArea(page),
  ]);
  const panelCenter = panel!.x + panel!.width / 2;
  const keypadCenter = keypad!.x + keypad!.width / 2;
  expect(panel!.width).toBeLessThanOrEqual(520);
  expect(panel!.height).toBeLessThanOrEqual(440);
  expect(Math.abs(keypadCenter - panelCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(utilityRail!.width - secondaryRail!.width)).toBeLessThanOrEqual(1);
  expect(utilityRail!.x + utilityRail!.width).toBeLessThanOrEqual(keypad!.x + 1);
  expect(keypad!.x + keypad!.width).toBeLessThanOrEqual(secondaryRail!.x + 1);
  expect(display!.x).toBeLessThanOrEqual(utilityRail!.x + 1);
  expect(display!.x + display!.width).toBeGreaterThanOrEqual(secondaryRail!.x + secondaryRail!.width - 1);
  expect(Math.min(...keys.map((key) => key.height))).toBeGreaterThanOrEqual(44);
  expect(Math.min(...keys.map((key) => key.width))).toBeGreaterThanOrEqual(44);
  expect(Math.min(...utilityButtons.map((button) => button.height))).toBeGreaterThanOrEqual(44);
  expect(Math.min(...utilityButtons.map((button) => button.width))).toBeGreaterThanOrEqual(44);
  expect(Math.min(...secondaryButtons.map((button) => button.height))).toBeGreaterThanOrEqual(44);
  expect(Math.min(...secondaryButtons.map((button) => button.width))).toBeGreaterThanOrEqual(44);
  expect(utilityButtons.every((button, index) => index === 0 || button.top > utilityButtons[index - 1].bottom)).toBe(true);
  expect(secondaryButtons.every((button, index) => index === 0 || button.top > secondaryButtons[index - 1].bottom)).toBe(true);
  expect(utilityPresentation.expressionAlignment).toBe("center");
  expect(utilityPresentation.historyAlignment).toBe("center");
  expect(utilityPresentation.labels.every((label) => label.display === "none" && Boolean(label.text?.trim()))).toBe(true);
  expect(utilityPresentation.controls.every((control) => Boolean(control.ariaLabel) && Boolean(control.i18nAria))).toBe(true);
  expect(utilityPresentation.iconSizes.every((icon) => icon.width === 22 && icon.height === 22)).toBe(true);
  expect(panel!.x).toBeGreaterThanOrEqual(workArea.left - 1);
  expect(panel!.y).toBeGreaterThanOrEqual(workArea.top - 1);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(workArea.left + workArea.width + 1);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(workArea.top + workArea.height + 1);
  await expect(page).toHaveScreenshot("calculator-landscape.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });

  await calculator.locator(".calc-history-btn").click();
  await expect(calculator.locator(".calc-history-sheet")).toHaveClass(/is-open/);
  await calculator.locator(".calc-history-close").click();
  await expect(calculator.locator(".calc-history-sheet")).not.toHaveClass(/is-open/);

  await calculator.locator(".calc-settings-btn").click();
  await expect(calculator.locator(".calc-settings-sheet")).toHaveClass(/is-open/);
  await calculator.locator(".calc-settings-close").click();
  await expect(calculator.locator(".calc-settings-sheet")).not.toHaveClass(/is-open/);

  await calculator.locator(".calc-energy-btn").click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__vatioboardFloatingTools.shellManager.getWindow("energy")?.state
  ))).toBe("open");
  await page.evaluate(() => (window as any).__vatioboardFloatingTools.closeEnergy());

  const secondaryKeys = calculator.locator(".calc-secondary-keys .calc-key");
  const calculatorApi = () => page.evaluate(() => (
    (window as any).__vatioboardFloatingTools.calcWidget.getExpression()
  ));
  await page.evaluate(() => (window as any).__vatioboardFloatingTools.calcWidget.setExpression("9"));
  await secondaryKeys.nth(0).click();
  await expect.poll(calculatorApi).toBe("sqrt(9)");
  await page.evaluate(() => (window as any).__vatioboardFloatingTools.calcWidget.setExpression("3"));
  await secondaryKeys.nth(1).click();
  await expect.poll(calculatorApi).toBe("(3)^2");
  await page.evaluate(() => (window as any).__vatioboardFloatingTools.calcWidget.setExpression("9"));
  await secondaryKeys.nth(2).click();
  await expect.poll(calculatorApi).toBe("-9");
  await page.evaluate(() => (window as any).__vatioboardFloatingTools.calcWidget.setExpression("12"));
  await secondaryKeys.nth(3).click();
  await expect.poll(calculatorApi).toBe("1");
});

test("calculator header close button hides and can reopen the same window", async ({ page }, testInfo) => {
  test.skip(
    !["model-y-2024", "model-y-2026", "desktop"].includes(testInfo.project.name),
    "Calculator close regression profiles",
  );
  await openRoute(page, "board");
  await page.evaluate(() => (window as any).__vatioboardFloatingTools.openCalculator());
  const calculator = page.locator(".calc-panel");
  await expect(calculator).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await expect(calculator.locator(".calc-utility-btn-label").first()).toBeVisible();
    await expect(calculator.locator(".calc-expr")).toHaveCSS("text-align", "right");
  }
  await calculator.locator(".calc-close").click();

  await expect(calculator).toBeHidden();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__vatioboardFloatingTools.shellManager.getWindow("calculator")?.state
  ))).toBe("closed");

  await page.evaluate(() => (window as any).__vatioboardFloatingTools.openCalculator());
  await expect(calculator).toBeVisible();
});

test("Spanish labels fit the light short-landscape theme", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "model-y-2024-es-light", "Localized visual smoke project");
  await openRoute(page, "speed");
  await expect(page.locator("#langToggle")).toHaveText("ES");
  await expect.poll(() => page.locator(".speed-globe").evaluate((element) => (
    element.getBoundingClientRect().height
  ))).toBeGreaterThanOrEqual(60);
  const localizedMetricRows = await page.locator(".metric-card").evaluateAll((cards) => cards.map((card) => {
    const label = card.querySelector<HTMLElement>(".metric-label")!;
    const unit = card.querySelector<HTMLElement>(".metric-unit")!;
    const labelRect = label.getBoundingClientRect();
    const unitRect = unit.getBoundingClientRect();
    const labelStyle = getComputedStyle(label);
    return {
      aligned: Math.abs(labelRect.top - unitRect.top) <= 3,
      label: label.textContent,
      labelClientWidth: label.clientWidth,
      labelFontSize: labelStyle.fontSize,
      labelScrollWidth: label.scrollWidth,
      separated: labelRect.right <= unitRect.left - 2,
      labelFits: label.scrollWidth <= label.clientWidth + 1,
      unit: unit.textContent,
      unitFits: unit.scrollWidth <= unit.clientWidth + 1,
    };
  }));
  for (const row of localizedMetricRows) {
    const description = JSON.stringify(row);
    expect(row.aligned, description).toBe(true);
    expect(row.separated, description).toBe(true);
    expect(row.labelFits, description).toBe(true);
    expect(row.unitFits, description).toBe(true);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page).toHaveScreenshot("speed-dashboard-es-light.png", {
    animations: "disabled",
    mask: [page.locator("canvas"), page.locator("iframe"), page.locator(".speed-globe")],
    maxDiffPixelRatio: 0.01,
  });

  await page.evaluate(() => (window as any).__vatioboardFloatingTools.openCalculator());
  const calculator = page.locator(".calc-panel");
  await expect(calculator).toBeVisible();
  const localizedUtilities = await calculator.locator(".calc-utility-btn").evaluateAll((buttons) => buttons.map((button) => ({
    accessibleName: button.getAttribute("aria-label"),
    labelDisplay: getComputedStyle(button.querySelector(".calc-utility-btn-label")!).display,
  })));
  expect(localizedUtilities.every((button) => Boolean(button.accessibleName) && button.labelDisplay === "none")).toBe(true);
  const overflowAfterCalculator = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  expect(overflowAfterCalculator).toBeLessThanOrEqual(1);
  await calculator.locator(".calc-close").click();
  await expect(calculator).toBeHidden();

  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4175" });
  await context.setGeolocation({ latitude: 40.7484, longitude: -73.9857, accuracy: 5 });
  await page.route("https://embed.waze.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body style='margin:0;background:#dfe9ef'></body></html>",
  }));
  await openRoute(page, "waze");
  await page.locator("#wazeLocationPrompt").click();
  await expect(page.locator("#wazeFrame")).toHaveAttribute("src", /embed\.waze\.com\/iframe/);
  await expect(page.locator("#wazeRecenter")).toHaveText("Actualizar mapa");
  await expect(page).toHaveScreenshot("waze-map-es-light.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
});

for (const route of ["board", "waze", "accel", "replay", "library", "apps", "delivery-checklist", "qr-scanner", "code-rain"]) {
  test(`${route} has no horizontal document overflow`, async ({ page }, testInfo) => {
    test.skip(!isTeslaProject(testInfo), "Tesla route audit");
    await openRoute(page, route);
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  });
}

test("automatic profile transitions preserve calculator desktop bounds", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "model-y-2024", "Resize transition runs once");
  await openRoute(page, "board");
  await page.evaluate(() => (window as any).__vatioboardFloatingTools.openCalculator());
  const calculator = page.locator(".calc-panel");
  await expect(calculator).toHaveAttribute("data-vb-shell-layout-mode", "short-landscape");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(calculator).not.toHaveAttribute("data-vb-shell-layout-mode", "short-landscape");
  await expect(calculator).toHaveCSS("width", "320px");
  await page.setViewportSize({ width: 773, height: 601 });
  await expect(calculator).toHaveAttribute("data-vb-shell-layout-mode", "short-landscape");
});
