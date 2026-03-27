import { mergeConfig, defineConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: "jsdom",
    testTimeout: 20000,
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
