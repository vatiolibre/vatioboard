import { IconPremiumClock } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const premiumClockWindowCapabilities = {
  draggable: true,
  resizable: false,
  minimizable: true,
  closable: true,
  restorable: true,
  maximizable: false,
  snap: false,
  preserveIntrinsicWidth: true,
  maxWidth: 390,
} as const;

export const premiumClockAppManifest = defineAppManifest({
  id: "vatio.premiumClock",
  title: "Premium Clock",
  shortTitle: "Clock",
  description: "Premium floating analog clock for a calm, glanceable cabin display.",
  kind: "tool-app",
  version: "1.0.0",
  icon: IconPremiumClock,
  theme: {
    color: "#111827",
    color2: "#d7dde5",
    foreground: "#f8fafc",
  },
  i18nKey: "premiumClock",
  entry: () => import("./index.js"),
  surfaces: ["shell-window", "start-menu", "taskbar", "launcher"],
  order: 62,
  permissions: ["shell.window", "storage.app", "tts.speak"],
  services: ["shell", "storage", "tts"],
  window: {
    shellWindowId: "premium-clock",
    mode: "floating",
    defaultBounds: { left: 36, top: 96, width: 390 },
    capabilities: premiumClockWindowCapabilities,
    restoreOnBoot: true,
    lazy: false,
  },
  tags: ["tool", "clock", "time", "cabin"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "stable",
  metadata: {
    legacyShellKind: "tool",
    sourceReference: {
      name: "TeslaScreens clock",
      url: "https://teslascreens.kinetic.com/clock.html",
      reuse: "visual-reference-only; no third-party code or image assets copied",
    },
  },
});
