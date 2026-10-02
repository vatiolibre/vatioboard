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
  ).toBe("anonymous");
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

test("the shared radio graph feeds visualizers without binding or stopping native radio", async ({ page }) => {
  const errors: string[] = [];
  let relayRequests = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://station.example/**", route => route.fulfill({ contentType: "audio/wav", body: radioFixture() }));
  await page.route("**/v1/stations/*/stream", route => {
    relayRequests += 1;
    return route.fulfill({ contentType: "audio/wav", body: radioFixture(), headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.goto("/tesla-background-audio.html");
  await page.getByLabel("Station stream URL").fill("https://station.example/one");
  const click = (name: string) => page.getByRole("button", { name, exact: true }).click();
  await click("VatioBoard native radio");
  await page.locator("#vatio-native-radio-host audio").evaluate(el => { el.setAttribute("data-original", "yes"); });
  await click("Radio spectrum");
  const inspect = () => page.evaluate(async () => {
    const runtime = await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"));
    const registry = await import(/* @vite-ignore */ String("/src/shared/audio-graph-registry.ts"));
    const primary = runtime.getAudioElement();
    const analysis = runtime.getVisualizationAudioElement();
    const graph = analysis && registry.getGraph(analysis);
    let energy = 0;
    if (graph) {
      const analyser = graph.audioContext.createAnalyser();
      graph.sourceNode.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      await new Promise(resolve => setTimeout(resolve, 80));
      analyser.getFloatTimeDomainData(samples);
      energy = samples.reduce((sum, value) => sum + Math.abs(value), 0);
      graph.sourceNode.disconnect(analyser);
    }
    return { status: runtime.getRadioVisualizationStatus(), energy,
      nativeHasGraph: Boolean(registry.getGraph(primary)), primaryPaused: primary.paused,
      primaryTime: primary.currentTime, sameElement: primary === analysis };
  });
  await expect.poll(async () => (await inspect()).energy).toBeGreaterThan(0.1);
  expect(await inspect()).toMatchObject({ status: "ready", nativeHasGraph: true, primaryPaused: false, sameElement: true });
  await click("Radio scope");
  await expect(page.locator("canvas.media-player-audio-canvas")).toBeVisible();
  await click("Radio Milkdrop");
  // WebGL may be unavailable on some platforms; that must not stop the primary.
  await expect(page.locator(".milkdrop-panel")).toBeVisible();
  expect((await inspect()).primaryPaused).toBe(false);
  await page.locator(".milkdrop-close-btn").click();
  await click("Disable visualizations");
  await expect.poll(async () => (await inspect()).status).toBe("idle");
  const before = (await inspect()).primaryTime;
  await expect.poll(async () => (await inspect()).primaryTime).toBeGreaterThan(before);
  await page.unroute("**/v1/stations/*/stream");
  await page.route("**/v1/stations/*/stream", route => route.abort());
  await click("Radio spectrum");
  await expect.poll(async () => (await inspect()).status).toBe("unavailable");
  expect(await inspect()).toMatchObject({ primaryPaused: false, nativeHasGraph: true, sameElement: true });
  expect(relayRequests).toBe(1);
  await expect(page.locator("#vatio-native-radio-host audio")).toHaveAttribute("data-original", "yes");
  expect(errors).toEqual([]);
});

test("saved radio waits for Play, then uses the restored local-demo lifecycle", async ({ page }) => {
  await page.route("https://station.example/**", route =>
    route.fulfill({ contentType: "audio/wav", body: radioFixture() }));
  // Restored sessions intentionally do not persist direct stream URLs. The
  // resolver falls back to the station UUID relay, so cover that transport in
  // the reload path as well as the fresh direct-stream path.
  await page.route("**/v1/stations/*/stream", route =>
    route.fulfill({ contentType: "audio/wav", body: radioFixture(), headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.goto("/tesla-background-audio.html");
  await page.getByLabel("Station stream URL").fill("https://station.example/restored");
  await page.getByRole("button", { name: "VatioBoard native radio", exact: true }).click();
  await expect.poll(() => page.locator("#vatio-native-radio-host audio").evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0.1);
  await page.reload();
  await page.evaluate(() => {
    const order: string[] = [];
    const originalPlay = HTMLMediaElement.prototype.play;
    (window as Window & { __radioPlayOrder?: string[] }).__radioPlayOrder = order;
    HTMLMediaElement.prototype.play = function patchedPlay() {
      order.push(this.dataset.vatioNativeRadio === "true" ? "radio" : "retainer");
      return originalPlay.call(this);
    };
  });
  // The harness does not restore automatically; invoke the same boot entry point
  // as the application, without a click in this fresh document.
  await page.evaluate(async () => {
    const runtime = await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"));
    await runtime.restoreSession([{
      name: "demo:focus",
      title: "Focus clip",
      media_kind: "audio",
      src: "/audio/demo/sb_titan.mp3",
      _demo: true,
    }], { autoplay: true });
  });
  await expect.poll(() => page.evaluate(async () => {
    const runtime = await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"));
    const system = await import(/* @vite-ignore */ String("/src/shared/audio-system.ts"));
    return {
      restored: runtime.getState().restoredRadioSession,
      paused: runtime.getState().paused,
      silentPlaying: !system.getBackgroundKeepAliveAudio().paused,
      owners: system.getBackgroundAudioState().activeLeaseIds,
      analysis: runtime.getRadioVisualizationStatus(),
      playOrder: (window as Window & { __radioPlayOrder?: string[] }).__radioPlayOrder || [],
    };
  })).toMatchObject({ restored: true, paused: true, silentPlaying: false, owners: [], analysis: "idle", playOrder: [] });
  await page.evaluate(async () => {
    const runtime = await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"));
    const play = runtime.play();
    const demo = runtime.getAudioElement();
    await new Promise(resolve => setTimeout(resolve, 100));
    demo.currentTime = 0.2;
    demo.dispatchEvent(new Event("playing"));
    demo.dispatchEvent(new Event("timeupdate"));
    await new Promise(resolve => setTimeout(resolve, 100));
    runtime.getAudioElement()?.dispatchEvent(new Event("playing"));
    await play;
  });
  await expect.poll(() => page.evaluate(async () => {
    const runtime = await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"));
    const system = await import(/* @vite-ignore */ String("/src/shared/audio-system.ts"));
    return {
      restored: runtime.getState().restoredRadioSession,
      primaryAdvancing: runtime.getAudioElement()?.currentTime > 0.1,
      silentPlaying: !system.getBackgroundKeepAliveAudio().paused,
      owners: system.getBackgroundAudioState().activeLeaseIds,
      analysis: runtime.getRadioVisualizationStatus(),
      playOrder: (window as Window & { __radioPlayOrder?: string[] }).__radioPlayOrder || [],
    };
  })).toMatchObject({ restored: true, primaryAdvancing: false, silentPlaying: true, owners: ["player-runtime"], analysis: "idle" });
  await expect(page.locator("#vatio-native-radio-host audio")).toBeHidden();
  await page.evaluate(async () => {
    const runtime = await import(/* @vite-ignore */ String("/src/shared/audio-runtime.ts"));
    runtime.stopPlayback();
  });
});
