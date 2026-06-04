import { defineConfig } from "vite";
import { resolve } from "path";

const MANUAL_CHUNKS = [
  {
    name: "vendor-maplibre",
    packages: ["maplibre-gl"],
  },
  {
    name: "vendor-milkdrop",
    packages: ["butterchurn", "butterchurn-presets"],
  },
  {
    name: "vendor-math",
    packages: [
      "complex.js",
      "decimal.js",
      "escape-latex",
      "fraction.js",
      "javascript-natural-sort",
      "mathjs",
      "seedrandom",
      "tiny-emitter",
      "typed-function",
    ],
  },
  {
    name: "vendor-charts",
    packages: ["@kurkle/color", "@stanko/dual-range-input", "chart.js"],
  },
];

function getManualChunk(id) {
  if (!id.includes("/node_modules/")) return null;

  const normalizedId = id.split("\\").join("/");
  for (const group of MANUAL_CHUNKS) {
    if (group.packages.some((pkg) => normalizedId.includes(`/node_modules/${pkg}/`))) {
      return group.name;
    }
  }

  return "vendor";
}

export default defineConfig({
  base: "/",
  resolve: {
    alias: [
      {
        find: /^onnxruntime-web$/,
        replacement: "onnxruntime-web/wasm",
      },
    ],
    conditions: ["onnxruntime-web-use-extern-wasm", "module", "browser", "development|production"],
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    allowedHosts: ["vatioboard.com", ".vatioboard.com", ".vatiolibre.com"],
  },
  worker: {
    format: "es",
  },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
      },
      output: {
        manualChunks: getManualChunk,
      },
    },
  },
});
