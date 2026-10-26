import { expect, test as base, type Page } from "@playwright/test";
import { createStreamingRadio } from "../helpers/streaming-radio.js";
import { nativeLifecycleBrowser } from "../helpers/native-lifecycle-browser.js";

const test = base.extend<{ autoplayPolicy: string; nativeLifecycle: boolean }>({
  nativeLifecycle: [false, { option: true }],
  autoplayPolicy: ["no-user-gesture-required", { option: true }],
  page: async ({ playwright, autoplayPolicy, baseURL, viewport, nativeLifecycle }, use) => {
    if (nativeLifecycle) {
      const native = await nativeLifecycleBrowser(playwright.chromium, autoplayPolicy);
      try {
        const page = native.browser.contexts()[0].pages()[0];
        if (viewport) await page.setViewportSize(viewport);
        await use(page);
      } finally { await native.close(); }
      return;
    }
    const browser = await playwright.chromium.launch({ args: [
      `--autoplay-policy=${autoplayPolicy}`,
      "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies",
    ] });
    const context = await browser.newContext({ baseURL, viewport, locale: "en-US" });
    try { await use(await context.newPage()); }
    finally { await browser.close(); }
  },
});

function audioFixture() {
  const samples = 8000 * 20;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(2200 * Math.sin(i * Math.PI * 440 / 8000)), 44 + i * 2);
  return wav;
}

async function fixtures(page: Page) {
  await page.route("**/api/method/**", route => route.fulfill({
    json: { message: { connected: false, is_guest: true } },
    headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:4175", "Access-Control-Allow-Credentials": "true" },
  }));
  await page.route("**/audio/demo/playlist.json", route => route.fulfill({ json: [
    { name: "demo:focus", title: "Recovery demo", media_kind: "audio", src: "/audio/demo/focus.wav", duration: 20, _demo: true },
  ] }));
  await page.route("**/audio/demo/focus.wav", route => route.fulfill({ contentType: "audio/wav", body: audioFixture() }));
  await page.route("**/v1/stations/*/stream", route => route.fulfill({ contentType: "audio/wav", body: audioFixture(), headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.route("**/v1/stations/*/artwork", route => route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } }));
}

// Playwright's page.evaluate grants user activation. Read boot/state through
// CDP without a gesture so the blocked-autoplay test exercises a real first visit.
async function withoutGesture(page: Page, expression: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: false,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  } finally { await session.detach(); }
}

async function snapshot(page: Page) {
  return withoutGesture(page, "import('/src/shared/audio-runtime.ts').then(runtime => runtime.getState())");
}

async function booted(page: Page) {
  await withoutGesture(page, "import('/src/player/player-demo.ts').then(player => player.initPromise)");
}

async function analyserSignal(page: Page) {
  return withoutGesture(page, `(async () => {
    const runtime = await import('/src/shared/audio-runtime.ts');
    const registry = await import('/src/shared/audio-graph-registry.ts');
    const graph = registry.getGraph(runtime.getAudioElement());
    let signal = 0;
    for (const analyser of graph?.consumers || []) {
      if (!analyser.getByteTimeDomainData) continue;
      const samples = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      signal = Math.max(signal, ...samples.map(sample => Math.abs(sample - 128)));
    }
    return runtime.getState().isLive ? signal : 0;
  })()`);
}

