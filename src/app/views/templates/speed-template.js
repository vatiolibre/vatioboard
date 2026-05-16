const speedTemplate = String.raw`
<h1 class="sr-only" data-i18n="speedPageH1">Vatio Speed live speedometer</h1>
  <p class="sr-only" data-i18n="speedPageLead">Live GPS speedometer with analog dial, trip stats, unit switching, altitude tracking, and speed trap alerts for Tesla and mobile browsers.</p>

  <div class="app speed-app">
    <header>
      <div class="header-inner speed-header-inner">
        <div class="brand" data-i18n-title="speedTagline" title="Minimal live speedometer by Vatio Libre">
          <a class="brand-home" href="#/board" data-i18n-aria="openBoard" aria-label="Open Vatio Board">
            <span class="dot" aria-hidden="true"></span>
            <picture class="brand-logo" aria-hidden="true">
              <source srcset="/img/vb_logo_dark.svg" media="(prefers-color-scheme: dark)" />
              <source srcset="/img/vb_logo_light.svg" media="(prefers-color-scheme: light)" />
              <img src="/img/vb_logo_light.svg" alt="" width="757" height="107" decoding="async" />
            </picture>
            <span class="sr-only">Vatio Board</span>
          </a>
          <button id="langToggle" type="button" class="lang-toggle" data-i18n-aria="changeLanguage" aria-label="Change language">EN</button>
        </div>

        <div class="toolbar speed-toolbar" role="toolbar" data-i18n-aria="speedometerControls" aria-label="Speedometer controls">
          <div class="toolbar-recording-quick">
            <div class="tools-menu speed-tools-menu">
              <button
                id="speedToolsMenuBtn"
                type="button"
                class="tools-menu-btn toolbar-recording-btn toolbar-recording-btn-tools"
                data-i18n-aria="pages"
                data-i18n-title="pages"
                aria-label="Pages"
                title="Pages"
                aria-haspopup="true"
                aria-expanded="false"
              >
                <span class="toolbar-recording-glyph btn-icon" aria-hidden="true"></span>
              </button>
              <div id="speedToolsMenuList" class="tools-menu-list" hidden>
                <div class="compact-tools-menu-brand" data-i18n-title="speedTagline" title="Minimal live speedometer by Vatio Libre">
                  <span class="dot" aria-hidden="true"></span>
                  <picture class="brand-logo compact-tools-menu-logo" aria-hidden="true">
                    <source srcset="/img/vb_logo_dark.svg" media="(prefers-color-scheme: dark)" />
                    <source srcset="/img/vb_logo_light.svg" media="(prefers-color-scheme: light)" />
                    <img src="/img/vb_logo_light.svg" alt="" width="757" height="107" decoding="async" />
                  </picture>
                  <span class="sr-only" data-i18n="brand">Vatio Board</span>
                  <button id="speedLangToggleMenu" type="button" class="lang-toggle" data-i18n-aria="changeLanguage" aria-label="Change language" data-lang-toggle>EN</button>
                </div>
                <button id="openSpeedAccelMenu" type="button" class="btn-with-icon">
                  <span class="btn-icon" aria-hidden="true"></span>
                  <span data-i18n="accelerationTest">Acceleration Test</span>
                </button>
                <button id="openSpeedLibraryMenu" type="button" class="btn-with-icon">
                  <span class="btn-icon" aria-hidden="true"></span>
                  <span data-i18n="cloudLibrary">Cloud library</span>
                </button>
                <button id="openSpeedBoardMenu" type="button" class="btn-with-icon">
                  <span class="btn-icon" aria-hidden="true"></span>
                  <span data-i18n="openBoard">Open board</span>
                </button>
                <form class="backend-auth" data-backend-auth novalidate>
                  <p class="backend-auth-title" data-i18n="authTitle">VatioLibre account</p>
                  <p class="backend-auth-status" data-backend-auth-status role="status" aria-live="polite" data-i18n="authCheckingSession">Checking session...</p>
                  <input
                    class="backend-auth-input"
                    data-backend-auth-user
                    data-backend-auth-guest
                    type="text"
                    autocomplete="username"
                    spellcheck="false"
                    aria-label="Email / username"
                    data-i18n-aria="authUsername"
                    placeholder="Email / username"
                    data-i18n-placeholder="authUsername"
                  />
                  <input
                    class="backend-auth-input"
                    data-backend-auth-password
                    data-backend-auth-guest
                    type="password"
                    autocomplete="current-password"
                    aria-label="Password"
                    data-i18n-aria="authPassword"
                    placeholder="Password"
                    data-i18n-placeholder="authPassword"
                  />
                  <button type="submit" data-backend-auth-login data-backend-auth-guest data-i18n="authLogin">Log in</button>
                  <button type="button" data-backend-auth-logout data-backend-auth-authenticated data-i18n="authLogout">Log out</button>
                  <a
                    class="backend-auth-link"
                    data-backend-auth-guest
                    data-backend-auth-signup
                    href="https://www.vatiolibre.com/login#signup"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-i18n="authCreateAccount"
                  >Create account</a>
                  <a
                    class="backend-auth-link"
                    data-backend-auth-guest
                    data-backend-auth-forgot
                    href="https://www.vatiolibre.com/login#forgot"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-i18n="authForgotPassword"
                  >Forgot password</a>
                </form>
              </div>
            </div>
            <button
              id="quickAlertConfig"
              type="button"
              class="toolbar-recording-btn toolbar-recording-btn-config"
              data-i18n-aria="configureAlerts"
              data-i18n-title="configureAlerts"
              aria-label="Configure alerts"
              title="Configure alerts"
              aria-pressed="false"
            >
              <span class="toolbar-recording-glyph btn-icon" aria-hidden="true"></span>
            </button>
            <button
              id="resetTrip"
              type="button"
              class="toolbar-recording-btn toolbar-recording-btn-reset"
              data-i18n-aria="resetTrip"
              aria-label="Reset trip"
              title="Reset trip"
            >
              <span class="toolbar-recording-glyph btn-icon" aria-hidden="true"></span>
            </button>
            <button
              id="toggleRecording"
              type="button"
              class="toolbar-recording-btn toolbar-recording-btn-toggle"
              data-recording-icon="pause"
              aria-label="Pause recording"
              title="Pause recording"
            >
              <span class="toolbar-recording-glyph" aria-hidden="true"></span>
            </button>
            <button
              id="openReplayQuick"
              type="button"
              class="toolbar-recording-btn toolbar-recording-btn-replay"
              data-recording-icon="replay"
              data-i18n-aria="driveReplay"
              aria-label="Drive Replay"
              title="Drive Replay"
            >
              <span class="toolbar-recording-glyph btn-icon" aria-hidden="true"></span>
            </button>
            <button
              id="stopRecording"
              type="button"
              class="toolbar-recording-btn toolbar-recording-btn-stop"
              data-recording-icon="stop"
              data-i18n-aria="stopRecording"
              aria-label="Stop recording"
              title="Stop recording"
            >
              <span class="toolbar-recording-glyph" aria-hidden="true"></span>
            </button>
            <button
              id="quickAudioToggle"
              type="button"
              class="toolbar-recording-btn toolbar-recording-btn-audio"
              data-i18n-aria="toggleAlertAudio"
              data-i18n-title="toggleAlertAudio"
              aria-label="Toggle alert audio"
              title="Toggle alert audio"
            >
              <span class="toolbar-recording-glyph toolbar-quick-icon toolbar-quick-icon-audio" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M4 8.5h3l4-3v9l-4-3H4z" />
                  <path class="toolbar-quick-wave" d="M13.25 7.25a4 4 0 0 1 0 5.5" />
                  <path class="toolbar-quick-wave" d="M14.75 5.5a6.5 6.5 0 0 1 0 9" />
                  <path class="toolbar-quick-slash" d="M4 4l12 12" />
                </svg>
              </span>
            </button>

          </div>
        </div>

        <span class="route-chip" aria-hidden="true" data-i18n="speedRoute">SPEED</span>
      </div>
    </header>

    <main class="speed-main">
      <section class="speed-shell" data-i18n-aria="liveAnalogSpeedometer" aria-label="Live analog speedometer">
        <div class="speed-stage">
          <div class="gauge-card">
            <div class="speed-view-switch" role="group" data-i18n-aria="viewMode" aria-label="View mode">
              <button
                id="primaryViewGauge"
                class="speed-view-btn"
                type="button"
                data-primary-view="gauge"
                data-i18n="speedometer"
                data-i18n-aria="showSpeedometer"
                aria-label="Show speedometer"
              >
                Speedometer
              </button>
              <button
                id="primaryViewWaze"
                class="speed-view-btn speed-view-btn-waze"
                type="button"
                data-primary-view="waze"
                data-i18n="wazeMap"
                data-i18n-aria="showWazeMap"
                aria-label="Show Waze map"
              >
                Waze map
              </button>
            </div>

            <button
              id="alertTrigger"
              class="speed-alert-trigger"
              type="button"
              aria-describedby="alertTriggerHint"
            >
              <span class="speed-alert-trigger-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" focusable="false">
                  <path d="M4 5.5h12M4 10h12M4 14.5h12" />
                  <circle cx="7" cy="5.5" r="1.4" />
                  <circle cx="13" cy="10" r="1.4" />
                  <circle cx="9" cy="14.5" r="1.4" />
                </svg>
              </span>
              <span class="speed-alert-trigger-copy">
                <span class="speed-alert-trigger-label" data-i18n="alerts">Alerts</span>
                <span id="alertTriggerValue" class="speed-alert-trigger-value" data-i18n="tapToConfigure">Tap to configure</span>
              </span>
              <span class="speed-alert-trigger-chevron" aria-hidden="true">
                <svg viewBox="0 0 12 12" focusable="false">
                  <path d="M3 2.5 7 6 3 9.5" />
                </svg>
              </span>
            </button>
            <p id="alertTriggerHint" class="speed-alert-trigger-hint" hidden data-i18n="alertsHint">Tap Alerts to set speed and trap warnings</p>

            <div id="speedPrimaryStage" class="speed-primary-stage">
              <div id="gaugeStage" class="gauge-stage speed-primary-panel analog-speedometer-stage">
                <div class="gauge-stage-inner analog-speedometer-inner">
                  <canvas id="speedDial" class="speed-gauge speed-dial analog-speedometer-canvas analog-speedometer-dial" aria-hidden="true"></canvas>
                  <div class="gauge-overlay analog-speedometer-overlay">
                    <span class="gauge-kicker analog-speedometer-kicker" data-i18n="liveSpeed">Live speed</span>
                    <div class="gauge-reading analog-speedometer-reading">
                      <span id="speedValue" class="analog-speedometer-value">0</span>
                      <span id="speedUnit" class="analog-speedometer-unit">km/h</span>
                    </div>
                    <p id="subStatus" class="gauge-substatus analog-speedometer-substatus" data-i18n="lookingFirstGpsFix">Looking for your first GPS fix</p>
                  </div>
                  <canvas id="speedNeedle" class="speed-gauge speed-needle analog-speedometer-canvas analog-speedometer-needle" data-i18n-aria="analogSpeedometer" aria-label="Analog speedometer"></canvas>
                </div>
              </div>

              <section id="wazeStage" class="waze-stage speed-primary-panel" aria-hidden="true">
                <div class="waze-map-shell">
                  <iframe
                    id="wazeFrame"
                    class="waze-frame"
                    title="Waze map"
                    tabindex="-1"
                    loading="lazy"
                    allow="geolocation; fullscreen"
                    referrerpolicy="strict-origin-when-cross-origin"
                    allowfullscreen
                  ></iframe>

                  <div id="wazePlaceholder" class="waze-placeholder">
                    <span class="waze-placeholder-kicker" data-i18n="wazeMap">Waze map</span>
                    <p id="wazePlaceholderText">Waiting for GPS to center the live map.</p>
                  </div>

                  <div class="waze-hud">
                    <div id="wazeSpeedPill" class="waze-speed-pill">
                      <span class="waze-speed-kicker" data-i18n="liveSpeed">Live speed</span>
                      <div class="waze-speed-reading">
                        <strong id="wazeSpeedValue">0</strong>
                        <span id="wazeSpeedUnit">km/h</span>
                      </div>
                      <div class="waze-speed-limit">
                        <span id="wazeSpeedLimitLabel" class="waze-speed-limit-label" data-i18n="speedLimit">Limit</span>
                        <strong id="wazeSpeedLimitValue" class="waze-speed-limit-value">Off</strong>
                      </div>
                      <p id="wazeSpeedNote" class="waze-speed-note" hidden>Manual alert</p>
                    </div>

                    <div class="waze-hud-actions">
                      <button
                        id="wazeLocationPrompt"
                        class="waze-location-prompt"
                        type="button"
                      >
                        Enable Waze location
                      </button>
                      <button
                        id="wazeRecenter"
                        class="waze-recenter"
                        type="button"
                        tabindex="-1"
                        hidden
                        data-i18n="recenterMap"
                        data-i18n-aria="recenterMap"
                        aria-label="Recenter map"
                      >
                        Recenter map
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div class="speed-side-panel">
            <div class="stats-grid" data-i18n-aria="tripStats" aria-label="Trip stats">
              <article class="metric-card">
                <span class="metric-label" data-i18n="max">Max</span>
                <strong id="maxSpeed">0</strong>
                <span id="maxSpeedUnit" class="metric-unit">km/h</span>
              </article>

              <article class="metric-card">
                <span class="metric-label" data-i18n="average">Average</span>
                <strong id="avgSpeed">0</strong>
                <span id="avgSpeedUnit" class="metric-unit">km/h</span>
              </article>

              <article class="metric-card">
                <span class="metric-label" data-i18n="distance">Distance</span>
                <strong id="distanceValue">0</strong>
                <span id="distanceUnit" class="metric-unit">m</span>
              </article>

              <article class="metric-card">
                <span class="metric-label" data-i18n="nearestTrap">Nearest Trap</span>
                <strong id="nearestTrapDistance">—</strong>
                <span id="nearestTrapUnit" class="metric-unit" data-i18n="away">away</span>
              </article>

              <article class="metric-card">
                <span class="metric-label" data-i18n="duration">Duration</span>
                <strong id="durationValue">00:00</strong>
                <span class="metric-unit" data-i18n="trip">trip</span>
              </article>

              <article class="metric-card">
                <span class="metric-label" data-i18n="altitude">Altitude</span>
                <strong id="altitudeValue">—</strong>
                <span id="altitudeUnit" class="metric-unit">m</span>
              </article>

              <article class="metric-card">
                <span class="metric-label" data-i18n="maxAlt">Max Alt</span>
                <strong id="maxAltitude">—</strong>
                <span id="maxAltitudeUnit" class="metric-unit">m</span>
              </article>

              <article class="metric-card">
                <span class="metric-label" data-i18n="minAlt">Min Alt</span>
                <strong id="minAltitude">—</strong>
                <span id="minAltitudeUnit" class="metric-unit">m</span>
              </article>
            </div>

            <article class="globe-card" data-i18n-aria="currentLocationGlobe" aria-label="Current location globe">
              <div class="globe-card-header">
                <span class="globe-card-kicker" data-i18n="liveGlobe">Live globe</span>
                <p id="globeStatus" class="globe-card-status" data-i18n="requestingGps">Requesting GPS...</p>
              </div>
              <div id="speedGlobe" class="speed-globe" aria-hidden="true"></div>
            </article>
          </div>

          <section
            id="drivingAudioPrompt"
            class="speed-audio-banner"
            aria-live="polite"
            hidden
          >
            <div class="speed-audio-banner-copy">
              <strong id="drivingAudioPromptTitle" data-i18n="drivingAlertsPromptTitle">Enable driving alerts</strong>
              <p id="drivingAudioPromptBody" data-i18n="drivingAlertsPromptBody">Speed and camera alerts need one tap before the browser can play audio while driving.</p>
            </div>
            <div class="speed-audio-banner-actions">
              <button
                id="drivingAudioPromptPrimary"
                type="button"
                class="speed-audio-banner-primary"
                data-i18n="enableDrivingAlerts"
              >
                Enable alerts
              </button>
              <button
                id="drivingAudioPromptSecondary"
                type="button"
                class="speed-audio-banner-secondary"
                data-i18n="keepAlertsOff"
              >
                Keep alerts off
              </button>
            </div>
          </section>

          <div id="notice" class="notice" hidden aria-live="polite">
            <p id="noticeText" data-i18n="allowLocationAccess">Allow location access to measure speed.</p>
            <button id="retryGps" type="button" data-i18n="retryGps">Retry GPS</button>
          </div>
        </div>
      </section>
    </main>
  </div>
`;

export default speedTemplate;
