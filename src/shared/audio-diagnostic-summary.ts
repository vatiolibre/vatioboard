import "./audio-diagnostic-summary.css";
import { getAudioElement, getState } from "./audio-runtime.js";
import { getAudioDiagnosticSnapshot, subscribeAudioDiagnostics } from "./audio-lifecycle-diagnostics.js";
import { getBackgroundAudioState, getBackgroundKeepAliveAudio, subscribeBackgroundAudioState } from "./audio-system.js";
import {
  getAudioObservation, isBackgroundDiagnosticsEnabled, setAudioObservationResult,
  setAudioObservationVehicle, type AudioTestResult,
} from "./background-diagnostics.js";

/** A photographable report. Reuses the existing observer; never starts a timer. */
export function mountAudioDiagnosticSummary(root: HTMLElement) {
  if (!isBackgroundDiagnosticsEnabled()) return () => {};
  const panel = document.createElement("details");
  panel.className = "audio-diagnostic-summary";
  const heading = document.createElement("summary");
  heading.textContent = "Audio test summary";
  const automatic = document.createElement("pre");
  automatic.setAttribute("aria-label", "Automatic audio observations");
  const vehicleLabel = document.createElement("label");
  vehicleLabel.textContent = "Tesla software version (entered manually)";
  const vehicle = document.createElement("input");
  vehicle.maxLength = 80;
  vehicle.value = getAudioObservation().vehicleVersion;
  vehicle.addEventListener("input", () => setAudioObservationVehicle(vehicle.value));
  vehicleLabel.append(vehicle);
  const manual = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "Your observations — not detected automatically";
  manual.append(legend);
  for (const [key, title] of [["takeover", "Stops other Tesla audio"], ["thirtySeconds", "Continues minimized: 30 seconds"], ["fiveMinutes", "Continues minimized: five minutes"]]) {
    const label = document.createElement("label");
    label.textContent = title;
    const select = document.createElement("select");
    for (const result of ["Not tested", "Pass", "Fail"]) select.add(new Option(result, result));
    select.value = getAudioObservation().results[key];
    select.addEventListener("change", () => setAudioObservationResult(key, select.value as AudioTestResult));
    label.append(select);
    manual.append(label);
  }
  const note = document.createElement("p");
  note.textContent = "Counts cover this page session. Unrequested pauses include native/browser pauses. Resolved recovery calls do not prove audible playback. Photograph this summary; downloads are optional.";
  panel.append(heading, automatic, vehicleLabel, manual, note);
  root.append(panel);
  function render() {
    const observation = getAudioObservation();
    const progress = getAudioDiagnosticSnapshot();
    const primary = getAudioElement();
    const keepAlive = getBackgroundKeepAliveAudio();
    const retention = getBackgroundAudioState();
    const elapsed = Math.max(0, Math.floor((Date.now() - observation.startedAt) / 1000));
    automatic.textContent = [
      `Build: ${import.meta.env.VITE_BUILD_ID || "development"}`,
      `Observation: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s · ${document.visibilityState}`,
      `Restored radio retention: ${getState().restoredRadioSession ? "yes (visuals manual)" : "no"}`,
      `Primary attached: ${primary?.isConnected ?? false} · controls: ${primary?.controls ?? false}`,
      `Primary: ${primary?.paused === false ? "playing/requested" : "paused"} · time: ${Number(primary?.currentTime || 0).toFixed(1)}s`,
      `Media Session declared: ${navigator.mediaSession?.playbackState ?? "unsupported"} (focus not confirmed)`,
      `Retention: ${retention.status} · silent paused: ${keepAlive.paused}`,
      `Owners: ${retention.activeLeaseIds.join(", ") || "none"}`,
      `Silent attached: ${keepAlive.isConnected ?? false} · time: ${Number(keepAlive.currentTime || 0).toFixed(1)}s`,
      `Media progress events: primary ${progress.primaryTimeupdates ?? 0} · silent ${progress.keepAliveTimeupdates ?? 0}`,
      `Unrequested pauses: ${observation.interruptions}`,
      `Recovery calls: ${observation.recoveryAttempts} · resolved: ${observation.recoveryResolved} · rejected: ${observation.recoveryRejected}`,
      `Latest lifecycle: ${observation.latestLifecycle}`,
    ].join("\n");
  }
  const unsubscribe = subscribeAudioDiagnostics(render);
  const unsubscribeRetention = subscribeBackgroundAudioState(render);
  panel.addEventListener("toggle", render);
  return () => { unsubscribe(); unsubscribeRetention(); panel.remove(); };
}
