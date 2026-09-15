import { expect, test } from "@playwright/test";

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
    paused: false, keepAlivePaused: false, keepAliveLoop: true, keepAliveMuted: false,
    keepAliveVolume: 1, keepAlivePlaybackRate: 1, mediaSessionPlaybackState: "playing", leaseCount: 2,
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
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Tesla test 2");
  await click("Seek +10 seconds");
  await expect.poll(async () => (await snapshot()).primaryCurrentTime).toBeGreaterThan(10);
  await click("STOP TEST");
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe("none");
  expect(errors).toEqual([]);
});
