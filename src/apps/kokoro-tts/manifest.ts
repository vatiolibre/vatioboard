import { IconKokoroTts } from "../../icons.js";
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
  title: "Kokoro TTS Lab",
  shortTitle: "Kokoro",
  description: "Experimental local neural TTS tester with WebGPU/WASM acceleration and chunked model caching for constrained browsers.",
  kind: "tool-app",
  version: "0.1.0",
  icon: IconKokoroTts,
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
  tags: ["tool", "tts", "voice", "kokoro", "experimental"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: false,
  status: "experimental",
  metadata: {
    attribution: {
      name: "Kokoro TTS / kokoro-web-inspired direct ONNX runtime / eSpeak NG",
      license: "Apache-2.0 / MIT / GPL-3.0-or-later",
      source: "https://github.com/eduardolat/kokoro-web",
      model: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
      runtime: "https://github.com/microsoft/onnxruntime",
      phonemizer: "https://github.com/ianmarmour/espeak-ng.js",
    },
    teslaNote: "Model, voice, eSpeak NG, and ONNX Runtime Web WASM files are cached through VatioBoard's 5 MB chunked IndexedDB store, but ONNX still loads the selected binary/model into memory.",
  },
});
