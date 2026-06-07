import { IconTts } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const ttsWindowCapabilities = {
  draggable: true,
  resizable: true,
  minimizable: true,
  closable: true,
  restorable: true,
  maximizable: false,
  snap: false,
  preserveIntrinsicWidth: false,
  minWidth: 320,
  minHeight: 360,
  maxWidth: 620,
  maxHeight: 720,
} as const;

export const ttsAppManifest = defineAppManifest({
  id: "vatio.tts",
  title: "TTS",
  shortTitle: "TTS",
  description: "Local text-to-speech tester with curated Piper neural voices and Tesla-safe chunked model caching.",
  kind: "tool-app",
  version: "0.1.0",
  icon: IconTts,
  theme: {
    color: "#16a34a",
    color2: "#bbf7d0",
    foreground: "#ecfdf5",
  },
  i18nKey: "tts",
  entry: () => import("./index.js"),
  surfaces: ["shell-window", "start-menu", "taskbar", "launcher"],
  order: 64,
  permissions: ["storage.app", "settings.read", "settings.write", "shell.window", "tts.speak"],
  services: ["shell", "storage", "settings", "tts"],
  window: {
    shellWindowId: "tts",
    mode: "floating",
    defaultBounds: { left: 52, top: 108, width: 456, height: 510 },
    capabilities: ttsWindowCapabilities,
    restoreOnBoot: false,
    lazy: true,
  },
  tags: ["tool", "tts", "voice", "piper", "experimental"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: false,
  status: "experimental",
  metadata: {
    attribution: {
      name: "TTS / Piper neural engine",
      license: "MIT",
      source: "https://github.com/rhasspy/piper",
      model: "https://huggingface.co/rhasspy/piper-voices",
      runtime: "https://github.com/microsoft/onnxruntime",
      piperWeb: "https://github.com/Poket-Jony/piper-tts-web",
    },
    teslaNote: "Piper model/runtime assets are cached through VatioBoard's 5 MB chunked IndexedDB store, but ONNX still loads the selected voice model into memory.",
  },
});
