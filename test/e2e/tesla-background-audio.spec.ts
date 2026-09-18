import { expect, test } from "@playwright/test";

function radioFixture() {
  const samples = 8000 * 30;
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
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(2200 * Math.sin((i * Math.PI * 440) / 8000)), 44 + i * 2);
  return wav;
}

test("native radio remains connected and leaves main recording leases independent", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://station.example/**", (route) =>
    route.fulfill({ contentType: "audio/wav", body: radioFixture() }),
  );
  await page.goto("/tesla-background-audio.html");
  await page.getByLabel("Station stream URL").fill("https://station.example/one");
  const click = (name: string) => page.getByRole("button", { name, exact: true }).click();
  const snapshot = async () => JSON.parse(await page.locator("pre[aria-live]").innerText());
  await click("VatioBoard native radio");
  await expect.poll(async () => (await snapshot()).primaryCurrentTime).toBeGreaterThan(0.1);
  const started = await snapshot();
  expect(started).toMatchObject({
    primaryConnected: true,
    primaryControls: false,
    keepAlivePaused: true,
    leaseCount: 0,
  });
  await expect(page.locator("#vatio-native-radio-host audio")).toBeHidden();
  expect(
    await page.locator("#vatio-native-radio-host audio").getAttribute("crossorigin"),
  ).toBeNull();
  await page.evaluate(async () => {
    const system = await import(/* @vite-ignore */ String("/src/shared/audio-system.ts"));
    await system.acquireBackgroundAudioLease("test-recording");
  });
  await page.getByLabel("Station stream URL").fill("https://station.example/two");
  await click("VatioBoard native radio");
  await expect.poll(async () => (await snapshot()).keepAlivePaused).toBe(false);
  expect((await snapshot()).primaryElementId).toBe(started.primaryElementId);
  await click("Pause real track");
  await click("Rearm keep-alive");
  await expect.poll(async () => (await snapshot()).musicPaused).toBe(true);
  await click("Play");
  await expect.poll(async () => (await snapshot()).paused).toBe(false);
  await click("STOP TEST");
  await expect.poll(async () => (await snapshot()).paused).toBe(true);
  expect(await snapshot()).toMatchObject({ keepAlivePaused: false, leaseCount: 1 });
  await page.evaluate(async () => {
    (
      await import(/* @vite-ignore */ String("/src/shared/audio-system.ts"))
    ).releaseBackgroundAudioLease("test-recording");
  });
  await expect.poll(async () => (await snapshot()).keepAlivePaused).toBe(true);
  expect(errors).toEqual([]);
});

test("original MP3 path plays test tones and releases its lease on Pause", async ({ page }) => {
  await page.goto("/tesla-background-audio.html");
  const click = (name: string) => page.getByRole("button", { name, exact: true }).click();
  const snapshot = async () => JSON.parse(await page.locator("pre[aria-live]").innerText());
  await click("START TESLA BACKGROUND TEST");
  await expect.poll(async () => (await snapshot()).primaryCurrentTime).toBeGreaterThan(0.1);
  expect(await snapshot()).toMatchObject({ keepAlivePaused: false, leaseCount: 1 });
  await click("Pause real track");
  await expect.poll(async () => (await snapshot()).keepAlivePaused).toBe(true);
  await click("Next");
  await expect.poll(async () => (await snapshot()).paused).toBe(false);
  await click("Seek +10 seconds");
  await expect.poll(async () => (await snapshot()).primaryCurrentTime).toBeGreaterThan(10);
  await click("STOP TEST");
  await expect.poll(async () => (await snapshot()).leaseCount).toBe(0);
});
