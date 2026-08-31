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

async function seedReplaySession(page: Page, sampleCount = 240) {
  await page.evaluate(async (count) => {
    const modulePath = "/src/replay/session.ts";
    const replay = await import(modulePath);
    const startedAtMs = Date.UTC(2026, 7, 27, 12, 0, 0);
    let session = replay.createReplaySession({
      id: "tesla-replay-fixture",
      startedAtMs,
      unit: "kmh",
      distanceUnit: "m",
      recordingState: "stopped",
    });
    for (let index = 0; index < count; index += 1) {
      session = replay.appendReplaySample(session, {
        timestampMs: startedAtMs + (index * 1000),
        latitude: 40.80 + (index * 0.00012),
        longitude: -73.99 + (index * 0.0001),
        speedMs: 8 + (index % 10),
        altitudeM: 10 + (index * 0.05),
        headingDeg: 34,
        totalDistanceM: index * 12,
      });
    }
    await replay.saveActiveReplaySession(session);
    localStorage.setItem("vatio_replay_playback_rate_v1", "1");
  }, sampleCount);
}

async function seedAccelerationResult(page: Page) {
  await page.evaluate(async () => {
    const { saveRuns } = await import("/src/accel/storage.ts");
    const mphToMs = 0.44704;
    const points = Array.from({ length: 61 }, (_, index) => ({
      elapsedMs: index * 100,
      speedMs: index * mphToMs,
      distanceM: index * 1.8,
      altitudeM: 100 + index * 0.04,
      headingDeg: 12 + index * 0.2,
      accuracyM: 4,
    }));
    const run = {
      id: "tesla-accel-result",
      savedAtMs: Date.UTC(2026, 7, 28, 12, 30, 0),
      presetId: "0-60-mph",
      presetSignature: "0-60-mph",
      comparisonSignature: "launch-4",
      presetKind: "speed",
      standingStart: true,
      startSpeedMs: 0,
      targetSpeedMs: 60 * mphToMs,
      displayUnit: "mph",
      distanceDisplay: "ft",
      elapsedMs: 6000,
      speedTrace: points,
      sampleLog: points.map((point, index) => ({
        ...point,
        index,
        deltaMs: index ? 100 : 0,
        effectiveHz: 10,
        elapsedFromStartMs: point.elapsedMs,
        distanceFromStartM: point.distanceM,
        rawSpeedMs: point.speedMs,
        derivedSpeedMs: point.speedMs,
        latitude: 40.7484 + index * 0.00003,
        longitude: -73.9857 + index * 0.00004,
        stage: "running",
      })),
      partials: Array.from({ length: 18 }, (_, index) => ({
        id: `partial-${index}`,
        kind: "speed",
        labelKey: "accelPreset0to60",
        startSpeedMs: 0,
        targetSpeedMs: Math.min(60, (index + 1) * 3) * mphToMs,
        elapsedMs: Math.min(6000, (index + 1) * 300),
      })),
      finishSpeedMs: 60 * mphToMs,
      rolloutApplied: false,
      launchThresholdMs: 0.5 * mphToMs,
      averageAccuracyM: 4,
      averageHz: 10,
      slopePercent: 0.4,
      elevationDeltaM: 2.4,
      qualityGrade: "good",
      warningKeys: [
        "accelWarningAccuracy",
        "accelWarningSparse",
        "accelWarningStale",
        "accelWarningDerived",
      ],
      notes: "Synthetic Tesla fixture with enough detail to exercise bounded scrolling and compact history rows.",
    };
    await saveRuns(Array.from({ length: 12 }, (_, index) => ({
      ...run,
      id: `tesla-accel-result-${index}`,
      savedAtMs: run.savedAtMs - (index * 86_400_000),
      elapsedMs: run.elapsedMs + (index * 23),
    })));
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
  if (testInfo.project.name.endsWith("-expanded")) expect(profile).toBe("wide-landscape");
  else if (["model-y-2024", "model-y-2026", "model-y-2024-es-light", "phone-landscape"].includes(testInfo.project.name)) expect(profile).toBe("short-landscape");
  else if (testInfo.project.name === "phone-portrait") expect(profile).toBe("portrait");
  else if (testInfo.project.name === "desktop") expect(profile).toBe("wide-landscape");
  else expect(profile).toBe("standard");
});

test("Speed globe keeps status and accessibility without a redundant card title", async ({ page }, testInfo) => {
  await openRoute(page, "speed");
  const globeCard = page.locator(".globe-card");
  const globeStatus = globeCard.locator("#globeStatus");

  if (!(await globeCard.isVisible())) {
    await page.locator('[data-vb-focused-view-target="globe"]').click();
  }

  await expect(globeCard.locator(".globe-card-kicker")).toHaveCount(0);
  await expect(globeCard).toBeVisible();
  await expect(globeCard).toHaveAttribute(
    "aria-label",
    testInfo.project.name === "model-y-2024-es-light"
      ? "Globo de ubicación actual"
      : "Current location globe",
  );
  await expect(globeStatus).toBeVisible();

  const containment = await globeCard.evaluate((card) => {
    const cardRect = card.getBoundingClientRect();
    const headerRect = card.querySelector<HTMLElement>(".globe-card-header")!.getBoundingClientRect();
    const status = card.querySelector<HTMLElement>("#globeStatus")!;
    return {
      contained: headerRect.left >= cardRect.left
        && headerRect.top >= cardRect.top
        && headerRect.right <= cardRect.right
        && headerRect.bottom <= cardRect.bottom,
      statusFits: status.scrollWidth <= status.clientWidth + 1,
    };
  });
  expect(containment.contained).toBe(true);
  expect(containment.statusFits).toBe(true);
});

for (const route of ["speed", "accel", "replay", "waze", "apps", "qr-scanner"]) {
  test(`${route} remains bounded on expanded Tesla and phone landscape`, async ({ page }, testInfo) => {
    test.skip(
      !["model-y-2024-expanded", "model-y-2026-expanded", "phone-landscape"].includes(testInfo.project.name),
      "Expanded responsive geometry audit",
    );
    await openRoute(page, route);
    const geometry = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      routeWidth: document.querySelector<HTMLElement>("#app-view")?.getBoundingClientRect().width || 0,
      viewportWidth: window.visualViewport?.width || window.innerWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.routeWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  });
}

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
    const alertTrigger = document.querySelector<HTMLElement>(".speed-alert-trigger")!;
    const alertLabel = alertTrigger.querySelector<HTMLElement>(".speed-alert-trigger-label")!;
    const alertValue = alertTrigger.querySelector<HTMLElement>(".speed-alert-trigger-value")!;
    const alertIcon = alertTrigger.querySelector<HTMLElement>(".speed-alert-trigger-icon")!;
    const alertChevron = alertTrigger.querySelector<HTMLElement>(".speed-alert-trigger-chevron")!;
    const alertStyle = getComputedStyle(alertTrigger);
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
      alertTriggerContent: {
        chevron: alertChevron.getBoundingClientRect().toJSON(),
        icon: alertIcon.getBoundingClientRect().toJSON(),
        label: alertLabel.getBoundingClientRect().toJSON(),
        paddingBottom: alertStyle.paddingBottom,
        paddingTop: alertStyle.paddingTop,
        value: alertValue.getBoundingClientRect().toJSON(),
      },
      card: rect(".gauge-card"),
      cardStyle: (() => {
        const card = document.querySelector<HTMLElement>(".gauge-card")!;
        const style = getComputedStyle(card);
        return {
          backgroundImage: style.backgroundImage,
          borderTopWidth: style.borderTopWidth,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          beforeContent: getComputedStyle(card, "::before").content,
          afterContent: getComputedStyle(card, "::after").content,
        };
      })(),
      dial: rect(".gauge-stage-inner"),
      gaugeStage: rect(".gauge-stage"),
      primaryStage: rect(".speed-primary-stage"),
      radiusRatio: getComputedStyle(document.querySelector<HTMLElement>(".gauge-stage")!)
        .getPropertyValue("--analog-speedometer-radius-ratio").trim(),
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
  expect(geometry.cardStyle).toMatchObject({
    backgroundImage: "none",
    borderTopWidth: "0px",
    borderRadius: "0px",
    boxShadow: "none",
  });
  expect(["none", "normal"]).toContain(geometry.cardStyle.beforeContent);
  expect(["none", "normal"]).toContain(geometry.cardStyle.afterContent);
  expect(geometry.radiusRatio).toBe("0.46");
  expect(geometry.alertTrigger.height).toBeGreaterThanOrEqual(44);
  expect(geometry.alertTrigger.height).toBeLessThanOrEqual(44.5);
  expect(geometry.alertTriggerContent.paddingTop).toBe("5px");
  expect(geometry.alertTriggerContent.paddingBottom).toBe("5px");
  expect(geometry.alertTriggerContent.label.top - geometry.alertTrigger.top).toBeGreaterThanOrEqual(4);
  expect(geometry.alertTrigger.bottom - geometry.alertTriggerContent.value.bottom).toBeGreaterThanOrEqual(4);
  expect(geometry.alertTriggerContent.label.bottom).toBeLessThanOrEqual(geometry.alertTriggerContent.value.top);
  const alertCenterY = geometry.alertTrigger.top + (geometry.alertTrigger.height / 2);
  const iconCenterY = geometry.alertTriggerContent.icon.top + (geometry.alertTriggerContent.icon.height / 2);
  const chevronCenterY = geometry.alertTriggerContent.chevron.top + (geometry.alertTriggerContent.chevron.height / 2);
  expect(Math.abs(iconCenterY - alertCenterY)).toBeLessThanOrEqual(1);
  expect(Math.abs(chevronCenterY - alertCenterY)).toBeLessThanOrEqual(1);
  const alertStateGeometry = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".gauge-card")!;
    const trigger = card.querySelector<HTMLElement>(".speed-alert-trigger")!;
    const label = trigger.querySelector<HTMLElement>(".speed-alert-trigger-label")!;
    const value = trigger.querySelector<HTMLElement>(".speed-alert-trigger-value")!;
    const originalClassName = card.className;
    const originalPressed = trigger.getAttribute("aria-pressed");
    const originalValue = value.textContent;
    const states = [
      { name: "disabled", classes: [], value: "Tap to configure" },
      { name: "configured", classes: ["is-alert-enabled"], value: "100 km/h" },
      { name: "trap", classes: ["is-alert-enabled", "is-trap-active"], value: "Trap 500 m" },
      { name: "near", classes: ["is-alert-enabled", "is-alert-near"], value: "Near 100 km/h" },
      { name: "overspeed", classes: ["is-alert-enabled", "is-alert-over"], value: "Over 100 km/h" },
    ];

    try {
      return states.map((state) => {
        card.className = ["gauge-card", ...state.classes].join(" ");
        trigger.setAttribute("aria-pressed", String(state.name !== "disabled"));
        value.textContent = state.value;
        const triggerRect = trigger.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        const valueRect = value.getBoundingClientRect();
        return {
          bottomSpace: triggerRect.bottom - valueRect.bottom,
          labelValueGap: valueRect.top - labelRect.bottom,
          name: state.name,
          topSpace: labelRect.top - triggerRect.top,
        };
      });
    } finally {
      card.className = originalClassName;
      if (originalPressed === null) trigger.removeAttribute("aria-pressed");
      else trigger.setAttribute("aria-pressed", originalPressed);
      value.textContent = originalValue;
    }
  });
  for (const state of alertStateGeometry) {
    expect(state.topSpace, state.name).toBeGreaterThanOrEqual(4);
    expect(state.bottomSpace, state.name).toBeGreaterThanOrEqual(4);
    expect(state.labelValueGap, state.name).toBeGreaterThanOrEqual(0);
  }
  expect(Math.abs(geometry.gaugeStage.left - geometry.primaryStage.left)).toBeLessThanOrEqual(2.5);
  expect(Math.abs(geometry.gaugeStage.top - geometry.primaryStage.top)).toBeLessThanOrEqual(2.5);
  expect(Math.abs(geometry.primaryStage.right - geometry.gaugeStage.right)).toBeLessThanOrEqual(2.5);
  expect(Math.abs(geometry.primaryStage.bottom - geometry.gaugeStage.bottom)).toBeLessThanOrEqual(2.5);
  expect(Math.abs(geometry.dial.width - Math.min(geometry.gaugeStage.width, geometry.gaugeStage.height)))
    .toBeLessThanOrEqual(1.5);
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
  await expect(page.locator(".gauge-card")).toHaveScreenshot("speed-gauge-frameless.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
});

