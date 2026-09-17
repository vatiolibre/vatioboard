import { mountAudioDiagnosticSummary } from "../shared/audio-diagnostic-summary.js";
import * as runtime from "../shared/audio-runtime.js";
import { acquireBackgroundAudioLease, releaseBackgroundAudioLease } from "../shared/audio-system.js";
import { downloadBackgroundDiagnostics, getBackgroundDiagnostics, recordBackgroundDiagnostic } from "../shared/background-diagnostics.js";
import { subscribeAudioDiagnostics, stopAudioLifecycleDiagnostics } from "../shared/audio-lifecycle-diagnostics.js";

import { getRadioStreamRelayUrl, isRadioStationUuid } from "../shared/radio-browser.js";

const LEASE = "tesla-diagnostic";
// Matching Radio Browser record, checked 2026-09-16. No directory request is
// needed before the test gesture; both fields remain editable for comparisons.
const DEFAULT_RADIO = {
  name: "SomaFM Groove Salad (128k MP3)",
  stream: "https://ice2.somafm.com/groovesalad-128-mp3",
  uuid: "960cf833-0601-11e8-ae97-52543be04c81",
};

/** Small same-document fixtures: no network/auth latency in the START gesture. */
function testTone(frequency: number): string {
  const sampleRate = 8000;
  const samples = sampleRate * 30;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / 160, (samples - i - 1) / 160);
    view.setInt16(44 + i * 2, Math.round(2200 * envelope * Math.sin(2 * Math.PI * frequency * i / sampleRate)), true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

export function mountTeslaAudioTest(root: HTMLElement) {
  const location = new URL(window.location.href);
  location.searchParams.set("debugAudio", "1");
  window.history.replaceState(null, "", location);
  const urls = [testTone(220), testTone(330)];
  const tracks = urls.map((src, i) => ({ name: `tesla-test-${i}`, title: `Tesla test ${i + 1}`,
    artist: "VatioBoard", album: "Background audio diagnostics", media_kind: "audio", src }));
  let active = false;
  let baseline: HTMLAudioElement | null = null;
  let baselineContext: AudioContext | null = null;
  let baselineCleanup = () => {};
  const radioInputs = document.createElement("div");
  radioInputs.className = "radio-inputs";
  const streamInput = document.createElement("input");
  streamInput.placeholder = "HTTPS station stream URL";
  streamInput.type = "url";
  let station = { stream: DEFAULT_RADIO.stream, uuid: DEFAULT_RADIO.uuid };
  try {
    const stored = JSON.parse(sessionStorage.getItem("vatioboard.tesla-audio-station") || "null");
    if (typeof stored?.stream === "string" && typeof stored?.uuid === "string") station = stored;
  } catch { /* Storage is optional for this diagnostic page. */ }
  streamInput.value = station.stream;
  streamInput.spellcheck = false;
  streamInput.setAttribute("aria-label", "Station stream URL");
  const uuidInput = document.createElement("input");
  uuidInput.placeholder = "Radio Browser station UUID";
  uuidInput.value = station.uuid;
  uuidInput.spellcheck = false;
  uuidInput.setAttribute("aria-label", "Station UUID");
  const streamLabel = document.createElement("label");
  streamLabel.append("Station stream URL", streamInput);
  const uuidLabel = document.createElement("label");
  uuidLabel.append("Radio Browser station UUID", uuidInput);
  radioInputs.append(streamLabel, uuidLabel);
  const stationHint = document.createElement("p");
  stationHint.className = "station-hint";
  stationHint.textContent = `Default: ${DEFAULT_RADIO.name}. Edit both fields together to compare another station.`;
  const baselineHost = document.createElement("div");
  baselineHost.className = "baseline-player";
  const controls = document.createElement("div");
  controls.className = "test-controls";
  const status = document.createElement("pre");
  status.setAttribute("aria-live", "polite");
  const timeline = document.createElement("pre");
  const button = (label: string, action: () => unknown) => {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = label;
    control.addEventListener("click", () => {
      try { void Promise.resolve(action()).catch((error) => { status.textContent = String(error); }); }
      catch (error) { status.textContent = String(error); }
    });
    controls.append(control);
  };
  const stop = () => {
    baselineCleanup();
    baselineCleanup = () => {};
    if (baseline) {
      baseline.pause();
      baseline.removeAttribute("src");
      baseline.load();
      baseline.remove();
      baseline = null;
    }
    if (baselineContext) void baselineContext.close().catch(() => {});
    baselineContext = null;
    releaseBackgroundAudioLease(LEASE);
    if (active) runtime.stopPlayback();
    active = false;
    stopAudioLifecycleDiagnostics();
    status.textContent = JSON.stringify(runtime.getState(), null, 2);
    timeline.textContent = JSON.stringify(getBackgroundDiagnostics().slice(-40), null, 2);
  };
  button("START TESLA BACKGROUND TEST", () => {
    if (active) return;
    stop();
    active = true;
    runtime.setQueue(tracks);
    void acquireBackgroundAudioLease(LEASE);
  });
  const startRadio = (mode: "direct" | "relay" | "graph" | "runtime") => {
    const stream = new URL(streamInput.value);
    if (stream.protocol !== "https:") throw new Error("Enter an HTTPS station stream URL.");
    const uuid = uuidInput.value.trim();
    if (mode !== "direct" && !isRadioStationUuid(uuid)) throw new Error("Enter the station UUID.");
    stop();
    if (mode === "runtime") {
      active = true;
      const playback = runtime.playTrackNow({ name: `radio:${uuid}`, title: "Tesla radio test",
        artist: "VatioBoard", media_kind: "radio", station_uuid: uuid, hls: 0,
        url_resolved: stream.href }, { fromUserGesture: true });
      void acquireBackgroundAudioLease(LEASE);
      return playback;
    }
    // Each baseline gets a fresh element: detaching an analyser cannot undo
    // createMediaElementSource. Baselines deliberately acquire no runtime leases.
    const element = document.createElement("audio");
    baseline = element;
    element.controls = true;
    element.preload = "none";
    if (mode !== "direct") element.crossOrigin = "anonymous";
    const sourceUrl = mode === "direct" ? stream.href : getRadioStreamRelayUrl(uuid);
    if (!sourceUrl) throw new Error("Radio relay is not configured.");
    element.src = sourceUrl;
    baselineHost.append(element);
    if (mode === "graph") {
      baselineContext = new AudioContext();
      const source = baselineContext.createMediaElementSource(element);
      source.connect(baselineContext.destination);
      void baselineContext.resume().catch(() => {});
    }
    const report = (event: Event) => {
      const snapshot = { requestedOutputMode: mode, mediaEvent: event.type,
        visibility: document.visibilityState, paused: element.paused,
        primaryCurrentTime: element.currentTime, primaryDuration: element.duration,
        audioContextState: baselineContext?.state || "none", readyState: element.readyState,
        networkState: element.networkState };
      status.textContent = JSON.stringify(snapshot, null, 2);
      if (event.type !== "timeupdate") recordBackgroundDiagnostic("radio-baseline", snapshot);
      timeline.textContent = JSON.stringify(getBackgroundDiagnostics().slice(-40), null, 2);
    };
    const events = ["play", "playing", "pause", "waiting", "stalled", "error", "emptied", "timeupdate"];
    for (const event of events) element.addEventListener(event, report);
    document.addEventListener("visibilitychange", report);
    baselineCleanup = () => {
      for (const event of events) element.removeEventListener(event, report);
      document.removeEventListener("visibilitychange", report);
    };
    element.load();
    return element.play();
  };
  button("POC direct radio", () => startRadio("direct"));
  button("Relay native radio", () => startRadio("relay"));
  button("Relay Web Audio radio", () => startRadio("graph"));
  button("VatioBoard native radio", () => startRadio("runtime"));
  button("STOP TEST", stop);
  button("Play", () => active && runtime.play());
  button("Pause real track", () => active && runtime.pause());
  button("Next", () => active && runtime.nextTrack());
  button("Previous", () => active && runtime.previousTrack());
  button("Seek +10 seconds", () => active && runtime.seekForward(10));
  button("Rearm keep-alive", () => active && runtime.rearmBackgroundPlayback());
  button("Stop everything", stop);
  button("Export report", downloadBackgroundDiagnostics);
  // The Player consumes completed/skipped queue entries. Maintain a two-track
  // test queue so a multi-minute run never terminates or releases its Player lease.
  const unsubscribeQueue = runtime.subscribe((snapshot) => {
    if (!active || !snapshot.currentTrack || snapshot.queue.length !== 1) return;
    const index = tracks.findIndex((track) => track.name === snapshot.queue[0].name);
    if (index >= 0) runtime.enqueue([tracks[(index + 1) % tracks.length]]);
  });
  const unsubscribe = subscribeAudioDiagnostics((snapshot) => {
    status.textContent = JSON.stringify({ ...snapshot, musicPaused: runtime.getState().paused, backgroundStatus: runtime.getState().backgroundPlaybackState }, null, 2);
    timeline.textContent = JSON.stringify(getBackgroundDiagnostics().slice(-40), null, 2);
  });
  const section = document.createElement("section");
  section.className = "diagnostic-panels";
  const stateColumn = document.createElement("div");
  const timelineColumn = document.createElement("div");
  const stateTitle = document.createElement("h2");
  stateTitle.textContent = "Current state";
  const timelineTitle = document.createElement("h2");
  timelineTitle.textContent = "Recent events";
  status.tabIndex = 0;
  status.setAttribute("aria-label", "Current audio state");
  timeline.tabIndex = 0;
  timeline.setAttribute("aria-label", "Audio event timeline");
  stateColumn.append(stateTitle, status);
  timelineColumn.append(timelineTitle, timeline);
  section.append(stateColumn, timelineColumn);
  root.replaceChildren(radioInputs, stationHint, controls, baselineHost, section);
  const disposeSummary = mountAudioDiagnosticSummary(root);
  return () => {
    disposeSummary();
    stop();
    unsubscribe();
    unsubscribeQueue();
    for (const url of urls) URL.revokeObjectURL(url);
    root.replaceChildren();
  };
}

const root = document.getElementById("tesla-audio-test");
if (root) mountTeslaAudioTest(root);
