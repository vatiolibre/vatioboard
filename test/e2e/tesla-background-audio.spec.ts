import { expect, test } from "@playwright/test";

function radioFixture() {
  const samples = 8000 * 30;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(2200 * Math.sin(i * Math.PI * 440 / 8000)), 44 + i * 2);
  return wav;
}

test("one gesture starts real media; Pause and Rearm retain the silent channel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tesla-background-audio.html");
  const click = (name: string) => page.getByRole("button", { name, exact: true }).click();
  const snapshot = async () => JSON.parse(await page.locator("pre[aria-live]").innerText());
  await click("START TESLA BACKGROUND TEST");
  await expect.poll(async () => (await snapshot()).primaryCurrentTime).toBeGreaterThan(0.1);
  const started = await snapshot();
  expect(started).toMatchObject({
    paused: false, keepAlivePaused: true, keepAliveLoop: true, keepAliveMuted: false,
    keepAliveVolume: 1, keepAlivePlaybackRate: 1, backgroundStatus: "delegated", leaseCount: 2,
  });
  await click("Pause real track");
  await expect.poll(async () => (await snapshot()).musicPaused).toBe(true);
  const paused = await snapshot();
  await click("Rearm keep-alive");
  await expect.poll(async () => (await snapshot()).heartbeat).toBeGreaterThan(paused.heartbeat);
  expect(await snapshot()).toMatchObject({
    musicPaused: true, paused: true, keepAlivePaused: false, leaseCount: 2,
    primaryElementId: started.primaryElementId, keepAliveIdentity: started.keepAliveIdentity,
  });
  await click("Next");
  await expect.poll(async () => (await snapshot()).musicPaused).toBe(false);
  await click("Seek +10 seconds");
  await expect.poll(async () => (await snapshot()).primaryCurrentTime).toBeGreaterThan(10);
  await click("STOP TEST");
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe("none");
  expect(errors).toEqual([]);
});


test("direct radio baseline and runtime both play without station CORS headers", async ({ page }) => {
  // Audible PCM served at a station-like HTTPS URL; intentionally no ACAO.
  const wav = radioFixture();
  await page.route("https://station.example/live", (route) => route.fulfill({ contentType: "audio/wav", body: wav }));
  await page.goto("/tesla-background-audio.html");
  await page.getByLabel("Station stream URL").fill("https://station.example/live");
  await page.getByLabel("Station UUID").fill("11111111-1111-4111-8111-111111111111");
  const snapshot = async () => JSON.parse(await page.locator("pre[aria-live]").innerText());
  await page.getByRole("button", { name: "POC direct radio", exact: true }).click();
  await expect.poll(async () => (await snapshot()).primaryCurrentTime).toBeGreaterThan(0.1);
  expect(await page.locator("audio").getAttribute("crossorigin")).toBeNull();
  await page.getByRole("button", { name: "VatioBoard native radio", exact: true }).click();
  await expect.poll(async () => (await snapshot()).leaseCount).toBe(2);
  await expect.poll(async () => (await snapshot()).primaryCurrentTime).toBeGreaterThan(0.1);
  await expect(page.locator("#vatio-primary-audio-host audio")).toBeHidden();
  await page.getByRole("button", { name: "STOP TEST", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe("none");
});


test("default runtime delegates retention and makes no platform writes", async ({ page }) => {
  await page.addInitScript(() => {
    const events = { plays: [] as { src: string; connected: boolean }[], writes: [] as string[] };
    Object.assign(window, { audioEvents: events });
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      events.plays.push({ src: this.src, connected: this.isConnected });
      return nativePlay.call(this);
    };
    if (navigator.mediaSession) {
      for (const key of ["metadata", "playbackState"]) {
        Object.defineProperty(navigator.mediaSession, key, { configurable: true,
          get: () => key === "playbackState" ? "none" : null,
          set: () => { events.writes.push(key); } });
      }
      navigator.mediaSession.setActionHandler = () => { events.writes.push("action"); };
      navigator.mediaSession.setPositionState = () => { events.writes.push("position"); };
    }
    const session = new EventTarget();
    Object.defineProperties(session, { state: { value: "active" }, type: {
      get: () => "auto", set: () => { events.writes.push("audioSession"); },
    } });
    Object.defineProperty(navigator, "audioSession", { configurable: true, value: session });
  });
  await page.route("https://station.example/live", (route) => route.fulfill({ contentType: "audio/wav", body: radioFixture() }));
  await page.goto("/tesla-background-audio.html");
  await page.getByLabel("Station stream URL", { exact: true }).fill("https://station.example/live");
  const snapshot = async () => JSON.parse(await page.locator("pre[aria-live]").innerText());
  const click = (name: string) => page.getByRole("button", { name, exact: true }).click();
  await click("VatioBoard native radio");
  await expect.poll(async () => (await snapshot()).primaryCurrentTime).toBeGreaterThan(0.1);
  expect(await snapshot()).toMatchObject({ primaryConnected: true, keepAlivePaused: true,
    backgroundStatus: "delegated", leaseCount: 2, primaryControls: false });
  const events = () => page.evaluate(() => Reflect.get(window, "audioEvents"));
  expect((await events()).plays).toHaveLength(1);
  expect((await events()).plays[0].connected).toBe(true);
  expect((await events()).writes).toEqual([]);
  await page.getByLabel("VatioBoard audio playback").evaluate((el: HTMLAudioElement) => el.pause());
  await expect.poll(async () => (await snapshot()).musicPaused).toBe(true);
  expect((await snapshot()).leaseCount).toBe(2);
  await click("Rearm keep-alive");
  expect(await page.getByLabel("VatioBoard audio playback").evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);
  await click("Play");
  await expect.poll(async () => (await snapshot()).backgroundStatus).toBe("delegated");
  expect((await snapshot()).keepAlivePaused).toBe(true);
  await click("STOP TEST");
  expect((await events()).writes).toEqual([]);
  await page.getByText("Audio test summary", { exact: true }).click();
  await page.getByLabel("Tesla software version (entered manually)").fill("2026.26.6.1");
  await page.getByLabel("Stops other Tesla audio").selectOption("Pass");
  await expect(page.getByLabel("Automatic audio observations")).toContainText("Recovery calls:");
  await expect(page.getByLabel("Stops other Tesla audio")).toHaveValue("Pass");
  await expect(page.locator("#vatio-primary-audio-host audio")).toBeHidden();
  expect(await page.locator("#vatio-primary-audio-host").evaluate((el) => el.getBoundingClientRect().height)).toBe(0);
  // Removed experiment parameters cannot restore a different playback path.
  await page.goto("/tesla-background-audio.html?audioCompatibility=0&audioSilence=1&audioAttach=0");
  await page.getByLabel("Station stream URL", { exact: true }).fill("https://station.example/live");
  await click("VatioBoard native radio");
  await expect.poll(async () => (await snapshot()).backgroundStatus).toBe("delegated");
  expect((await snapshot()).keepAlivePaused).toBe(true);
  expect((await events()).writes).toEqual([]);
  await click("STOP TEST");
});