test("acceleration dashboard uses a frameless full-size gauge", async ({ page }, testInfo) => {
  test.skip(!isTeslaProject(testInfo), "Exact Tesla geometry assertion");
  await openRoute(page, "accel");
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });

  await expect.poll(() => page.evaluate(() => {
    const dial = document.querySelector<HTMLElement>("#liveSpeedGaugeInner");
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>("#liveSpeedGaugeInner canvas"));
    if (!dial || dial.getBoundingClientRect().width < 400 || canvases.length !== 2) return false;
    return canvases.every((canvas) => (
      Math.abs(canvas.width - Math.floor(canvas.clientWidth * window.devicePixelRatio)) <= 1
      && Math.abs(canvas.height - Math.floor(canvas.clientHeight * window.devicePixelRatio)) <= 1
    ));
  })).toBe(true);

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    const intersects = (first: DOMRect, second: DOMRect) => !(
      first.right <= second.left
      || first.left >= second.right
      || first.bottom <= second.top
      || first.top >= second.bottom
    );
    const primaryCard = document.querySelector<HTMLElement>(".accel-primary-card")!;
    const primaryStage = document.querySelector<HTMLElement>(".accel-primary-stage")!;
    const gaugeStage = document.querySelector<HTMLElement>(".accel-speedometer-stage")!;
    const dial = document.querySelector<HTMLElement>("#liveSpeedGaugeInner")!;
    const setup = document.querySelector<HTMLElement>("#setupTrigger")!;
    const timer = document.querySelector<HTMLElement>(".accel-live-timer-wrap")!;
    const progress = document.querySelector<HTMLElement>(".accel-progress-shell")!;
    const feedback = document.querySelector<HTMLElement>("#actionNotice")!;
    const reading = document.querySelector<HTMLElement>(".analog-speedometer-reading")!;
    const results = document.querySelector<HTMLElement>("#resultsTrigger")!;
    const sideCard = document.querySelector<HTMLElement>(".accel-side-card")!;
    const main = document.querySelector<HTMLElement>(".accel-main")!;
    const taskbar = document.querySelector<HTMLElement>(".vb-shell-taskbar")!;
    const cardStyle = getComputedStyle(primaryCard);
    const sideStyle = getComputedStyle(sideCard);
    const feedbackStyle = getComputedStyle(feedback);
    const canvasGeometry = Array.from(dial.querySelectorAll<HTMLCanvasElement>("canvas")).map((canvas) => ({
      backingHeight: canvas.height,
      backingWidth: canvas.width,
      clientHeight: canvas.clientHeight,
      clientWidth: canvas.clientWidth,
    }));
    const setupRect = setup.getBoundingClientRect();
    const timerRect = timer.getBoundingClientRect();
    const progressRect = progress.getBoundingClientRect();
    const readingRect = reading.getBoundingClientRect();

    return {
      card: rect(".accel-primary-card"),
      cardStyle: {
        backgroundImage: cardStyle.backgroundImage,
        borderTopWidth: cardStyle.borderTopWidth,
        borderRadius: cardStyle.borderRadius,
        boxShadow: cardStyle.boxShadow,
        beforeContent: getComputedStyle(primaryCard, "::before").content,
      },
      canvases: canvasGeometry,
      devicePixelRatio: window.devicePixelRatio,
      dial: rect("#liveSpeedGaugeInner"),
      feedbackDisplay: feedbackStyle.display,
      feedbackPosition: feedbackStyle.position,
      gaugeStage: gaugeStage.getBoundingClientRect().toJSON(),
      mainClientHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight,
      overlayCollisions: {
        progressTimer: intersects(progressRect, timerRect),
        setupReading: intersects(setupRect, readingRect),
        timerReading: intersects(timerRect, readingRect),
      },
      overlayPositions: {
        progress: getComputedStyle(progress).position,
        setup: getComputedStyle(setup).position,
        timer: getComputedStyle(timer).position,
      },
      primaryStage: primaryStage.getBoundingClientRect().toJSON(),
      radiusRatio: getComputedStyle(gaugeStage)
        .getPropertyValue("--analog-speedometer-radius-ratio").trim(),
      results: results.getBoundingClientRect().toJSON(),
      setup: setupRect.toJSON(),
      sideCard: sideCard.getBoundingClientRect().toJSON(),
      sideStyle: {
        backgroundImage: sideStyle.backgroundImage,
        borderTopWidth: sideStyle.borderTopWidth,
        borderRadius: sideStyle.borderRadius,
        boxShadow: sideStyle.boxShadow,
        overflowY: sideStyle.overflowY,
      },
      taskbar: taskbar.getBoundingClientRect().toJSON(),
      timer: timerRect.toJSON(),
      viewportHeight: document.documentElement.clientHeight,
      viewportWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });

  expect(geometry.cardStyle).toMatchObject({
    backgroundImage: "none",
    borderTopWidth: "0px",
    borderRadius: "0px",
    boxShadow: "none",
  });
  expect(["none", "normal"]).toContain(geometry.cardStyle.beforeContent);
  expect(geometry.sideStyle).toMatchObject({
    backgroundImage: "none",
    borderTopWidth: "0px",
    borderRadius: "0px",
    boxShadow: "none",
    overflowY: "hidden",
  });
  expect(geometry.radiusRatio).toBe("0.46");
  expect(geometry.dial.width).toBeGreaterThanOrEqual(400);
  expect(geometry.dial.width * 0.92).toBeGreaterThanOrEqual(geometry.dial.width * 0.9);
  expect(Math.abs(geometry.dial.width - Math.min(geometry.gaugeStage.width, geometry.gaugeStage.height)))
    .toBeLessThanOrEqual(1.5);
  expect(Math.abs(geometry.gaugeStage.left - geometry.primaryStage.left)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(geometry.gaugeStage.top - geometry.primaryStage.top)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(geometry.primaryStage.left - geometry.card.left)).toBeLessThanOrEqual(2.5);
  expect(Math.abs(geometry.primaryStage.top - geometry.card.top)).toBeLessThanOrEqual(2.5);
  expect(geometry.setup.height).toBeGreaterThanOrEqual(44);
  expect(geometry.results.height).toBeGreaterThanOrEqual(44);
  expect(geometry.overlayPositions).toEqual({
    progress: "absolute",
    setup: "absolute",
    timer: "absolute",
  });
  expect(geometry.overlayCollisions).toEqual({
    progressTimer: false,
    setupReading: false,
    timerReading: false,
  });
  expect(geometry.feedbackDisplay).toBe("none");
  expect(geometry.feedbackPosition).toBe("absolute");
  expect(geometry.sideCard.bottom).toBeLessThanOrEqual(geometry.taskbar.top + 1);
  expect(geometry.mainScrollHeight).toBeLessThanOrEqual(geometry.mainClientHeight + 1);
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  const expectedDpr = testInfo.project.name === "model-y-2024" ? 1.53 : 1.96;
  expect(geometry.devicePixelRatio).toBeCloseTo(expectedDpr, 2);
  for (const canvas of geometry.canvases) {
    expect(Math.abs(canvas.backingWidth - Math.floor(canvas.clientWidth * geometry.devicePixelRatio)))
      .toBeLessThanOrEqual(1);
    expect(Math.abs(canvas.backingHeight - Math.floor(canvas.clientHeight * geometry.devicePixelRatio)))
      .toBeLessThanOrEqual(1);
  }

  const stageHeightBeforeFeedback = geometry.primaryStage.height;
  await page.locator("#actionNotice").evaluate((element) => { element.textContent = "GPS ready"; });
  await expect(page.locator("#actionNotice")).toBeVisible();
  await expect.poll(() => page.locator(".accel-primary-stage").evaluate((element) => (
    element.getBoundingClientRect().height
  ))).toBe(stageHeightBeforeFeedback);
  await page.locator("#actionNotice").evaluate((element) => { element.textContent = ""; });

  await page.locator("#setupTrigger").click();
  await expect(page.locator("#setupPanel")).toBeVisible();
  await page.locator("#closeSetupPanel").click();
  await expect(page.locator("#setupPanel")).toBeHidden();
  await page.locator("#resultsTrigger").click();
  await expect(page.locator("#resultsPanel")).toBeVisible();
  await page.locator("#closeResultsPanel").click();
  await expect(page.locator("#resultsPanel")).toBeHidden();

  const partialScroll = await page.locator("#livePartialsSection").evaluate((section) => {
    const list = section.querySelector<HTMLElement>("#livePartialsList")!;
    section.hidden = false;
    list.innerHTML = Array.from({ length: 18 }, (_, index) => (
      `<div class="accel-partial-row"><span>Partial ${index + 1}</span><strong>${index}.000 s</strong></div>`
    )).join("");
    return {
      clientHeight: section.clientHeight,
      overflowY: getComputedStyle(section).overflowY,
      scrollHeight: section.scrollHeight,
    };
  });
  expect(partialScroll.overflowY).toBe("auto");
  expect(partialScroll.scrollHeight).toBeGreaterThan(partialScroll.clientHeight);
  await page.locator("#livePartialsSection").evaluate((section) => {
    section.hidden = true;
    section.querySelector<HTMLElement>("#livePartialsList")!.replaceChildren();
  });

  await expect(page).toHaveScreenshot("accel-dashboard.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
  await expect(page.locator(".accel-primary-card")).toHaveScreenshot("accel-gauge-frameless.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
});