test.describe("permitted automatic recovery", () => {
  test.use({ autoplayPolicy: "no-user-gesture-required" });

  test("first visit plays demo, reload preserves position, and Pause/Stop remain authoritative", async ({ page }) => {
    await fixtures(page);
    await page.goto("http://127.0.0.1:4175/player.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await snapshot(page)).playing).toBe(true);
    expect((await snapshot(page)).currentTrack.name).toBe("demo:focus");
    await page.evaluate(async () => {
      const runtime = await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"));
      runtime.seekTo(4.5);
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await snapshot(page)).currentTime).toBeGreaterThanOrEqual(4.5);
    await expect.poll(async () => (await snapshot(page)).playing).toBe(true);
    await page.evaluate(async () => (await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"))).pause());
    await page.reload({ waitUntil: "domcontentloaded" });
    await booted(page);
    expect(await snapshot(page)).toMatchObject({ paused: true, playing: false, playbackIntent: "paused" });
    await page.evaluate(async () => (await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"))).stopPlayback());
    await page.reload({ waitUntil: "domcontentloaded" });
    await booted(page);
    expect(await snapshot(page)).toMatchObject({ currentTrack: null, playbackIntent: "stopped", playing: false });
  });

  test("saved station automatically follows demo playback without persisting the temporary demo", async ({ page }) => {
    await fixtures(page);
    await page.addInitScript(() => {
      localStorage.setItem("vatioboard_player_session_v4", JSON.stringify({
        version: 4, playbackIntent: "playing", paused: false, currentIndex: 0, currentEntryId: "saved-radio",
        queueEntries: [{ entryId: "saved-radio", name: "radio:saved", title: "Saved station", media_kind: "radio", station_uuid: "11111111-1111-4111-8111-111111111111" }],
      }));
      localStorage.setItem("player_widget_visible_v1", "true");
      localStorage.setItem("vatio_board_player_widget_visualizer_mode", "scope");
      const order: string[] = [];
      (window as Window & { __playOrder?: string[] }).__playOrder = order;
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        order.push(this.dataset.vatioNativeRadio === "true" ? "radio" : "demo-or-retention");
        return original.call(this);
      };
    });
    await page.goto("http://127.0.0.1:4175/player.html", { waitUntil: "domcontentloaded" });
    await expect.poll(async () => {
      const state = await snapshot(page);
      return state.isLive && state.playing && state.currentTime > 0.1;
    }).toBe(true);
    expect(await snapshot(page)).toMatchObject({ playbackIntent: "playing", restorationStatus: "restored", currentTrack: { name: "radio:saved" } });
    const result = await page.evaluate(() => ({
      saved: JSON.parse(localStorage.getItem("vatioboard_player_session_v4")!),
      order: (window as Window & { __playOrder?: string[] }).__playOrder!,
    }));
    expect(result.saved.queueEntries.map((entry: { name: string }) => entry.name)).toEqual(["radio:saved"]);
    expect(result.order.indexOf("radio")).toBeGreaterThan(0);
    await expect(page.locator(".player-visualizer-strip")).toBeVisible();
    await expect(page.locator(".player-visualizer-strip")).toHaveAttribute("data-visualizer-mode", "scope");
    await expect.poll(() => analyserSignal(page)).toBeGreaterThan(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => analyserSignal(page)).toBeGreaterThan(0);
    await expect(page.locator(".player-visualizer-toggle-btn")).toHaveAttribute("aria-pressed", "true");
    await page.locator(".player-visualizer-toggle-btn").click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await snapshot(page)).isLive && (await snapshot(page)).playing).toBe(true);
    await expect(page.locator(".player-visualizer-toggle-btn")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".player-visualizer-strip")).toBeHidden();
  });
});

test("Visuals retries blocked graph preparation while the same radio audio continues", async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => {
    sessionStorage.setItem("vatioboard.debug.background", "1");
    localStorage.setItem("player_widget_visible_v1", "true");
    localStorage.setItem("vatioboard_player_session_v4", JSON.stringify({
      version: 4, playbackIntent: "playing", paused: false, currentIndex: 0, currentEntryId: "saved-radio",
      queueEntries: [{ entryId: "saved-radio", name: "radio:saved", title: "Saved station", media_kind: "radio", station_uuid: "11111111-1111-4111-8111-111111111111" }],
    }));
    // Deterministic browser-policy rejection; successful playback/analysis uses
    // the real media element, context and analyser after a trusted Visuals tap.
    let blocked = true;
    document.addEventListener("click", event => {
      if (event.isTrusted && (event.target as Element)?.closest(".player-visualizer-toggle-btn")) blocked = false;
    }, true);
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      get state() { const state = super.state; return blocked && state !== "closed" ? "suspended" : state; }
      resume() { return blocked ? Promise.reject(new DOMException("Activation required", "NotAllowedError")) : super.resume(); }
    };
  });
  await page.goto("http://127.0.0.1:4175/player.html", { waitUntil: "domcontentloaded" });
  await expect.poll(async () => (await snapshot(page)).isLive && (await snapshot(page)).playing).toBe(true);
  await expect(page.locator(".player-visualizer-toggle-btn")).toHaveAttribute("data-visualizer-state", "unavailable");
  const before = await snapshot(page);
  await page.evaluate(async () => {
    const runtime = await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"));
    runtime.getAudioElement()!.dataset.originalRadio = "true";
  });
  await page.locator(".player-visualizer-toggle-btn").click();
  await expect.poll(() => analyserSignal(page)).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot(page)).currentTime).toBeGreaterThan(before.currentTime + 0.1);
  expect(await withoutGesture(page, "import('/src/shared/audio-runtime.ts').then(r => r.getAudioElement().dataset.originalRadio)")).toBe("true");
  expect((await snapshot(page)).currentTrack.name).toBe("radio:saved");
});

