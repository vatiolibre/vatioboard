import { mergeConfig, defineConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: "jsdom",
    testTimeout: 20000,
    // Route smoke tests mount the complete shell. Bounding concurrency keeps
    // their lifecycle timers deterministic on both CI and developer machines.
    maxWorkers: 4,
    environmentOptions: {
      jsdom: {
        url: "https://vatioboard.com/",
      },
    },
    setupFiles: ["./test/setup/test-env.js"],
    restoreMocks: true,
    clearMocks: true,
  },
}));