test("acceleration results use focused short-landscape workspaces", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("model-y-"), "Exact Tesla geometry assertion");
  test.setTimeout(240_000);
  const transparentTile = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.route(/(tiles\.maps\.eox\.at|services\.arcgisonline\.com)/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: transparentTile })
  );
  await openRoute(page, "board");
  await seedAccelerationResult(page);
  await openRoute(page, "accel");
  await expect(page.locator("#accelToolbarResults")).toBeEnabled();
  await page.locator("#accelToolbarResults").click();

  const panel = page.locator("#resultsPanel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-accel-result-view", "summary");
  await expect(panel).toHaveAttribute("role", "region");
  await expect(panel).not.toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".accel-shell")).toHaveAttribute("inert", "");
  await expect.poll(() => page.locator("#resultGraphCanvas").evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return rect.width >= 480 && rect.height >= 220;
  })).toBe(true);

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!
      .getBoundingClientRect().toJSON();
    const partials = document.querySelector<HTMLElement>("#resultPartialsList")!;
    return {
      graph: rect("#resultGraphCanvas"),
      panel: rect("#resultsPanel"),
      partialsClientHeight: partials.clientHeight,
      partialsOverflowY: getComputedStyle(partials).overflowY,
      partialsScrollHeight: partials.scrollHeight,
      pageOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    };
  });
  const workArea = await getWorkArea(page);
  expect(geometry.panel.left).toBeCloseTo(workArea.left, 0);
  expect(geometry.panel.top).toBeCloseTo(workArea.top, 0);
  expect(geometry.panel.width).toBeCloseTo(workArea.width, 0);
  expect(geometry.panel.height).toBeCloseTo(workArea.height, 0);
  expect(geometry.graph.width).toBeGreaterThanOrEqual(480);
  expect(geometry.graph.height).toBeGreaterThanOrEqual(220);
  expect(geometry.partialsOverflowY).toBe("auto");
  expect(geometry.partialsScrollHeight).toBeGreaterThan(geometry.partialsClientHeight);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);

  const partialRows = page.locator("#resultPartialsList .accel-partial-row");
  await expect(partialRows).toHaveCount(18);
  const firstPartialBounds = await partialRows.nth(0).boundingBox();
  const secondPartialBounds = await partialRows.nth(1).boundingBox();
  expect(firstPartialBounds).not.toBeNull();
  expect(secondPartialBounds).not.toBeNull();
  expect(secondPartialBounds!.y).toBeGreaterThanOrEqual(
    firstPartialBounds!.y + firstPartialBounds!.height - 1
  );
  await partialRows.last().scrollIntoViewIfNeeded();
  await expect(partialRows.last()).toBeVisible();

  await page.locator('[data-accel-result-view-action="map"]').click();
  await expect(panel).toHaveAttribute("data-accel-result-view", "map");
  await expect(page.locator("#resultReplayMap")).toBeVisible();
  await expect.poll(() => page.locator("#resultReplayMap").evaluate((map) => {
    const rect = map.getBoundingClientRect();
    return rect.width > 600 && rect.height > 300;
  })).toBe(true);
  const mapGeometry = await page.evaluate(() => {
    const map = document.querySelector<HTMLElement>("#resultReplayMap")!.getBoundingClientRect();
    const controls = document.querySelector<HTMLElement>("#resultReplayControls")!.getBoundingClientRect();
    return { map: map.toJSON(), controls: controls.toJSON() };
  });
  expect(mapGeometry.controls.left).toBeGreaterThanOrEqual(mapGeometry.map.left);
  expect(mapGeometry.controls.right).toBeLessThanOrEqual(mapGeometry.map.right);
  expect(mapGeometry.controls.bottom).toBeLessThanOrEqual(mapGeometry.map.bottom);

  await page.locator('[data-accel-result-view-action="charts"]').click();
  await expect(page.locator("#resultReplayChartSheet")).toBeVisible();
  await expect(page.locator(".accel-replay-chart-stage:visible")).toHaveCount(1);
  const chartGeometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!
      .getBoundingClientRect().toJSON();
    return {
      sheet: rect("#resultReplayChartSheet"),
      header: rect(".accel-replay-chart-sheet-header"),
      filter: rect(".accel-replay-filter-group"),
      stage: rect(".accel-replay-chart-stage:not([hidden])"),
    };
  });
  expect(chartGeometry.header.top).toBeGreaterThanOrEqual(chartGeometry.sheet.top);
  expect(chartGeometry.filter.top).toBeGreaterThanOrEqual(chartGeometry.header.bottom);
  expect(chartGeometry.stage.top).toBeGreaterThanOrEqual(chartGeometry.filter.bottom);
  expect(chartGeometry.stage.bottom).toBeLessThanOrEqual(chartGeometry.sheet.bottom);
  await page.locator('[data-accel-result-chart-metric="altitudeM"]').click();
  await expect(page.locator("#resultReplaySheetAltitudeStage")).toBeVisible();
  await expect(page.locator(".accel-replay-chart-stage:visible")).toHaveCount(1);
  await page.locator("#closeResultReplayChartSheet").click();

  await page.locator('[data-accel-result-view-action="details"]').click();
  await expect(page.locator("#debugRawTableBody tr")).toHaveCount(0);
  await expect.poll(() => page.locator("#resultsPanel > .accel-sheet-body").evaluate((body) => ({
    overflowY: getComputedStyle(body).overflowY,
    canScroll: body.scrollHeight > body.clientHeight,
  }))).toEqual({ overflowY: "auto", canScroll: true });
  await page.locator("#resultTechnicalDataToggle").scrollIntoViewIfNeeded();
  await expect(page.locator("#resultTechnicalDataToggle")).toBeVisible();
  await page.locator("#resultTechnicalDataToggle").click();
  await expect.poll(() => page.locator("#debugRawTableBody tr").count()).toBeGreaterThan(0);
  await expect(page.locator("#debugRawTableWrap")).toHaveCSS("overflow", "auto");
  await page.locator('[data-accel-result-view-action="history"]').click();
  await expect(page.locator(".accel-history-card")).toBeVisible();
  const historyRows = page.locator("#historyList .accel-history-item");
  await expect(historyRows).toHaveCount(12);
  await expect.poll(() => page.locator("#historyList").evaluate((list) => ({
    overflowY: getComputedStyle(list).overflowY,
    canScroll: list.scrollHeight > list.clientHeight,
  }))).toEqual({ overflowY: "auto", canScroll: true });
  await expect(historyRows.first().locator('[data-history-action="replay"]')).toBeVisible();
  await expect(historyRows.first().locator('[data-history-action="replay"]')).toHaveJSProperty("offsetHeight", 44);
  await historyRows.last().scrollIntoViewIfNeeded();
  await expect(historyRows.last()).toBeVisible();
  await historyRows.first().locator('[data-history-action="load"]').click();
  await expect(panel).toHaveAttribute("data-accel-result-view", "summary");

  await page.locator("#closeResultsPanel").click();
  await expect(panel).toBeHidden();
  await expect(page.locator(".accel-shell")).not.toHaveAttribute("inert", "");
});