test.describe("autoplay rejection", () => {
  test.use({ autoplayPolicy: "document-user-activation-required" });

  test("the existing Play button recovers blocked first-visit audio", async ({ page }) => {
    await fixtures(page);
    // Browser engagement/debugging can grant autoplay despite launch policy.
    // Inject its documented rejection until a real click on the existing Play
    // control; every successful retry still uses the browser's actual media API.
    await page.addInitScript(() => {
      let blocked = true;
      document.addEventListener("click", (event) => {
        if (event.isTrusted && (event.target as Element)?.closest(".player-btn-play")) blocked = false;
      }, true);
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        return blocked ? Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError")) : original.call(this);
      };
    });
    await page.goto("http://127.0.0.1:4175/player.html", { waitUntil: "domcontentloaded" });
    await booted(page);
    await expect.poll(async () => (await snapshot(page)).restorationStatus).toBe("blocked");
    expect(await snapshot(page)).toMatchObject({ playbackIntent: "playing", paused: true });
    await page.getByRole("button", { name: "Open Player", exact: true }).click();
    expect((await snapshot(page)).playing).toBe(false);
    await page.locator(".player-btn-play").click();
    await expect.poll(async () => (await snapshot(page)).playing).toBe(true);
    expect(await page.locator(".player-btn-play").getAttribute("aria-label")).toBe("Pause");
  });
});


const streamingFixtures = new WeakMap<
  Page,
  Awaited<ReturnType<typeof createStreamingRadio>>
>();

async function bootStreamingRadio(page: Page) {
  const stream = await createStreamingRadio();
  streamingFixtures.set(page, stream);
  await fixtures(page);
  // A redirect lets native media consume an actual unbounded HTTP response;
  // the application retains its canonical relay URL and never sees a test URL.
  await page.route("**/v1/stations/*/stream", (route) =>
    route.fulfill({
      status: 307,
      headers: { Location: stream.url, "Access-Control-Allow-Origin": "*" },
    }),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem("vatioboard.debug.background", "1");
    localStorage.setItem("player_widget_visible_v1", "true");
    localStorage.setItem(
      "vatioboard_player_session_v4",
      JSON.stringify({
        version: 4,
        playbackIntent: "playing",
        paused: false,
        currentIndex: 0,
        currentEntryId: "saved-radio",
        queueEntries: [
          {
            entryId: "saved-radio",
            name: "radio:saved",
            title: "Saved station",
            media_kind: "radio",
            station_uuid: "11111111-1111-4111-8111-111111111111",
          },
        ],
      }),
    );
    (window as Window & { __recoveryDocument?: string }).__recoveryDocument =
      crypto.randomUUID();
  });
  try {
    await page.goto("http://127.0.0.1:4175/player.html", {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => (await snapshot(page)).radioProgressConfirmed)
      .toBe(true);
    return stream;
  } catch (error) {
    await stream.close();
    throw error;
  }
}

