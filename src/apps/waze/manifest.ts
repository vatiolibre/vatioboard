import { IconCameraMap } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const wazeAppManifest = defineAppManifest({
  id: "vatio.waze",
  title: "Waze Map",
  shortTitle: "Waze",
  description: "Full-work-area Waze live map with shared GPS speed and driving-alert status.",
  kind: "core-app",
  version: "1.0.0",
  icon: IconCameraMap,
  theme: {
    color: "#1db954",
    color2: "#0ea5e9",
    foreground: "#ffffff",
  },
  i18nKey: "wazeMap",
  route: "/waze",
  entry: () => import("./index.js"),
  surfaces: ["main-route", "start-menu", "launcher"],
  order: 15,
  permissions: [
    "gps.read",
    "gps.highAccuracy",
    "alerts.speed",
    "i18n.read",
    "settings.read",
    "shell.launchApp",
  ],
  services: ["gps", "drivingAlerts", "shell", "i18n", "settings"],
  tags: ["driving", "gps", "map", "waze", "online"],
  localFirst: false,
  teslaOptimized: true,
  offlineCapable: false,
  status: "beta",
  metadata: {
    legacyToolId: "route:waze",
    networkDependent: true,
    externalOrigins: ["https://embed.waze.com"],
  },
});
