import type { Page } from "@playwright/test";

interface GpsTraceSample {
  offsetMs: number;
  coords: GeolocationCoordinates;
}

export async function installPlaywrightGpsTrace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const watchers = new Map<number, PositionCallback>();
    let nextWatchId = 1;
    const geolocation = {
      watchPosition(success: PositionCallback) {
        const id = nextWatchId++;
        watchers.set(id, success);
        return id;
      },
      clearWatch(id: number) {
        watchers.delete(id);
      },
      getCurrentPosition(success: PositionCallback, error?: PositionErrorCallback) {
        const latest = (window as any).__vatioboardGpsTraceLatest;
        if (latest) success(latest);
        else error?.({ code: 2, message: "No simulated fix" } as GeolocationPositionError);
      },
    };
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: geolocation });
    (window as any).__vatioboardPlayGpsTrace = async (samples: GpsTraceSample[], speed = 1) => {
      const origin = Date.now();
      let previousOffset = 0;
      for (const sample of samples) {
        const delay = Math.max(0, sample.offsetMs - previousOffset) / Math.max(0.01, speed);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        const position = { timestamp: origin + sample.offsetMs, coords: sample.coords } as GeolocationPosition;
        (window as any).__vatioboardGpsTraceLatest = position;
        for (const callback of watchers.values()) callback(position);
        previousOffset = sample.offsetMs;
      }
    };
  });
}

export async function playGpsTrace(page: Page, samples: GpsTraceSample[], speed = 20): Promise<void> {
  await page.evaluate(async ({ traceSamples, playbackSpeed }) => {
    await (window as any).__vatioboardPlayGpsTrace(traceSamples, playbackSpeed);
  }, { traceSamples: samples, playbackSpeed: speed });
}
