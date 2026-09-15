import * as runtime from "../shared/audio-runtime.js";
import { acquireBackgroundAudioLease, releaseBackgroundAudioLease } from "../shared/audio-system.js";
import { downloadBackgroundDiagnostics, getBackgroundDiagnostics } from "../shared/background-diagnostics.js";
import { subscribeAudioDiagnostics, stopAudioLifecycleDiagnostics } from "../shared/audio-lifecycle-diagnostics.js";

const LEASE = "tesla-diagnostic";

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
  const controls = document.createElement("div");
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
    if (active) runtime.stopPlayback();
    active = false;
    releaseBackgroundAudioLease(LEASE);
    stopAudioLifecycleDiagnostics();
    status.textContent = JSON.stringify(runtime.getState(), null, 2);
    timeline.textContent = JSON.stringify(getBackgroundDiagnostics().slice(-40), null, 2);
  };
  button("START TESLA BACKGROUND TEST", () => {
    if (active) return;
    active = true;
    void acquireBackgroundAudioLease(LEASE);
    runtime.setQueue(tracks);
  });
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
    status.textContent = JSON.stringify({ ...snapshot, musicPaused: runtime.getState().paused }, null, 2);
    timeline.textContent = JSON.stringify(getBackgroundDiagnostics().slice(-40), null, 2);
  });
  const section = document.createElement("section");
  const stateColumn = document.createElement("div");
  const timelineColumn = document.createElement("div");
  stateColumn.append("Current state", status);
  timelineColumn.append("Recent events", timeline);
  section.append(stateColumn, timelineColumn);
  root.replaceChildren(controls, section);
  return () => {
    stop();
    unsubscribe();
    unsubscribeQueue();
    for (const url of urls) URL.revokeObjectURL(url);
    root.replaceChildren();
  };
}

const root = document.getElementById("tesla-audio-test");
if (root) mountTeslaAudioTest(root);
