import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { BrowserType } from "@playwright/test";

/** Avoid Playwright's focus/visibility overrides, which suppress real freezing. */
export async function nativeLifecycleBrowser(chromium: BrowserType, autoplayPolicy: string) {
  const directory = await mkdtemp(`${tmpdir()}/vatioboard-lifecycle-`);
  const process = spawn(chromium.executablePath(), [
    "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio",
    "--remote-debugging-port=0", `--user-data-dir=${directory}`,
    `--autoplay-policy=${autoplayPolicy}`,
    "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const exited = new Promise<void>(resolve => {
    process.once("exit", () => resolve());
    process.once("error", () => resolve());
  });
  const stop = async () => {
    process.kill("SIGTERM");
    const timeout = setTimeout(() => process.kill("SIGKILL"), 3000);
    await exited;
    clearTimeout(timeout);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Chromium CDP startup timed out")), 10_000);
      process.once("error", error => { clearTimeout(timeout); reject(error); });
      process.once("exit", () => { clearTimeout(timeout); reject(new Error("Chromium exited before CDP startup")); });
      process.stderr.on("data", data => {
        const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
    return { browser, async close() { try { await browser.close(); } finally { await stop(); } } };
  } catch (error) { await stop(); throw error; }
}
