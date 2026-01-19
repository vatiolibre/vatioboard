import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/",
  server: {
    host: true,
    allowedHosts: ["debug.vatiolibre.com", "vatioboard.com", ".vatiolibre.com"],
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        calculator: resolve(__dirname, "calculator.html"),
      },
    },
  },
});
