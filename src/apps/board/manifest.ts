import { IconBoard } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const boardAppManifest = defineAppManifest({
  id: "vatio.board",
  title: "VatioLibre Drawing Board",
  shortTitle: "Board",
  description: "Touch-first drawing board with local drafts and optional VatioLibre sync.",
  kind: "core-app",
  version: "1.0.0",
  icon: IconBoard,
  theme: {
    color: "#2563eb",
    color2: "#60a5fa",
  },
  i18nKey: "openBoard",
  route: "/board",
  entry: () => import("./index.js"),
  surfaces: ["main-route", "start-menu", "launcher"],
  order: 20,
  permissions: [
    "storage.app",
    "storage.media",
    "cloud.sync",
    "auth.session",
    "network.backend",
    "i18n.read",
    "settings.read",
    "settings.write",
    "shell.window",
    "shell.launchApp",
  ],
  services: ["auth", "cloudSync", "shell", "storage", "i18n", "settings"],
  tags: ["drawing", "offline", "cloud-sync"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "stable",
  metadata: {
    legacyToolId: "route:board",
  },
});