test("replay is map-first and playback advances without waiting for camera animation", async ({ page }, testInfo) => {
  test.skip(!isTeslaProject(testInfo), "Exact Tesla geometry assertion");
  const transparentTile = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.route(/(tiles\.maps\.eox\.at|services\.arcgisonline\.com)/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: transparentTile })
  );
  await openRoute(page, "board");
  await seedReplaySession(page);

  await openRoute(page, "replay");
  await expect(page.locator("#replayShell")).toBeVisible();
  await expect(page.locator("#replayMap canvas")).toBeVisible();

  const geometry = await page.evaluate(() => {
    const map = document.querySelector<HTMLElement>("#replayMap")!;
    const stage = document.querySelector<HTMLElement>(".replay-stage")!;
    const mapRect = map.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    return {
      map: mapRect.toJSON(),
      stage: stageRect.toJSON(),
      graphsDisplay: getComputedStyle(document.querySelector<HTMLElement>(".replay-graphs-card")!).display,
      detailsDisplay: getComputedStyle(document.querySelector<HTMLElement>(".replay-side-panel")!).display,
      recordingsDisplay: getComputedStyle(document.querySelector<HTMLElement>(".replay-recordings-section")!).display,
      bodyScrollWidth: document.body.scrollWidth,
      bodyScrollHeight: document.body.scrollHeight,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      controls: Array.from(document.querySelectorAll<HTMLElement>(".replay-panel-action,.replay-map-action,.replay-rate-toggle"))
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => element.getBoundingClientRect().toJSON()),
    };
  });

  expect(geometry.graphsDisplay).toBe("none");
  expect(geometry.detailsDisplay).toBe("none");
  expect(geometry.recordingsDisplay).toBe("none");
  expect(Math.abs(geometry.map.left - geometry.stage.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.map.top - geometry.stage.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.map.right - geometry.stage.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.map.bottom - geometry.stage.bottom)).toBeLessThanOrEqual(1);
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.bodyScrollHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  for (const control of geometry.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }

  await page.locator('[data-replay-action="play"]').click();
  await expect(page.locator('[data-replay-action="play"]')).toHaveAttribute("aria-label", "Pause");
  await expect.poll(async () => Number(await page.locator("#replayProgress").inputValue())).toBeGreaterThan(0);

  await page.locator("#replayOpenRecordings").click();
  await expect(page.locator('.replay-recordings-section[data-panel-open="true"]')).toBeVisible();
  await expect(page.locator("#replayPanelBackdrop")).toBeVisible();
  await page.locator(".replay-recordings-section [data-replay-close-panel]").click();
  await expect(page.locator(".replay-recordings-section")).not.toBeVisible();

  await page.locator("#replayOpenDetails").click();
  await expect(page.locator('.replay-side-panel[data-panel-open="true"]')).toBeVisible();
  const details = await page.locator(".replay-side-panel").boundingBox();
  const workArea = await getWorkArea(page);
  expect(details).not.toBeNull();
  expect(details!.x + details!.width).toBeLessThanOrEqual(workArea.left + workArea.width + 1);
  expect(details!.y + details!.height).toBeLessThanOrEqual(workArea.top + workArea.height + 1);
});

