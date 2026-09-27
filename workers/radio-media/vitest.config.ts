import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["workers/radio-media/test/**/*.test.ts"],
    restoreMocks: true,
  },
});
