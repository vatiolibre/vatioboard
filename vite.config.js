import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/",
  build: {
    rollupOptions: {
      input: {
        // optional landing page
        index: resolve(__dirname, "index.html"),
        calculator: resolve(__dirname, "calculator.html"),
      },
    },
  },
});
