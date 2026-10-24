import { expect, test as base, type Page } from "@playwright/test";

const test = base.extend<{ autoplayPolicy: string }>({
  autoplayPolicy: ["no-user-gesture-required", { option: true }],
  page: async ({ playwright, autoplayPolicy, baseURL, viewport }, use) => {
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

test.describe("permitted automatic recovery", () => {
  test.use({ autoplayPolicy: "no-user-gesture-required" });

  test("first visit plays demo, reload preserves position, and Pause/Stop remain authoritative", async ({ page }) => {
    await fixtures(page);
    await page.goto("/player.html");
    await expect.poll(async () => (await snapshot(page)).playing).toBe(true);
    expect((await snapshot(page)).currentTrack.name).toBe("demo:focus");
    await page.evaluate(async () => {
      const runtime = await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"));
      runtime.seekTo(4.5);
    });
    await page.reload();
    await expect.poll(async () => (await snapshot(page)).currentTime).toBeGreaterThanOrEqual(4.5);
    await expect.poll(async () => (await snapshot(page)).playing).toBe(true);
    await page.evaluate(async () => (await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"))).pause());
    await page.reload();
    await booted(page);
    expect(await snapshot(page)).toMatchObject({ paused: true, playing: false, playbackIntent: "paused" });
    await page.evaluate(async () => (await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"))).stopPlayback());
    await page.reload();
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
      const order: string[] = [];
      (window as Window & { __playOrder?: string[] }).__playOrder = order;
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        order.push(this.dataset.vatioNativeRadio === "true" ? "radio" : "demo-or-retention");
        return original.call(this);
      };
    });
    await page.goto("/player.html");
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
  });
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
    await page.goto("/player.html");
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
