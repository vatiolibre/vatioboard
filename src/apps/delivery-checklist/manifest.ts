import { IconDeliveryChecklist } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const deliveryChecklistAppManifest = defineAppManifest({
  id: "vatio.deliveryChecklist",
  title: "Tesla Delivery Checklist",
  shortTitle: "Delivery",
  description: "Local-first Tesla delivery checklist for Model 3, Model Y, and Cybertruck.",
  kind: "core-app",
  version: "1.0.0",
  icon: IconDeliveryChecklist,
  theme: {
    color: "#2563eb",
    color2: "#22c55e",
  },
  i18nKey: "deliveryChecklist",
  route: "/delivery-checklist",
  entry: () => import("./index.js"),
  surfaces: ["main-route", "start-menu", "launcher"],
  order: 25,
  permissions: [
    "storage.app",
    "media.camera",
    "auth.session",
    "network.backend",
    "i18n.read",
    "settings.read",
    "settings.write",
    "shell.launchApp",
  ],
  services: ["auth", "shell", "storage", "i18n", "settings"],
  tags: ["tesla", "delivery", "checklist", "local-first"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "beta",
  metadata: {
    legacyToolId: "route:delivery-checklist",
    storageKeys: [
      "vatioboard.app.vatio.deliveryChecklist.sessions.v1",
      "vatioboard.app.vatio.deliveryChecklist.settings.activeSessionId",
      "vatioboard.app.vatio.deliveryChecklist.settings.lastModelKey",
    ],
  },
});
