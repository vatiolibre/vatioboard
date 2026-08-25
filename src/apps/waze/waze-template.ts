import { IconWaze } from "../../icons.js";

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

        <div class="waze-hud-actions">
          <button
            id="wazeLocationPrompt"
            class="waze-location-prompt"
            type="button"
            data-i18n-aria="enableWazeLocation"
            aria-label="Enable Waze location"
          >
            <span data-i18n="wazeEnableAction">Enable</span>
          </button>
          <button
            id="wazeRecenter"
            class="waze-recenter"
            type="button"
            data-i18n="wazeRefreshAction"
            data-i18n-aria="recenterMap"
            aria-label="Refresh map"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  </div>
`;

export default wazeTemplate;