test("Spanish Replay controls fit the light Tesla layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "model-y-2024-es-light", "Localized Replay smoke project");
  await openRoute(page, "board");
  await seedReplaySession(page, 8);
  await openRoute(page, "replay");
  await expect(page.locator("#replayShell")).toBeVisible();
  await expect(page.locator("#replayOpenRecordings")).toHaveAttribute("aria-label", "Grabaciones");
  await expect(page.locator("#replayOpenCharts")).toHaveAttribute("aria-label", "Gráficos");
  await expect(page.locator("#replayOpenDetails")).toHaveAttribute("aria-label", "Detalles");
  await expect(page.locator('[data-replay-action="overview"]')).toHaveAttribute(
    "aria-label",
    "Vista general de la ruta"
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
});

test("acceleration selects its desktop or focused portrait geometry", async ({ page }, testInfo) => {
  test.skip(!["desktop", "phone-portrait"].includes(testInfo.project.name), "Non-Tesla responsive assertion");
  await openRoute(page, "accel");
  const expectedRadius = testInfo.project.name === "phone-portrait" ? "0.46" : "0.42";
  await expect.poll(() => page.locator(".accel-speedometer-stage").evaluate((stage) => (
    getComputedStyle(stage).getPropertyValue("--analog-speedometer-radius-ratio").trim()
  ))).toBe(expectedRadius);

  const layout = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".accel-speedometer-stage")!;
    const progress = document.querySelector<HTMLElement>(".accel-progress-shell")!;
    return {
      profile: document.documentElement.dataset.vbLayoutProfile,
      progressPosition: getComputedStyle(progress).position,
      radiusRatio: getComputedStyle(stage)
        .getPropertyValue("--analog-speedometer-radius-ratio").trim(),
    };
  });

  expect(layout.profile).toBe(testInfo.project.name === "phone-portrait" ? "portrait" : "standard");
  expect(layout.progressPosition).toBe(testInfo.project.name === "phone-portrait" ? "absolute" : "static");
  expect(layout.radiusRatio).toBe(expectedRadius);
  if (testInfo.project.name === "phone-portrait") {
    await expect(page.locator(".accel-focused-nav")).toBeVisible();
    await expect(page.locator("#accelGaugePanel")).toBeVisible();
  }
});

