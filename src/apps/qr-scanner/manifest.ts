import { IconQrScanner } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const qrScannerAppManifest = defineAppManifest({
  id: "vatio.qrScanner",
  title: "QR Scanner",
  shortTitle: "QR Scan",
  description: "Minimal local QR scanner for camera or image-based code reads.",
  kind: "tool-app",
  version: "1.0.0",
  icon: IconQrScanner,
  theme: {
    color: "#0f766e",
    color2: "#f4b740",
  },
  i18nKey: "qrScanner",
  route: "/qr-scanner",
  entry: () => import("./index.js"),
  surfaces: ["main-route", "start-menu", "launcher"],
  order: 26,
  permissions: ["media.camera"],
  services: ["qrScanner"],
  tags: ["qr", "scanner", "camera", "local-first"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "beta",
  metadata: {
    legacyToolId: "route:qr-scanner",
  },
});
