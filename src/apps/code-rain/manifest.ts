import { IconCodeRain } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const codeRainAppManifest = defineAppManifest({
  id: "vatio.codeRain",
  title: "Code Rain",
  shortTitle: "Code Rain",
  description: "Full-screen animated code rain visualizer with local presets and offline static assets.",
  kind: "visualizer-app",
  version: "1.0.0",
  icon: IconCodeRain,
  theme: {
    color: "#00c853",
    color2: "#00ff41",
    foreground: "#031107",
  },
  i18nKey: "codeRain",
  route: "/code-rain",
  entry: () => import("./index.js"),
  surfaces: ["main-route", "start-menu", "launcher"],
  order: 58,
  permissions: ["storage.app"],
  services: ["storage"],
  tags: ["visualizer", "code", "rain", "offline"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "experimental",
  metadata: {
    attribution: {
      name: "Rezmason/matrix",
      license: "MIT",
      source: "https://github.com/Rezmason/matrix",
      commit: "5ba90490453ceceb6812d6b1bc658a99a92411d0",
    },
  },
});
