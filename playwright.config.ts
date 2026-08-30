import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: process.env.CI ? 2 : 2,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:4175",
    locale: "en-US",
    colorScheme: "dark",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "model-y-2024", use: { viewport: { width: 773, height: 601 }, deviceScaleFactor: 1.53 } },
    { name: "model-y-2026", use: { viewport: { width: 804, height: 638 }, deviceScaleFactor: 1.96 } },
    { name: "model-y-2024-expanded", use: { viewport: { width: 1256, height: 706 }, deviceScaleFactor: 1.53 } },
    { name: "model-y-2026-expanded", use: { viewport: { width: 1307, height: 747 }, deviceScaleFactor: 1.93 } },
    {
      name: "model-y-2024-es-light",
      use: {
        viewport: { width: 773, height: 601 },
        deviceScaleFactor: 1.53,
        locale: "es-ES",
        colorScheme: "light",
      },
    },
    { name: "phone-portrait", use: { viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 } },
    { name: "phone-landscape", use: { viewport: { width: 932, height: 430 }, deviceScaleFactor: 2 } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
    { name: "desktop-large", use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4175",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