test("Spanish acceleration summaries fit the light short-landscape theme", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "model-y-2024-es-light", "Localized Acceleration visual smoke project");
  await openRoute(page, "accel");

  const summaries = await page.locator("#setupTrigger, #resultsTrigger").evaluateAll((triggers) => (
    triggers.map((trigger) => {
      const label = trigger.querySelector<HTMLElement>(".accel-sheet-trigger-label")!;
      const value = trigger.querySelector<HTMLElement>(".accel-sheet-trigger-value")!;
      const meta = trigger.querySelector<HTMLElement>(".accel-sheet-trigger-meta")!;
      return {
        accessibleName: trigger.getAttribute("aria-label") || trigger.textContent?.trim(),
        labelFits: label.scrollWidth <= label.clientWidth + 1,
        metaContained: meta.getBoundingClientRect().right <= trigger.getBoundingClientRect().right + 1,
        valueContained: value.getBoundingClientRect().right <= trigger.getBoundingClientRect().right + 1,
      };
    })
  ));
  for (const summary of summaries) {
    const description = JSON.stringify(summary);
    expect(Boolean(summary.accessibleName), description).toBe(true);
    expect(summary.labelFits, description).toBe(true);
    expect(summary.metaContained, description).toBe(true);
    expect(summary.valueContained, description).toBe(true);
  }
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(1);
  await expect(page).toHaveScreenshot("accel-dashboard-es-light.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
});

