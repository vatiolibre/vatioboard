import "../styles/player.less";
import { createMiniAudioVisualizer } from "../shared/audio-mini-visualizer.js";
import { createMilkdropPanel } from "./milkdrop-panel.js";
import * as runtime from "../shared/audio-runtime.js";
import { getBackgroundAudioState, getBackgroundKeepAliveAudio } from "../shared/audio-system.js";
import { mountAudioDiagnosticSummary } from "../shared/audio-diagnostic-summary.js";
import {
  startAudioLifecycleDiagnostics,
  stopAudioLifecycleDiagnostics,
  subscribeAudioDiagnostics,
} from "../shared/audio-lifecycle-diagnostics.js";
import {
  getBackgroundDiagnostics,
  downloadBackgroundDiagnostics,
} from "../shared/background-diagnostics.js";
import { getRadioStreamRelayUrl } from "../shared/radio-browser.js";

function testTone(frequency: number): string {
  const sampleRate = 8000;
  const samples = sampleRate * 30;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / 160, (samples - i - 1) / 160);
    view.setInt16(
      44 + i * 2,
      Math.round(2200 * envelope * Math.sin((2 * Math.PI * frequency * i) / sampleRate)),
      true,
    );
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

export function mountTeslaAudioTest(root: HTMLElement) {
  const location = new URL(window.location.href);
  location.searchParams.set("debugAudio", "1");
  window.history.replaceState(null, "", location);
  const urls = [testTone(220), testTone(330)];
  const tracks = urls.map((src, i) => ({
    name: `tesla-tone-${i}`,
    title: `Test tone ${i + 1}`,
    src,
    media_kind: "audio",
  }));
  let runtimeOwned = false;
  const analysisOwner = Symbol("harness-visualizer");
  let visualizationGeneration = 0;
  let mini: ReturnType<typeof createMiniAudioVisualizer> | null = null;
  let miniMode: "scope" | "spectrum" | null = null;
  let miniElement: HTMLAudioElement | null = null;
  let milkdrop: ReturnType<typeof createMilkdropPanel> | null = null;
  const visualizerHost = document.createElement("div");
  visualizerHost.style.minHeight = "100px";
  visualizerHost.hidden = true;
  function stopVisualizations() {
    visualizationGeneration++;
    miniMode = null; miniElement = null;
    mini?.destroy(); mini = null;
    milkdrop?.destroy(); milkdrop = null;
    visualizerHost.hidden = true;
    runtime.releaseRadioVisualization(analysisOwner);
  }
  function syncMini() {
    const element = runtime.getState().isLive ? runtime.getVisualizationAudioElement() : null;
    if (!miniMode || !element || document.hidden) {
      mini?.destroy(); mini = null; miniElement = null;
      visualizerHost.hidden = true;
      return;
    }
    visualizerHost.hidden = false;
    if (miniElement === element && mini) { mini.setMode(miniMode); return; }
    mini?.destroy();
    miniElement = element;
    const controller = createMiniAudioVisualizer({ mediaElement: element, mount: visualizerHost, mode: miniMode });
    mini = controller;
    void controller.start().then(ready => {
      if (mini !== controller || ready) return;
      miniMode = null;
      runtime.releaseRadioVisualization(analysisOwner);
      syncMini();
    });
  }
  async function showMini(mode: "scope" | "spectrum") {
    if (!runtimeOwned) return;
    const token = ++visualizationGeneration;
    miniMode = mode;
    await runtime.requestRadioVisualization(analysisOwner);
    if (token === visualizationGeneration) syncMini();
  }
  let reference: HTMLAudioElement | null = null;
  let referenceContext: AudioContext | null = null;
  const info = document.createElement("p");
  info.textContent =
    "Main audio baseline restored. Test recording and alerts in the main app. This page compares native radio and the MP3 path; former retentionTest switches have no effect.";
  const mainLink = document.createElement("a");
  mainLink.href = "/?debugAudio=1";
  mainLink.textContent = "Open main app for recording / alerts";
  const inputs = document.createElement("div");
  inputs.className = "radio-inputs";
  const input = (label: string, value: string) => {
    const el = document.createElement("input");
    el.value = value;
    el.setAttribute("aria-label", label);
    const wrapper = document.createElement("label");
    wrapper.append(label, el);
    inputs.append(wrapper);
    return el;
  };
  const stream = input("Station stream URL", "https://ice2.somafm.com/groovesalad-128-mp3");
  const uuid = input("Station UUID", "960cf833-0601-11e8-ae97-52543be04c81");
  const controls = document.createElement("div");
  controls.className = "test-controls";
  const baselineHost = document.createElement("div");
  baselineHost.className = "baseline-player";
  const status = document.createElement("pre");
  status.setAttribute("aria-live", "polite");
  const timeline = document.createElement("pre");
  const panels = document.createElement("section");
  panels.className = "diagnostic-panels";
  const col = (title: string, contents: HTMLElement) => {
    const div = document.createElement("div");
    const heading = document.createElement("h2");
    heading.textContent = title;
    div.append(heading, contents);
    panels.append(div);
  };
  col("Current state", status);
  col("Recent events", timeline);
  const observer = () =>
    startAudioLifecycleDiagnostics({
      getPrimary: () => reference || runtime.getAudioElement(),
      keepAlive: getBackgroundKeepAliveAudio(),
      getLeaseIds: () => getBackgroundAudioState().activeLeaseIds,
    });
  const stopReference = () => {
    if (reference) {
      reference.pause();
      reference.removeAttribute("src");
      reference.load();
      reference.remove();
      reference = null;
    }
    if (referenceContext) void referenceContext.close().catch(() => {});
    referenceContext = null;
  };
  const stop = () => {
    stopVisualizations();
    stopReference();
    if (runtimeOwned) runtime.stopPlayback();
    runtimeOwned = false;
  };
  const button = (name: string, action: () => unknown) => {
    const el = document.createElement("button");
    el.textContent = name;
    el.addEventListener("click", () => {
      try {
        void Promise.resolve(action()).catch((error) => {
          status.textContent = String(error);
        });
      } catch (error) {
        status.textContent = String(error);
      }
    });
    controls.append(el);
  };
  const startRadio = () => {
    stopReference();
    runtimeOwned = true;
    const playback = runtime.playTrackNow({
      name: `radio:${uuid.value}`,
      title: "Radio test",
      media_kind: "radio",
      station_uuid: uuid.value,
      url_resolved: stream.value,
      hls: 0,
    });
    observer();
    return playback;
  };
  button("START selected test", startRadio);
  button("VatioBoard native radio", startRadio);
  for (const [name, relay, graph] of [
    ["POC direct radio", false, false],
    ["Relay native radio", true, false],
    ["Relay Web Audio radio", true, true],
  ] as const) {
    button(name, () => {
      stop();
      const audio = document.createElement("audio");
      reference = audio;
      audio.controls = true;
      audio.preload = "none";
      if (relay) audio.crossOrigin = "anonymous";
      audio.src = relay ? getRadioStreamRelayUrl(uuid.value) : stream.value;
      baselineHost.append(audio);
      if (graph) {
        referenceContext = new AudioContext();
        referenceContext.createMediaElementSource(audio).connect(referenceContext.destination);
        void referenceContext.resume();
      }
      const playback = audio.play();
      observer();
      return playback;
    });
  }
  button("START TESLA BACKGROUND TEST", () => {
    stopReference();
    runtimeOwned = true;
    runtime.setQueue(tracks);
    observer();
  });
  button("Radio spectrum", () => showMini("spectrum"));
  button("Radio scope", () => showMini("scope"));
  button("Radio Milkdrop", () => {
    if (!runtimeOwned) return;
    milkdrop ??= createMilkdropPanel({ mount: root, restoreVisibility: false });
    return milkdrop.open();
  });
  button("Disable visualizations", stopVisualizations);
  button("Play", () => runtimeOwned && runtime.play({ fromUserGesture: true }));
  button("Pause real track", () => runtimeOwned && runtime.pause());
  button("Next", () => runtimeOwned && runtime.nextTrack());
  button("Previous", () => runtimeOwned && runtime.previousTrack());
  button("Seek +10 seconds", () => runtimeOwned && runtime.seekForward(10));
  button("Rearm keep-alive", () => runtimeOwned && runtime.rearmBackgroundPlayback());
  button("STOP TEST", stop);
  button("Stop everything", stop);
  button("Export report", downloadBackgroundDiagnostics);
  const unsubscribeQueue = runtime.subscribe((snapshot) => {
    syncMini();
    if (
      runtimeOwned &&
      snapshot.queue.length === 1 &&
      tracks.some((track) => track.name === snapshot.currentTrack?.name)
    ) {
      runtime.enqueue([tracks.find((track) => track.name !== snapshot.currentTrack.name)]);
    }
  });
  const unsubscribe = subscribeAudioDiagnostics((snapshot) => {
    status.textContent = JSON.stringify(
      {
        ...snapshot,
        musicPaused: runtime.getState().paused,
        backgroundStatus: getBackgroundAudioState().status,
        visualizationStatus: runtime.getRadioVisualizationStatus(),
        analysisCurrentTime: runtime.getVisualizationAudioElement()?.currentTime ?? 0,
      },
      null,
      2,
    );
    timeline.textContent = JSON.stringify(getBackgroundDiagnostics().slice(-30), null, 2);
  });
  root.replaceChildren(info, mainLink, inputs, controls, baselineHost, visualizerHost, panels);
  const summaryCleanup = mountAudioDiagnosticSummary(root);
  observer();
  return () => {
    summaryCleanup();
    stop();
    unsubscribe();
    unsubscribeQueue();
    stopAudioLifecycleDiagnostics();
    urls.forEach((url) => URL.revokeObjectURL(url));
    root.replaceChildren();
  };
}
const root = document.getElementById("tesla-audio-test");
if (root) mountTeslaAudioTest(root);
