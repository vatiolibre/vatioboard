import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";

const SPA_ROUTE_PATHS = new Set([
  "/",
  "/accel",
  "/apps",
  "/board",
  "/code-rain",
  "/delivery-checklist",
  "/library",
  "/qr-scanner",
  "/replay",
  "/speed",
  "/waze",
]);

function rewriteCleanAppRoute(request, _response, next) {
  if (!request.url || request.method !== "GET") return next();
  const url = new URL(request.url, "http://vatioboard.local");
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";
  if (!SPA_ROUTE_PATHS.has(pathname) || pathname === "/") return next();
  request.url = `/index.html${url.search}`;
  next();
}

function cleanAppRoutePlugin() {
  return {
    name: "vatioboard-clean-app-routes",
    configureServer(server) {
      server.middlewares.use(rewriteCleanAppRoute);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewriteCleanAppRoute);
    },
  };
}

function validateRadioDevelopmentEnvironmentPlugin() {
  return {
    name: "vatioboard-radio-development-environment",
    config(_config, { mode }) {
      if (mode === "production") return;
      const env = loadEnv(mode, process.cwd(), "");
      if (String(env.VITE_VATIOBOARD_RADIO_MEDIA_BASE || "").replace(/\/+$/, "")
        === "https://radio-media.vatioboard.com") {
        throw new Error("Development builds must use https://radio-media.dev.vatioboard.com.");
      }
    },
  };
}

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
  {
    name: "vendor-tesseract",
    packages: ["tesseract.js"],
  },
  {
    name: "vendor-opencv",
    packages: ["@techstark/opencv-js"],
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
  define: { "import.meta.env.VITE_BUILD_ID": JSON.stringify(process.env.VITE_BUILD_ID || new Date().toISOString()) },
  plugins: [validateRadioDevelopmentEnvironmentPlugin(), cleanAppRoutePlugin()],
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
        teslaAudio: resolve(__dirname, "tesla-background-audio.html"),
        teslaRadioPoc: resolve(__dirname, "tesla-radio-poc.html"),
      },
      output: {
        manualChunks: getManualChunk,
      },
    },
  },
});