test("Waze route fills the viewport edge to edge with an overlaid driving HUD", async ({ page, context }, testInfo) => {
  test.skip(!isTeslaProject(testInfo), "Exact Tesla geometry assertion");
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:4175" });
  await context.setGeolocation({ latitude: 40.7484, longitude: -73.9857, accuracy: 5 });
  await page.route("https://embed.waze.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body style='margin:0;background:#dfe9ef'></body></html>",
  }));
  await openRoute(page, "waze");
  await expect(page.locator(".waze-placeholder-icon svg")).toBeVisible();
  await page.locator("#wazeLocationPrompt").click();
  await expect(page.locator("#wazeFrame")).toHaveAttribute("src", /embed\.waze\.com\/iframe/);
  await expect(page.locator(".waze-brand-icon svg")).toBeVisible();
  await expect(page.locator("#wazeLocationPrompt")).toHaveAttribute("aria-label", "Enable Waze location");
  await expect(page.locator("#wazeRecenter")).toHaveAttribute("aria-label", "Refresh map");
  await expect(page.locator(".waze-hud-actions")).toHaveAttribute("role", "toolbar");
  await expect(page.locator(".waze-toolbar-btn:visible")).toHaveCount(5);
  await page.evaluate(() => {
    (window as any).__vatioboardDrivingAlerts?.setManualAlertEnabled?.(true, {
      fromUserGesture: false,
      startIfNeeded: true,
    });
  });
  await page.locator("#quickAudioToggle").click();
  await page.locator("#quickAudioToggle").click();
  await expect(page.locator(".activity-indicator")).toBeVisible();

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    const app = document.querySelector<HTMLElement>(".waze-app")!;
    const mapShell = document.querySelector<HTMLElement>(".waze-map-shell")!;
    const controls = Array.from(document.querySelectorAll<HTMLElement>(".waze-hud-actions button:not([hidden])")).map((button) => {
      const bounds = button.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    return {
      app: rect(".waze-app"),
      brandBadge: rect(".waze-brand-icon"),
      brandIcon: rect(".waze-brand-icon svg"),
      frame: rect("#wazeFrame"),
      hud: rect(".waze-hud"),
      speedPill: rect("#wazeSpeedPill"),
      actions: rect(".waze-hud-actions"),
      activityIndicator: rect(".activity-indicator"),
      taskbar: rect(".vb-shell-taskbar"),
      controls,
      appPadding: getComputedStyle(app).padding,
      mapBorderWidth: getComputedStyle(mapShell).borderTopWidth,
      mapBorderRadius: getComputedStyle(mapShell).borderTopLeftRadius,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
    };
  });
  const workArea = await getWorkArea(page);

  expect(Math.abs(geometry.app.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.app.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.app.width - geometry.documentClientWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.app.height - geometry.documentClientHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.frame.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.frame.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.frame.width - geometry.documentClientWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.frame.height - geometry.documentClientHeight)).toBeLessThanOrEqual(1);
  expect(geometry.appPadding).toBe("0px");
  expect(geometry.mapBorderWidth).toBe("0px");
  expect(geometry.mapBorderRadius).toBe("0px");
  expect(geometry.app.bottom).toBeGreaterThanOrEqual(geometry.taskbar.bottom);
  expect(geometry.brandBadge.width).toBeGreaterThanOrEqual(30);
  expect(geometry.brandBadge.height).toBeGreaterThanOrEqual(30);
  expect(geometry.brandIcon.width).toBeGreaterThanOrEqual(18);
  expect(geometry.brandIcon.height).toBeGreaterThanOrEqual(18);
  expect(geometry.hud.left).toBeGreaterThanOrEqual(workArea.left);
  expect(geometry.hud.right).toBeLessThanOrEqual(workArea.left + workArea.width);
  expect(geometry.hud.bottom).toBeLessThanOrEqual(workArea.top + workArea.height);
  expect(Math.abs((geometry.actions.left + geometry.actions.right) / 2 - geometry.app.width / 2)).toBeLessThanOrEqual(1);
  expect(geometry.actions.top).toBeGreaterThanOrEqual(0);
  expect(geometry.actions.top).toBeLessThanOrEqual(12);
  expect(geometry.actions.bottom).toBeLessThan(geometry.speedPill.top);
  expect(geometry.documentClientWidth - geometry.activityIndicator.right).toBeLessThanOrEqual(1);
  expect(geometry.documentClientHeight - geometry.activityIndicator.bottom).toBeLessThanOrEqual(1);
  for (const control of geometry.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }
  await page.locator("#quickAlertConfig").click();
  await expect(page.locator(".speed-alert-window")).toBeVisible();
  await page.locator(".speed-alert-window-close").click();
  await expect(page.locator(".speed-alert-window")).toBeHidden();
  await page.locator("#toggleRecording").click();
  await expect(page.locator("#toggleRecording")).toHaveAttribute("aria-label", "Pause recording");
  await expect(page.locator("#stopRecording")).toBeVisible();
  await expect(page.locator(".waze-toolbar-btn:visible")).toHaveCount(6);
  const activeToolbar = await page.locator(".waze-hud-actions").evaluate((toolbar) => {
    const bounds = toolbar.getBoundingClientRect();
    const controls = Array.from(toolbar.querySelectorAll<HTMLElement>("button:not([hidden])")).map((button) => {
      const controlBounds = button.getBoundingClientRect();
      return { width: controlBounds.width, height: controlBounds.height };
    });
    return { left: bounds.left, right: bounds.right, controls };
  });
  expect(Math.abs((activeToolbar.left + activeToolbar.right) / 2 - geometry.app.width / 2)).toBeLessThanOrEqual(1);
  expect(activeToolbar.left).toBeGreaterThanOrEqual(0);
  expect(activeToolbar.right).toBeLessThanOrEqual(geometry.app.width);
  expect(activeToolbar.controls.every((control) => control.width >= 44 && control.height >= 44)).toBe(true);
  await page.locator("#toggleRecording").click();
  await expect(page.locator("#toggleRecording")).toHaveAttribute("aria-label", "Resume recording");
  await page.locator("#toggleRecording").click();
  await page.locator("#stopRecording").click();
  await expect(page.locator("#stopRecording")).toBeHidden();
  const initialViewport = page.viewportSize()!;
  await page.setViewportSize({
    width: initialViewport.width - 24,
    height: initialViewport.height - 20,
  });
  await expect.poll(() => page.locator(".activity-indicator").evaluate((indicator) => {
    const bounds = indicator.getBoundingClientRect();
    return {
      rightGap: document.documentElement.clientWidth - bounds.right,
      bottomGap: document.documentElement.clientHeight - bounds.bottom,
    };
  })).toEqual({ rightGap: 0, bottomGap: 0 });
  await page.setViewportSize(initialViewport);
  await expect.poll(() => page.locator(".activity-indicator").evaluate((indicator) => {
    const bounds = indicator.getBoundingClientRect();
    return {
      rightGap: document.documentElement.clientWidth - bounds.right,
      bottomGap: document.documentElement.clientHeight - bounds.bottom,
    };
  })).toEqual({ rightGap: 0, bottomGap: 0 });
  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth + 1);
  expect(geometry.documentScrollHeight).toBeLessThanOrEqual(geometry.documentClientHeight + 1);
  await expect(page).toHaveScreenshot("waze-map.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
});

