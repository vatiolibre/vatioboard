import { IconKokoroTts } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const kokoroTtsWindowCapabilities = {
  draggable: true,
  resizable: false,
  minimizable: true,
  closable: true,
  restorable: true,
  maximizable: false,
  snap: false,
  preserveIntrinsicWidth: true,
  maxWidth: 430,
} as const;

export const kokoroTtsAppManifest = defineAppManifest({
  id: "vatio.kokoroTts",
  title: "Kokoro TTS Lab",
  shortTitle: "Kokoro",
  description: "Experimental local neural TTS tester with chunked model caching for constrained browsers.",
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
    defaultBounds: { left: 52, top: 108, width: 430 },
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
      name: "Kokoro TTS / kokoro-js / Transformers.js",
      license: "Apache-2.0",
      source: "https://github.com/hexgrad/kokoro",
      model: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
      runtime: "https://github.com/microsoft/onnxruntime",
    },
    teslaNote: "Model files and the ONNX Runtime Web WASM binary are cached through VatioBoard's 5 MB chunked IndexedDB store, but ONNX still loads the full binary/model into memory.",
  },
});
