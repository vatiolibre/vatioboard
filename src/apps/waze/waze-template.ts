import {
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
      ></iframe>

      <div id="wazePlaceholder" class="waze-placeholder" role="status" aria-live="polite">
        <span class="waze-placeholder-icon" aria-hidden="true">${IconWaze}</span>
        <span class="waze-placeholder-kicker" data-i18n="wazeMap">Waze map</span>
        <p id="wazePlaceholderText" data-i18n="liveMapWaitingGps">Waiting for GPS to center the live map.</p>
      </div>

      <div id="wazeDrivingHud" class="waze-driving-hud"></div>
    </div>
  </div>
`;

export default wazeTemplate;