test("persistent shell tools and background driving state survive Waze and Replay navigation", async ({ page }, testInfo) => {
  test.skip(!isTeslaProject(testInfo), "Tesla shell continuity coverage");
  await page.route("https://embed.waze.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body style='margin:0;background:#dfe9ef'></body></html>",
  }));
  await openRoute(page, "board");

  await page.evaluate(() => {
    const shellWindow = (window as any).__vatioboardFloatingTools;
    shellWindow.openCalculator();
    (window as any).__vatioboardPlayerWidget.open();
  });
  await expect(page.locator(".calc-panel")).toBeVisible();
  await expect(page.locator(".player-panel")).toBeVisible();
  await page.locator(".calc-keys .calc-key", { hasText: "7" }).click();

  const openLauncherApp = async (appId: string, panelSelector: string) => {
    const launcher = page.locator("#appStartMenuList");
    if (!(await launcher.isVisible())) {
      await page.locator("[data-vb-shell-start-button]").click();
    }
    await expect(launcher).toBeVisible();
    const tile = page.locator(`.vb-app-launcher-tile-main[data-app-id='${appId}']`);
    const pageIndex = await tile.evaluate((element) => (
      element.closest<HTMLElement>("[data-vb-app-launcher-page]")?.dataset.page || "0"
    ));
    await launcher.locator(`.vb-app-launcher-page-dot[data-page='${pageIndex}']`).click();
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(page.locator(panelSelector)).toBeVisible();
  };
  await openLauncherApp("vatio.premiumClock", ".premium-clock-panel");
  await openLauncherApp("vatio.tts", ".tts-panel");
  await page.locator("[data-tts-text]").fill("Continue speaking across applications");

  await page.evaluate(() => {
    const identities = [
      [".calc-panel", "calculator"],
      [".player-panel", "player"],
      [".premium-clock-panel", "clock"],
      [".tts-panel", "tts"],
    ];
    for (const [selector, identity] of identities) {
      document.querySelector<HTMLElement>(selector)!.dataset.continuityIdentity = identity;
    }
    (window as any).__vatioboardDriveRecording.startRecording({ source: "continuity-test" });
    (window as any).__vatioboardDrivingAlerts.setManualAlertEnabled(true, {
      fromUserGesture: false,
      startIfNeeded: true,
    });
  });

  const assertContinuity = async (route: string) => {
    await page.evaluate((nextRoute) => {
      window.location.hash = `#/${nextRoute}`;
    }, route);
    await expect(page.locator("#app-view")).toHaveAttribute("data-vb-route", route);
    for (const [selector, identity] of [
      [".calc-panel", "calculator"],
      [".player-panel", "player"],
      [".premium-clock-panel", "clock"],
      [".tts-panel", "tts"],
    ]) {
      await expect(page.locator(selector)).toHaveAttribute("data-continuity-identity", identity);
      await expect(page.locator(selector)).toBeVisible();
    }
    const state = await page.evaluate(() => ({
      alert: (window as any).__vatioboardDrivingAlerts.getSnapshot(),
      calculator: (window as any).__vatioboardFloatingTools.shellManager.getWindow("calculator")?.state,
      clock: (window as any).__vatioboardFloatingTools.shellManager.getWindow("premium-clock")?.state,
      player: (window as any).__vatioboardFloatingTools.shellManager.getWindow("player")?.state,
      recording: (window as any).__vatioboardDriveRecording.getSnapshot(),
      tts: (window as any).__vatioboardFloatingTools.shellManager.getWindow("tts")?.state,
    }));
    expect(state.alert.started).toBe(true);
    expect(state.recording.state).toBe("recording");
    expect(state.calculator).toBe("open");
    expect(state.clock).toBe("open");
    expect(state.player).toBe("open");
    expect(state.tts).toBe("open");
    await expect(page.locator(".calc-expr")).toHaveValue("7");
    await expect(page.locator("[data-tts-text]")).toHaveValue("Continue speaking across applications");
  };

  for (const route of ["speed", "accel", "waze", "replay", "board"]) {
    await assertContinuity(route);
  }

  const finalAlertSnapshot = await page.evaluate(() => {
    const alerts = (window as any).__vatioboardDrivingAlerts;
    const snapshot = alerts.getSnapshot();
    void (window as any).__vatioboardDriveRecording.stopRecording();
    alerts.setManualAlertEnabled(false, { startIfNeeded: true });
    return snapshot;
  });
  expect(finalAlertSnapshot.consumers).not.toContain("vatio.waze.route");
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
  ))).toBeGreaterThanOrEqual(176);
  await expect(page.locator(".globe-card-kicker")).toHaveCount(0);
  await expect(page.locator(".globe-card")).toHaveAttribute("aria-label", "Current location globe");
  const statusFits = await page.locator("#globeStatus").evaluate((status) => (
    status.scrollWidth <= status.clientWidth + 1
  ));
  expect(statusFits).toBe(true);
  const initialGlobeHeight = await page.locator(".speed-globe").evaluate((element) => (
    element.getBoundingClientRect().height
  ));

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
      globeHeader: rect(globeCard.querySelector<HTMLElement>(".globe-card-header")!),
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
  expect(geometry.globe.height).toBeGreaterThanOrEqual(176);
  expect(Math.abs(geometry.globe.top - geometry.globeCard.top)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(geometry.globe.bottom - geometry.globeCard.bottom)).toBeLessThanOrEqual(1.5);
  expect(geometry.globeHeader.top).toBeGreaterThanOrEqual(geometry.globe.top);
  expect(geometry.globeHeader.bottom).toBeLessThanOrEqual(geometry.globe.bottom);
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
    .toBeGreaterThanOrEqual(176);
  expect(await page.locator(".speed-globe").evaluate((element) => element.getBoundingClientRect().height))
    .toBeCloseTo(initialGlobeHeight, 0);
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

  await page.evaluate(() => (
    (window as any).__vatioboardFloatingTools.calcWidget.setExpression("40-31.37")
  ));
  await calculator.locator(".calc-key.eq").click();
  await expect.poll(calculatorApi).toBe("8.63");
  await expect(calculator.locator(".calc-expr")).toHaveValue("8.63");

  await calculator.locator(".calc-history-btn").click();
  await expect(calculator.locator(".calc-history-item-result").first()).toHaveText("8.63");
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
  ))).toBeGreaterThanOrEqual(176);
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
  const localizedAlertGeometry = await page.locator("#alertTrigger").evaluate((trigger) => {
    const label = trigger.querySelector<HTMLElement>(".speed-alert-trigger-label")!;
    const value = trigger.querySelector<HTMLElement>(".speed-alert-trigger-value")!;
    const triggerRect = trigger.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const valueRect = value.getBoundingClientRect();
    return {
      bottomSpace: triggerRect.bottom - valueRect.bottom,
      labelValueGap: valueRect.top - labelRect.bottom,
      topSpace: labelRect.top - triggerRect.top,
      valueFits: value.scrollWidth <= value.clientWidth + 1,
    };
  });
  expect(localizedAlertGeometry.topSpace).toBeGreaterThanOrEqual(4);
  expect(localizedAlertGeometry.bottomSpace).toBeGreaterThanOrEqual(4);
  expect(localizedAlertGeometry.labelValueGap).toBeGreaterThanOrEqual(0);
  expect(localizedAlertGeometry.valueFits).toBe(true);
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
  await expect(page.locator("#wazeLocationPrompt")).toHaveAttribute("aria-label", "Activar ubicacion de Waze");
  await expect(page.locator("#wazeRecenter")).toHaveAttribute("aria-label", "Actualizar mapa");
  await expect(page.locator("#quickAlertConfig")).toHaveAttribute("aria-label", "Configurar alertas");
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