async function assertSustainedRadio(page: Page, documentId: string) {
  await expect
    .poll(async () => (await snapshot(page)).radioProgressConfirmed)
    .toBe(true);
  const start = (await snapshot(page)).currentTime;
  // Actual media progress, not elapsed wall time or resolved play promises.
  await expect
    .poll(async () => (await snapshot(page)).currentTime, {
      timeout: 45_000,
      intervals: [1000],
    })
    .toBeGreaterThan(start + 30);
  const state = await snapshot(page);
  expect(state).toMatchObject({
    playbackIntent: "playing",
    restorationStatus: "restored",
    currentTrack: { name: "radio:saved" },
  });
  expect(state.queue.map((track: { name: string }) => track.name)).toEqual([
    "radio:saved",
  ]);
  expect(
    state.queue.map((track: { _queueId: string }) => track._queueId),
  ).toEqual(["saved-radio"]);
  expect(await withoutGesture(page, "window.__recoveryDocument")).toBe(
    documentId,
  );
  await expect.poll(() => analyserSignal(page)).toBeGreaterThan(0);
}

async function suspendAndReturn(page: Page, interrupt: () => void) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Runtime.addBinding", { name: "__radioFreezeObserved" });
  await cdp.send("Runtime.evaluate", {
    expression:
      "document.addEventListener('freeze', () => window.__radioFreezeObserved('frozen'), {once:true})",
    userGesture: false,
  });
  let timeout: ReturnType<typeof setTimeout>;
  const frozen = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error("The browser did not actually freeze")),
      5000,
    );
    cdp.on("Runtime.bindingCalled", (event) => {
      if (event.name === "__radioFreezeObserved") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  try {
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await frozen;
    interrupt();
  } finally {
    clearTimeout(timeout!);
    await cdp.send("Page.setWebLifecycleState", { state: "active" });
    // A real tab activation is needed after WasHidden; activating the already
    // selected headless tab alone leaves it hidden. Keep the original document.
    const foreground = await page.context().newPage();
    await foreground.bringToFront();
    await page.bringToFront();
    await foreground.close();
    await cdp.detach();
  }
}

test.describe("continuous radio transport", () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    const stream = streamingFixtures.get(page);
    const observations = await withoutGesture(
      page,
      `(async () => {
      const runtime = await import('/src/shared/audio-runtime.ts');
      const diagnostics = await import('/src/shared/background-diagnostics.ts');
      const el = runtime.getAudioElement();
      return { state:runtime.getState(), hidden:document.hidden, documentId:window.__recoveryDocument,
        buffered:el ? Array.from({length:el.buffered.length}, (_,i) => [el.buffered.start(i),el.buffered.end(i)]) : [],
        events:diagnostics.getBackgroundDiagnostics() };
    })()`,
    );
    await testInfo.attach("radio-transport-observations", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          ...observations,
          connections: stream?.connections.map((connection) => ({
            deliveredSeconds: connection.deliveredSeconds,
            hanging: connection.hanging,
          })),
        },
        null,
        2,
      ),
    });
  });
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== "chromium" || testInfo.project.name !== "desktop",
      "Transport regressions run once; viewport layout has separate coverage.",
    );
  });

  test.describe("native lifecycle suspension", () => {
    test.use({ nativeLifecycle: true });
    test("a retained frozen page reconnects a half-open stream and plays beyond its old buffer", async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const stream = await bootStreamingRadio(page);
      try {
        const documentId = await withoutGesture(
          page,
          "window.__recoveryDocument",
        );
        const generation = (await snapshot(page)).radioConnectionGeneration;
        const initialConnections = stream.connections.length;
        await suspendAndReturn(page, () => stream.interrupt("half-open"));
        expect(await withoutGesture(page, "window.__recoveryDocument")).toBe(
          documentId,
        );
        await expect
          .poll(() => stream.connections.length, { timeout: 40_000 })
          .toBeGreaterThan(initialConnections);
        await expect
          .poll(async () => (await snapshot(page)).radioConnectionGeneration)
          .toBeGreaterThan(generation);
        await assertSustainedRadio(page, documentId);
      } finally {
        await stream.close();
      }
    });
  });

  test("a half-open stream recovers without lifecycle or media-error notifications", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const stream = await bootStreamingRadio(page);
    try {
      const documentId = await withoutGesture(
        page,
        "window.__recoveryDocument",
      );
      const connections = stream.connections.length;
      stream.interrupt("half-open");
      const position = (await snapshot(page)).currentTime;
      // Chromium can hold received PCM ahead of its published decoded ranges.
      // The fixture's delivered duration bounds both buffers; drain them before
      // allowing the 12-second progress deadline + 5-second retry delay.
      const remaining = Math.max(
        0,
        ...stream.connections.map(
          (connection) => connection.deliveredSeconds - position,
        ),
      );
      await expect
        .poll(() => stream.connections.length, {
          timeout: Math.ceil(remaining * 1000) + 22_000,
        })
        .toBeGreaterThan(connections);
      await assertSustainedRadio(page, documentId);
    } finally {
      await stream.close();
    }
  });

  test("a disconnected stream and offline/online return recover within the same document", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const stream = await bootStreamingRadio(page);
    try {
      const documentId = await withoutGesture(
        page,
        "window.__recoveryDocument",
      );
      const connections = stream.connections.length;
      stream.interrupt("disconnect");
      await expect
        .poll(() => stream.connections.length, { timeout: 30_000 })
        .toBeGreaterThan(connections);
      await expect
        .poll(async () => (await snapshot(page)).radioProgressConfirmed)
        .toBe(true);
      const beforeOffline = stream.connections.length;
      await page.context().setOffline(true);
      stream.interrupt("half-open");
      await page.context().setOffline(false);
      await expect
        .poll(() => stream.connections.length, { timeout: 30_000 })
        .toBeGreaterThan(beforeOffline);
      await assertSustainedRadio(page, documentId);
    } finally {
      await stream.close();
    }
  });

  test.describe("native lifecycle Play fallback", () => {
    test.use({ nativeLifecycle: true });

    test("blocked return recovery leaves Play ready for a fresh connection", async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const stream = await bootStreamingRadio(page);
      try {
        const documentId = await withoutGesture(
          page,
          "window.__recoveryDocument",
        );
        await page.evaluate(() => {
          let blocked = true;
          document.addEventListener(
            "click",
            (event) => {
              if (
                event.isTrusted &&
                (event.target as Element)?.closest(".player-btn-play")
              )
                blocked = false;
            },
            true,
          );
          const original = HTMLMediaElement.prototype.play;
          HTMLMediaElement.prototype.play = function () {
            return blocked
              ? Promise.reject(
                  new DOMException("Autoplay blocked", "NotAllowedError"),
                )
              : original.call(this);
          };
        });
        await suspendAndReturn(page, () => stream.interrupt("half-open"));
        await expect
          .poll(async () => (await snapshot(page)).restorationStatus)
          .toBe("blocked");
        expect((await snapshot(page)).playbackIntent).toBe("playing");
        const connections = stream.connections.length;
        await page.locator(".player-btn-play").click();
        await expect
          .poll(() => stream.connections.length)
          .toBeGreaterThan(connections);
        await assertSustainedRadio(page, documentId);
      } finally {
        await stream.close();
      }
    });
  });

  test("healthy radio continues through an ordinary hidden/visible return", async ({
    page,
  }) => {
    const stream = await bootStreamingRadio(page);
    try {
      const documentId = await withoutGesture(
        page,
        "window.__recoveryDocument",
      );
      const generation = (await snapshot(page)).radioConnectionGeneration;
      const connections = stream.connections.length;
      const time = (await snapshot(page)).currentTime;
      await withoutGesture(
        page,
        `Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));`,
      );
      await expect
        .poll(async () => (await snapshot(page)).currentTime)
        .toBeGreaterThan(time + 2);
      await withoutGesture(
        page,
        `Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange'));`,
      );
      expect((await snapshot(page)).radioConnectionGeneration).toBe(generation);
      expect(stream.connections.length).toBe(connections);
      await assertSustainedRadio(page, documentId);
    } finally {
      await stream.close();
    }
  });
});
