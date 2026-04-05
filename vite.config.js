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
        calculator: resolve(__dirname, "calculator.html"),
        speed: resolve(__dirname, "speed.html"),
        replay: resolve(__dirname, "replay.html"),
        library: resolve(__dirname, "library.html"),
        gpsRate: resolve(__dirname, "gps-rate.html"),
        accel: resolve(__dirname, "accel.html"),
        login: resolve(__dirname, "login.html"),
      },
    },
  },
});
