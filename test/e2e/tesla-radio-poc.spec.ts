import { expect, test } from "@playwright/test";

// A station-like HTTPS response with no CORS headers. No public radio service
// is contacted, and media actually advances in Chromium.
function audibleWav() {
  const samples = 8000 * 30;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(2200 * Math.sin(i * Math.PI * 440 / 8000)), 44 + i * 2);
  }
  return wav;
}

test("isolated radio plays and changes stations without initializing shared audio services", async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.addInitScript(() => {
    // These traps prove isolation, rather than relying on the absence of an
    // extra DOM audio tag: the shared runtime uses detached Audio objects.
    const forbidden = (name: string) => { throw new Error(`Unexpected audio integration: ${name}`); };
    for (const name of ["Audio", "AudioContext", "webkitAudioContext"]) {
      Object.defineProperty(window, name, { configurable: true, value: function () { forbidden(name); } });
    }
    for (const name of ["mediaSession", "audioSession"]) {
      Object.defineProperty(navigator, name, { configurable: true,
        get() { return forbidden(name); }, set() { forbidden(name); } });
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.id !== "audio" || !this.isConnected) forbidden("non-primary play");
      this.dataset.gestureAtPlay = String(navigator.userActivation.isActive);
      return play.call(this);
    };
  });
  const stations = [
    { stationuuid: "11111111-1111-4111-8111-111111111111", name: "Station One", url_resolved: "https://station.example/one" },
    { stationuuid: "22222222-2222-4222-8222-222222222222", name: "Station Two", url_resolved: "https://station.example/two" },
  ];
  await page.route("https://*.api.radio-browser.info/**", (route) => {
    // Broken click analytics must not prevent gesture-synchronous playback.
    if (route.request().url().includes("/json/url/")) return route.abort();
    return route.fulfill({ json: stations });
  });
  const wav = audibleWav();
  await page.route("https://station.example/**", (route) => route.fulfill({ contentType: "audio/wav", body: wav }));

  await page.goto("/tesla-radio-poc.html");
  const audio = page.locator("audio");
  await expect(audio).toBeVisible();
  await expect(audio).toHaveAttribute("controls", "");
  expect(await audio.getAttribute("crossorigin")).toBeNull();
  const playStation = (name: string) => page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "Play", exact: true }).click();
  await playStation("Station One");
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0.1);
  await expect(audio).toHaveAttribute("data-gesture-at-play", "true");
  await audio.evaluate((el) => { el.dataset.identity = "original"; });
  await playStation("Station Two");
  await expect(audio).toHaveAttribute("src", "https://station.example/two");
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0.1);
  await expect(audio).toHaveAttribute("data-identity", "original");
  await expect(audio).toHaveCount(1);
  await audio.evaluate((el: HTMLAudioElement) => el.pause());
  await page.waitForTimeout(300);
  expect(await audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);
  expect(requests.filter((url) => /\/src\/|\/assets\/|\/v1\/stations\//.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});
