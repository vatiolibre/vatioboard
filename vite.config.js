import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/",
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    allowedHosts: ["vatioboard.com", ".vatioboard.com", ".vatiolibre.com"],
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
      },
    },
  },
});
