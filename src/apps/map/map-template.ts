import { IconGpsLab, IconMore, IconRestart, IconWorld } from "../../icons.js";

const mapTemplate = String.raw`
  <h1 class="sr-only" data-i18n="mapAppTitle">Map</h1>
  <p class="sr-only" data-i18n="mapAppLead">Live driving map with speed-camera information.</p>

  <main class="map-app" data-map-app data-map-status="idle" data-map-presentation="2d">
    <div id="mapSurface" class="map-surface" aria-label="Map"></div>
    <div id="mapDrivingHud" class="map-driving-hud"></div>

    <div class="map-view-tools" role="toolbar" data-i18n-aria="mapViewControls" aria-label="Map view controls">
      <button id="mapPresentation" class="map-view-btn" type="button" aria-haspopup="menu" aria-expanded="false" data-i18n-aria="mapPresentation" aria-label="Map presentation">
        <span aria-hidden="true">${IconWorld}</span>
        <span id="mapPresentationLabel" class="map-view-btn-label">2D</span>
      </button>
      <button id="mapOrientation" class="map-view-btn" type="button" data-i18n-aria="cameraMapNorthUp" aria-label="North up">
        <strong aria-hidden="true">N</strong>
      </button>
      <button id="mapRefresh" class="map-view-btn" type="button" data-i18n-aria="cameraMapRefreshArea" aria-label="Refresh visible area">
        <span aria-hidden="true">${IconRestart}</span>
      </button>
      <button id="mapMore" class="map-view-btn map-view-btn-more" type="button" aria-haspopup="dialog" aria-expanded="false" data-i18n-aria="mapMoreTools" aria-label="More map tools">
        <span aria-hidden="true">${IconMore}</span>
      </button>
    </div>

    <div id="mapPresentationMenu" class="map-presentation-menu" role="menu" hidden>
      <button type="button" role="menuitemradio" data-map-presentation-option="2d" aria-checked="true">2D</button>
      <button type="button" role="menuitemradio" data-map-presentation-option="3d" aria-checked="false">3D</button>
      <button type="button" role="menuitemradio" data-map-presentation-option="globe" aria-checked="false" data-i18n="mapGlobe">Globe</button>
    </div>

    <section id="mapMoreSheet" class="map-tools-sheet" role="dialog" aria-modal="true" data-i18n-aria="mapMoreTools" aria-label="More map tools" hidden>
      <header>
        <h2 data-i18n="mapTools">Map tools</h2>
        <button id="mapMoreClose" type="button" data-i18n-aria="close" aria-label="Close">×</button>
      </header>
      <div class="map-tools-sheet-body">
        <button id="mapSheetLayers" type="button" data-i18n="cameraMapLayers">Map layers</button>
        <button id="mapSheetFollow" type="button"><span aria-hidden="true">${IconGpsLab}</span><span data-i18n="cameraMapFollow">Follow vehicle</span></button>
        <button id="mapSheetRefresh" type="button"><span aria-hidden="true">${IconRestart}</span><span data-i18n="cameraMapRefreshArea">Refresh visible area</span></button>
      </div>
    </section>

    <div id="mapRouteStatus" class="map-route-status" role="status" aria-live="polite" hidden>
      <span id="mapRouteStatusText"></span>
      <button id="mapRetry" type="button" data-i18n="retry">Retry</button>
    </div>
    <p id="mapModeNotice" class="map-mode-notice" role="status" aria-live="polite" hidden></p>
  </main>
`;

export default mapTemplate;
