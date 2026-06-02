import { IconCalculator } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

const calculatorWindowCapabilities = {
  draggable: true,
  resizable: false,
  minimizable: true,
  closable: true,
  restorable: true,
  maximizable: false,
  snap: false,
  preserveIntrinsicWidth: true,
  maxWidth: 320,
} as const;

export const calculatorAppManifest = defineAppManifest({
  id: "vatio.calculator",
  title: "Calculator",
  shortTitle: "Calc",
  description: "Floating calculator for quick arithmetic inside VatioBoard.",
  kind: "tool-app",
  version: "1.0.0",
  icon: IconCalculator,
  theme: {
    color: "#2563eb",
    color2: "#60a5fa",
  },
  i18nKey: "calculator",
  entry: () => import("./index.js"),
  surfaces: ["shell-window", "start-menu", "taskbar", "launcher"],
  order: 60,
  permissions: ["storage.app", "i18n.read", "settings.read", "settings.write", "shell.window"],
  services: ["shell", "storage", "i18n", "settings"],
  window: {
    shellWindowId: "calculator",
    mode: "floating",
    defaultBounds: { left: 24, top: 88, width: 320 },
    capabilities: calculatorWindowCapabilities,
    restoreOnBoot: true,
    lazy: false,
  },
  tags: ["tool", "math"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "stable",
  metadata: {
    legacyToolId: "calculator",
    legacyToolSurfaces: ["floating-tools"],
    legacyShellKind: "tool",
  },
});
