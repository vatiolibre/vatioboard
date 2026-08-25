import {
  IconGpsLab,
  IconMuted,
  IconPause,
  IconRestart,
  IconSettings,
  IconVolume,
  IconWaze,
} from "../../icons.js";

const wazeTemplate = String.raw`
  <h1 class="sr-only" data-i18n="wazeRouteH1">Waze live map</h1>
  <p class="sr-only" data-i18n="wazeRouteLead">Full-screen Waze map with live GPS speed and driving alert status.</p>

  <div class="waze-app" data-waze-app>
    <div class="waze-map-shell">
      <iframe
        id="wazeFrame"
        class="waze-frame"
        title="Waze map"
        loading="lazy"
        allow="geolocation; fullscreen"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen
      ></iframe>

      <div id="wazePlaceholder" class="waze-placeholder" role="status" aria-live="polite">
        <span class="waze-placeholder-icon" aria-hidden="true">${IconWaze}</span>
        <span class="waze-placeholder-kicker" data-i18n="wazeMap">Waze map</span>
        <p id="wazePlaceholderText" data-i18n="liveMapWaitingGps">Waiting for GPS to center the live map.</p>
      </div>

      <div class="waze-hud">
        <div id="wazeSpeedPill" class="waze-speed-pill">
          <div class="waze-speed-heading">
            <span class="waze-speed-kicker" data-i18n="liveSpeed">Live speed</span>
            <span class="waze-brand-icon" aria-hidden="true">${IconWaze}</span>
          </div>
          <div class="waze-speed-reading">
            <strong id="wazeSpeedValue">0</strong>
            <span id="wazeSpeedUnit">km/h</span>
          </div>
          <div class="waze-speed-limit">
            <span id="wazeSpeedLimitLabel" class="waze-speed-limit-label" data-i18n="alerts">Alerts</span>
            <strong id="wazeSpeedLimitValue" class="waze-speed-limit-value" data-i18n="off">Off</strong>
          </div>
          <p id="wazeSpeedNote" class="waze-speed-note" hidden></p>
        </div>

        <div class="waze-hud-actions" role="toolbar" data-i18n-aria="wazeDrivingControls" aria-label="Waze driving controls">
          <button
            id="quickAudioToggle"
            class="waze-toolbar-btn waze-toolbar-btn-audio"
            type="button"
            data-i18n-aria="toggleAlertAudio"
            data-i18n-title="toggleAlertAudio"
            aria-label="Toggle alert audio"
            title="Toggle alert audio"
            aria-pressed="true"
          >
            <span class="waze-toolbar-icon waze-audio-icon waze-audio-icon-on" aria-hidden="true">${IconVolume}</span>
            <span class="waze-toolbar-icon waze-audio-icon waze-audio-icon-muted" aria-hidden="true">${IconMuted}</span>
          </button>
          <button
            id="quickAlertConfig"
            class="waze-toolbar-btn waze-toolbar-btn-alerts"
            type="button"
            data-i18n-aria="configureAlerts"
            data-i18n-title="configureAlerts"
            aria-label="Configure alerts"
            title="Configure alerts"
            aria-pressed="false"
          >
            <span class="waze-toolbar-icon" aria-hidden="true">${IconSettings}</span>
          </button>
          <button
            id="toggleRecording"
            class="waze-toolbar-btn waze-toolbar-btn-recording"
            type="button"
            data-recording-icon="record"
            aria-label="Start recording"
            title="Start recording"
            aria-pressed="false"
          >
            <span class="waze-toolbar-icon waze-recording-icon waze-recording-icon-record" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="6.5" fill="currentColor"/></svg>
            </span>
            <span class="waze-toolbar-icon waze-recording-icon waze-recording-icon-pause" aria-hidden="true">${IconPause}</span>
          </button>
          <button
            id="stopRecording"
            class="waze-toolbar-btn waze-toolbar-btn-stop"
            type="button"
            data-i18n-aria="stopRecording"
            data-i18n-title="stopRecording"
            aria-label="Stop recording"
            title="Stop recording"
            hidden
          >
            <span class="waze-toolbar-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg>
            </span>
          </button>
          <button
            id="wazeLocationPrompt"
            class="waze-toolbar-btn waze-location-prompt"
            type="button"
            data-i18n-aria="enableWazeLocation"
            data-i18n-title="enableWazeLocation"
            aria-label="Enable Waze location"
            title="Enable Waze location"
          >
            <span class="waze-toolbar-icon" aria-hidden="true">${IconGpsLab}</span>
          </button>
          <button
            id="wazeRecenter"
            class="waze-toolbar-btn waze-recenter"
            type="button"
            data-i18n-aria="recenterMap"
            data-i18n-title="recenterMap"
            aria-label="Refresh map"
            title="Refresh map"
          >
            <span class="waze-toolbar-icon" aria-hidden="true">${IconRestart}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
`;

export default wazeTemplate;
