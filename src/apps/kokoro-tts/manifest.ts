import { IconTts } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const kokoroTtsWindowCapabilities = {
  draggable: true,
  resizable: true,
  minimizable: true,
  closable: true,
  restorable: true,
  maximizable: false,
  snap: false,
  preserveIntrinsicWidth: false,
  maxWidth: 620,
  maxHeight: 720,
} as const;

export const kokoroTtsAppManifest = defineAppManifest({
  id: "vatio.kokoroTts",
  title: "TTS",
  shortTitle: "TTS",
  description: "Local text-to-speech tester with Piper neural voices, tiny eSpeak fallback, and a Kokoro lab engine.",
  kind: "tool-app",
  version: "0.1.0",
  icon: IconTts,
  theme: {
    color: "#16a34a",
    color2: "#bbf7d0",
    foreground: "#ecfdf5",
  },
  i18nKey: "kokoroTts",
  entry: () => import("./index.js"),
  surfaces: ["shell-window", "start-menu", "taskbar", "launcher"],
  order: 64,
  permissions: ["storage.app", "settings.read", "settings.write", "shell.window"],
  services: ["shell", "storage", "settings"],
  window: {
    shellWindowId: "kokoro-tts",
    mode: "floating",
    defaultBounds: { left: 52, top: 108, width: 456, height: 560 },
    capabilities: kokoroTtsWindowCapabilities,
    restoreOnBoot: false,
    lazy: true,
  },
  tags: ["tool", "tts", "voice", "piper", "kokoro", "espeak", "experimental"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: false,
  status: "experimental",
  metadata: {
    attribution: {
      name: "TTS / Piper neural engine / eSpeak NG tiny engine / Kokoro lab engine",
      license: "Apache-2.0 / MIT / GPL-3.0-or-later",
      source: "https://github.com/rhasspy/piper",
      model: "https://huggingface.co/rhasspy/piper-voices",
      kokoroModel: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
      runtime: "https://github.com/microsoft/onnxruntime",
      espeak: "https://github.com/ianmarmour/espeak-ng.js",
      piperWeb: "https://github.com/Poket-Jony/piper-tts-web",
    },
    teslaNote: "Piper and Kokoro model/runtime assets are cached through VatioBoard's 5 MB chunked IndexedDB store, but ONNX still loads the selected binary/model into memory. eSpeak remains available as a tiny fallback.",
  },
});
