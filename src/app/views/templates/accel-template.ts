const accelTemplate: string = String.raw`
<h1 class="sr-only" data-i18n="accelPageH1">Vatio Accel browser acceleration timer</h1>
    <p class="sr-only" data-i18n="accelPageLead">
      Browser-based GPS acceleration timer for 0-60 mph, 60-130 mph, quarter-mile, and metric
      acceleration testing in Tesla and mobile browsers.
    </p>

    <div class="app accel-app">
      <header data-vb-route-header>
        <div class="header-inner accel-header-inner">
          <div
            class="brand"
            data-i18n-title="accelTagline"
            title="Browser acceleration timer by VatioLibre"
          >
            <a class="brand-home" href="#/board" aria-label="Open VatioLibre drawing board">
              <span class="dot" aria-hidden="true"></span>
              <picture class="brand-logo" aria-hidden="true">
                <source srcset="/img/vb_logo_dark.svg" media="(prefers-color-scheme: dark)" />
                <source srcset="/img/vb_logo_light.svg" media="(prefers-color-scheme: light)" />
                <img
                  src="/img/vb_logo_light.svg"
                  alt=""
                  width="757"
                  height="107"
                  decoding="async"
                />
              </picture>
              <span class="sr-only">VatioLibre</span>
            </a>
            <button
              id="langToggle"
              type="button"
              class="lang-toggle"
              aria-label="Change language"
              data-i18n-aria="changeLanguage"
            >
              EN
            </button>
          </div>

          <div
            class="toolbar accel-toolbar"
            role="toolbar"
            data-vb-shell-toolbar
            aria-label="Acceleration tools"
            data-i18n-aria="accelToolbar"
          >
            <div class="accel-toolbar-actions">
              <div class="accel-toolbar-strip">
                <button
                  id="accelToolbarSetup"
                  type="button"
                  class="accel-toolbar-btn accel-toolbar-icon-btn"
                  data-i18n-aria="accelOpenSetup"
                  data-i18n-title="accelSetup"
                  aria-label="Open setup"
                  title="Setup"
                  aria-controls="setupPanel"
                  aria-expanded="false"
                  aria-pressed="false"
                >
                  <span class="btn-icon" aria-hidden="true"></span>
                </button>
                <button
                  id="accelToolbarResults"
                  type="button"
                  class="accel-toolbar-btn accel-toolbar-icon-btn accel-toolbar-btn-replay"
                  data-i18n-aria="accelOpenResults"
                  data-i18n-title="accelResultsPanel"
                  aria-label="Open results"
                  title="Results"
                  aria-controls="resultsPanel"
                  aria-expanded="false"
                  aria-pressed="false"
                  disabled
                >
                  <span class="btn-icon" aria-hidden="true"></span>
                </button>
                <button
                  id="armRun"
                  type="button"
                  class="accel-toolbar-btn accel-toolbar-icon-btn accel-toolbar-btn-start"
                  data-i18n-aria="accelArm"
                  data-i18n-title="accelArm"
                  aria-label="Start test"
                  title="Start test"
                >
                  <span class="btn-icon" aria-hidden="true"></span>
                </button>
              </div>
            </div>
          </div>

          <span class="route-chip" aria-hidden="true" data-i18n="accelRoute">ACCEL</span>
        </div>
      </header>

      <main
        class="accel-main"
        data-vb-focused-workspace
        data-vb-focused-default="gauge"
      >
        <div class="accel-focused-nav" data-vb-focused-view-nav role="tablist" aria-label="Acceleration view">
          <button
            type="button"
            role="tab"
            class="accel-focused-tab"
            data-vb-focused-view-target="gauge"
            aria-controls="accelGaugePanel"
            data-i18n="accelCurrentSpeed"
          >Current speed</button>
          <button
            type="button"
            role="tab"
            class="accel-focused-tab"
            data-vb-focused-view-target="status"
            aria-controls="accelStatusPanel"
            data-i18n="accelStatusPanel"
          >Status panel</button>
        </div>
        <section class="accel-shell">
          <div class="accel-stage">
            <article
              id="accelGaugePanel"
              class="accel-card accel-primary-card accel-gauge-card"
              role="tabpanel"
              data-vb-focused-view-panel="gauge"
            >
              <button
                id="setupTrigger"
                type="button"
                class="accel-sheet-trigger accel-sheet-trigger-floating"
                aria-expanded="false"
                aria-controls="setupPanel"
                data-i18n-aria="accelOpenSetup"
              >
                <span class="accel-sheet-trigger-label" data-i18n="accelSetup">Setup</span>
                <strong id="setupTriggerValue" class="accel-sheet-trigger-value">—</strong>
                <span id="setupTriggerMeta" class="accel-sheet-trigger-meta">—</span>
              </button>

              <div class="accel-primary-stage">
                <div class="accel-speedometer-wrap">
                  <div
                    id="liveSpeedGaugeStage"
                    class="analog-speedometer-stage accel-speedometer-stage"
                  >
                    <div id="liveSpeedGaugeInner" class="analog-speedometer-inner">
                      <canvas
                        id="liveSpeedDial"
                        class="analog-speedometer-canvas analog-speedometer-dial"
                        aria-hidden="true"
                      ></canvas>
                      <div class="analog-speedometer-overlay">
                        <span class="analog-speedometer-kicker" data-i18n="accelCurrentSpeed"
                          >Current speed</span
                        >
                        <div class="analog-speedometer-reading">
                          <span id="liveSpeedValue" class="analog-speedometer-value">0</span>
                          <span id="liveSpeedUnit" class="analog-speedometer-unit">mph</span>
                        </div>
                        <p id="liveSpeedSubstatus" class="analog-speedometer-substatus">Idle</p>
                      </div>
                      <canvas
                        id="liveSpeedNeedle"
                        class="analog-speedometer-canvas analog-speedometer-needle"
                        aria-label="Analog speedometer"
                      ></canvas>
                    </div>
                  </div>
                </div>

                <div class="accel-live-timer-wrap">
                  <span class="accel-live-label" data-i18n="accelElapsed">Elapsed</span>
                  <div class="accel-live-timer-reading">
                    <strong id="liveElapsedValue" class="accel-live-timer">0.000</strong>
                    <span class="accel-live-unit">s</span>
                  </div>
                </div>
              </div>

              <div class="accel-progress-shell">
                <header class="accel-progress-head">
                  <span data-i18n="accelProgress">Progress</span>
                  <span id="progressLabel" class="accel-inline-note">—</span>
                </header>
                <div class="accel-progress-track" aria-hidden="true">
                  <span id="progressFill" class="accel-progress-fill"></span>
                </div>
              </div>

              <p id="actionNotice" class="accel-feedback" aria-live="polite"></p>
            </article>

            <div
              id="accelStatusPanel"
              class="accel-side-panel"
              role="tabpanel"
              data-vb-focused-view-panel="status"
            >
              <button
                id="resultsTrigger"
                type="button"
                class="accel-sheet-trigger accel-sheet-trigger-side"
                aria-expanded="false"
                aria-controls="resultsPanel"
                data-i18n-aria="accelOpenResults"
              >
                <span class="accel-sheet-trigger-label" data-i18n="accelResultsPanel">Results</span>
                <strong id="resultsTriggerValue" class="accel-sheet-trigger-value">—</strong>
                <span id="resultsTriggerMeta" class="accel-sheet-trigger-meta">—</span>
              </button>

              <article class="accel-card accel-side-card">
                <div class="accel-status-strip">
                  <span class="accel-pill">
                    <span class="accel-pill-label" data-i18n="accelGpsReady">GPS ready</span>
                    <strong id="toolbarPermissionValue">—</strong>
                  </span>
                  <span class="accel-pill">
                    <span class="accel-pill-label" data-i18n="accelLatestAccuracy"
                      >Latest accuracy</span
                    >
                    <strong id="toolbarQualityValue">—</strong>
                  </span>
                  <span class="accel-pill">
                    <span class="accel-pill-label" data-i18n="accelQualityCurrent"
                      >Current quality</span
                    >
                    <strong id="toolbarStateValue" aria-live="polite">—</strong>
                  </span>
                </div>

                <div class="accel-live-grid">
                  <div class="accel-metric">
                    <span class="accel-metric-label" data-i18n="accelSelectedTest"
                      >Selected test</span
                    >
                    <strong id="liveTargetValue" class="accel-metric-value accel-metric-wrap"
                      >—</strong
                    >
                  </div>
                  <div class="accel-metric">
                    <span class="accel-metric-label" data-i18n="distance">Distance</span>
                    <strong id="liveDistanceValue" class="accel-metric-value">—</strong>
                  </div>
                  <div class="accel-metric">
                    <span class="accel-metric-label" data-i18n="accelSlope">Slope</span>
                    <strong id="liveSlopeValue" class="accel-metric-value">—</strong>
                  </div>
                  <div class="accel-metric">
                    <span class="accel-metric-label" data-i18n="accelState">Run state</span>
                    <strong id="liveStateValue" class="accel-metric-value">Idle</strong>
                  </div>
                  <div class="accel-metric">
                    <span class="accel-metric-label" data-i18n="accelQualityGrade"
                      >Quality grade</span
                    >
                    <strong id="liveQualityValue" class="accel-metric-value">—</strong>
                  </div>
                </div>

                <section id="livePartialsSection" class="accel-live-partials" data-vb-scroll-region hidden>
                  <div class="accel-section-title" data-i18n="accelPartials">Partials</div>
                  <div id="livePartialsList" class="accel-partials-list"></div>
                </section>
              </article>
            </div>
          </div>
        </section>

        <div id="accelSheetBackdrop" class="accel-sheet-backdrop" hidden></div>

        <section
          id="setupPanel"
          class="accel-sheet accel-sheet-setup"
          hidden
          role="dialog"
          aria-modal="true"
          aria-labelledby="setupPanelTitle"
          tabindex="-1"
        >
          <div class="accel-sheet-top">
            <div class="accel-sheet-copy">
              <span class="accel-card-kicker" data-i18n="accelSetup">Setup</span>
              <h2 id="setupPanelTitle" class="accel-sheet-title" data-i18n="accelSetup">Setup</h2>
              <p id="setupPanelStatus" class="accel-card-lead">—</p>
            </div>
            <button
              id="closeSetupPanel"
              type="button"
              class="accel-sheet-close accel-sheet-close-icon"
              aria-label="Close"
              title="Close"
              data-i18n-aria="close"
              data-i18n-title="close"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M18 6L6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M6 6l12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="sr-only" data-i18n="close">Close</span>
            </button>
          </div>

          <div class="accel-sheet-body">
            <section class="accel-sheet-section">
              <header class="accel-card-head">
                <span class="accel-card-kicker" data-i18n="accelTestSelector">Test selector</span>
                <p class="accel-card-lead" data-i18n="accelTestLead">
                  Standing-start, rolling-start, and distance presets.
                </p>
              </header>

              <div id="presetGrid" class="accel-preset-grid"></div>

              <div id="customRangePanel" class="accel-custom-panel" hidden>
                <div class="accel-section-title" data-i18n="accelCustomRange">
                  Custom speed range
                </div>

                <div class="accel-custom-grid">
                  <label class="accel-field" for="customStartInput">
                    <span data-i18n="accelStartSpeed">Start speed</span>
                    <input
                      id="customStartInput"
                      type="number"
                      min="0"
                      step="0.1"
                      inputmode="decimal"
                    />
                  </label>

                  <label class="accel-field" for="customEndInput">
                    <span data-i18n="accelEndSpeed">End speed</span>
                    <input
                      id="customEndInput"
                      type="number"
                      min="0"
                      step="0.1"
                      inputmode="decimal"
                    />
                  </label>
                </div>

                <p id="customRangeNotice" class="accel-inline-note"></p>
              </div>
            </section>

            <section class="accel-sheet-section">
              <header class="accel-card-head">
                <span class="accel-card-kicker" data-i18n="units">Units</span>
                <p class="accel-card-lead" data-i18n="accelUnitsLead">
                  Choose how speed, distance, altitude, and accuracy are shown.
                </p>
              </header>

              <div class="accel-controls-stack">
                <div>
                  <div class="accel-section-title" data-i18n="speed">Speed</div>
                  <div
                    class="accel-segmented accel-units-grid"
                    role="group"
                    aria-label="Speed units"
                    data-i18n-aria="speed"
                  >
                    <button
                      id="speedUnitMph"
                      type="button"
                      class="accel-segment-btn accel-unit-btn"
                      data-unit="mph"
                    >
                      <span class="accel-unit-btn-title">mph</span>
                      <span class="accel-unit-btn-meta" data-i18n="accelImperialTests"
                        >Imperial tests</span
                      >
                    </button>
                    <button
                      id="speedUnitKmh"
                      type="button"
                      class="accel-segment-btn accel-unit-btn"
                      data-unit="kmh"
                    >
                      <span class="accel-unit-btn-title">km/h</span>
                      <span class="accel-unit-btn-meta" data-i18n="accelMetricTests"
                        >Metric tests</span
                      >
                    </button>
                  </div>
                </div>

                <div>
                  <div class="accel-section-title" data-i18n="accelDistanceAltitude">
                    Distance + altitude
                  </div>
                  <div
                    class="accel-segmented accel-units-grid"
                    role="group"
                    aria-label="Distance and altitude units"
                    data-i18n-aria="accelDistanceAltitude"
                  >
                    <button
                      id="distanceUnitFt"
                      type="button"
                      class="accel-segment-btn accel-unit-btn"
                      data-unit="ft"
                    >
                      <span class="accel-unit-btn-title">ft</span>
                      <span class="accel-unit-btn-meta" data-i18n="accelMileDistanceTests"
                        >Mile-based distances</span
                      >
                    </button>
                    <button
                      id="distanceUnitM"
                      type="button"
                      class="accel-segment-btn accel-unit-btn"
                      data-unit="m"
                    >
                      <span class="accel-unit-btn-title">m</span>
                      <span class="accel-unit-btn-meta" data-i18n="accelMetricDistanceTests"
                        >Metric distances</span
                      >
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section class="accel-sheet-section">
              <header class="accel-card-head">
                <span class="accel-card-kicker" data-i18n="accelControls">Controls</span>
                <p class="accel-card-lead" data-i18n="accelControlsLead">
                  Arm the run, choose rollout, and store quick notes locally.
                </p>
              </header>

              <div class="accel-controls-stack">
                <div>
                  <div class="accel-section-title" data-i18n="accelRollout">Rollout</div>
                  <div class="accel-segmented" role="group" aria-label="Rollout toggle">
                    <button
                      id="rolloutOff"
                      type="button"
                      class="accel-segment-btn"
                      data-rollout="off"
                      data-i18n="accelOff"
                    >
                      Off
                    </button>
                    <button
                      id="rolloutOn"
                      type="button"
                      class="accel-segment-btn"
                      data-rollout="on"
                      data-i18n="accelRolloutOneFoot"
                    >
                      1 ft
                    </button>
                  </div>
                </div>

                <div>
                  <div class="accel-section-title" data-i18n="accelLaunchThreshold">
                    Launch threshold
                  </div>
                  <div class="accel-segmented" role="group" aria-label="Launch threshold">
                    <button
                      id="launchThresholdHalf"
                      type="button"
                      class="accel-segment-btn"
                      data-threshold="0.5"
                      data-i18n="accelLaunchThresholdHalf"
                    >
                      0.5 mph
                    </button>
                    <button
                      id="launchThresholdOne"
                      type="button"
                      class="accel-segment-btn"
                      data-threshold="1"
                      data-i18n="accelLaunchThresholdOne"
                    >
                      1.0 mph
                    </button>
                  </div>
                </div>

                <label class="accel-field" for="runNotes">
                  <span data-i18n="accelNotes">Run notes</span>
                  <textarea
                    id="runNotes"
                    rows="3"
                    data-i18n-placeholder="accelNotesPlaceholder"
                    placeholder="Example: 90% SOC, flat road"
                  ></textarea>
                </label>
              </div>
            </section>

            <section class="accel-sheet-section">
              <header class="accel-card-head">
                <span class="accel-card-kicker" data-i18n="accelStatusPanel">Status panel</span>
                <p class="accel-card-lead" data-i18n="accelStatusLead">
                  Live browser GPS readiness and signal quality.
                </p>
              </header>

              <div class="accel-status-grid">
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="permission">Permission</span>
                  <strong id="permissionValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelGpsReady">GPS ready</span>
                  <strong id="gpsReadyValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelLatestAccuracy"
                    >Latest accuracy</span
                  >
                  <strong id="latestAccuracyValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelObservedHz">Observed Hz</span>
                  <strong id="observedHzValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelCurrentSpeed"
                    >Current speed</span
                  >
                  <strong id="statusSpeedValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="heading">Heading</span>
                  <strong id="statusHeadingValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="altitude">Altitude</span>
                  <strong id="statusAltitudeValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelSpeedSource">Speed source</span>
                  <strong id="speedSourceValue" class="accel-metric-value">—</strong>
                </div>
              </div>
            </section>
          </div>
        </section>

        <section
          id="resultsPanel"
          class="accel-sheet accel-sheet-results"
          hidden
          role="dialog"
          aria-modal="true"
          aria-labelledby="resultsPanelTitle"
          tabindex="-1"
        >
          <div class="accel-sheet-top">
            <div class="accel-sheet-copy">
              <span class="accel-card-kicker" data-i18n="accelResultsPanel">Results</span>
              <h2 id="resultsPanelTitle" class="accel-sheet-title" data-i18n="accelResultsPanel">
                Results
              </h2>
              <p id="resultsPanelStatus" class="accel-card-lead">—</p>
            </div>
            <header
              id="resultPrimaryHeader"
              class="accel-result-primary accel-result-primary-bar"
              hidden
            >
              <span class="accel-live-label" data-i18n="accelFinalTime">Final time</span>
              <strong id="resultElapsedValue" class="accel-result-time">—</strong>
              <p class="accel-result-primary-meta">
                <span class="accel-result-primary-item">
                  <span class="accel-metric-label" data-i18n="accelSelectedTest"
                    >Selected test</span
                  >
                  <strong id="resultPresetValue" class="accel-metric-value">—</strong>
                </span>
                <span class="accel-result-primary-item">
                  <span class="accel-metric-label" data-i18n="accelFinishSpeed">Finish speed</span>
                  <strong id="resultFinishSpeedValue" class="accel-metric-value">—</strong>
                </span>
                <span class="accel-result-primary-item">
                  <span class="accel-metric-label" data-i18n="accelQualityGrade"
                    >Quality grade</span
                  >
                  <strong id="resultQualityValue" class="accel-metric-value">—</strong>
                </span>
              </p>
            </header>
            <nav
              class="accel-result-view-nav"
              aria-label="Result views"
              data-i18n-aria="accelResultViews"
            >
              <button type="button" class="accel-result-view-btn" data-accel-result-view-action="summary" data-i18n-aria="accelResultSummary" data-i18n-title="accelResultSummary" aria-label="Summary" title="Summary" aria-pressed="true">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              </button>
              <button type="button" class="accel-result-view-btn" data-accel-result-view-action="map" data-i18n-aria="accelResultMap" data-i18n-title="accelResultMap" aria-label="Map" title="Map" aria-pressed="false">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 3v15m6-12v15" stroke="currentColor" stroke-width="1.6"/></svg>
              </button>
              <button type="button" class="accel-result-view-btn" data-accel-result-view-action="charts" data-i18n-aria="accelResultCharts" data-i18n-title="accelResultCharts" aria-label="Charts" title="Charts" aria-pressed="false">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 19V5m0 14h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m7 15 4-5 3 3 5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button type="button" class="accel-result-view-btn" data-accel-result-view-action="details" data-i18n-aria="accelResultDetails" data-i18n-title="accelResultDetails" aria-label="Details" title="Details" aria-pressed="false">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v6m0-10h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
              <button type="button" class="accel-result-view-btn" data-accel-result-view-action="history" data-i18n-aria="accelResultHistory" data-i18n-title="accelResultHistory" aria-label="History" title="History" aria-pressed="false">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5m4-1v5l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </nav>
            <button
              id="closeResultsPanel"
              type="button"
              class="accel-sheet-close accel-sheet-close-icon"
              aria-label="Close"
              title="Close"
              data-i18n-aria="close"
              data-i18n-title="close"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M18 6L6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M6 6l12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="sr-only" data-i18n="close">Close</span>
            </button>
          </div>

          <div class="accel-sheet-body">
            <section class="accel-sheet-section accel-result-latest-section" aria-label="Latest result">
              <div id="resultEmptyState" class="accel-empty-copy" data-i18n="accelNoResult">
                Arm and complete a run to see the result here.
              </div>

              <div id="resultContent" hidden>
                <section class="accel-result-graph-shell">
                  <header class="accel-result-graph-head">
                    <span class="accel-section-title" data-i18n="accelSpeedGraph">Speed graph</span>
                    <span
                      id="resultGraphMeta"
                      class="accel-inline-note"
                      data-i18n="accelSpeedGraphLead"
                      >Time vs speed</span
                    >
                  </header>

                  <div id="resultReplayControls" class="accel-replay-controls" hidden>
                    <div class="accel-replay-toolbar">
                      <div
                        class="accel-replay-transport accel-toolbar-strip"
                        role="group"
                        aria-label="Replay controls"
                        data-i18n-aria="accelReplayControls"
                      >
                        <button
                          id="resultReplayToggle"
                          type="button"
                          class="accel-toolbar-icon-btn accel-replay-icon-btn accel-toolbar-btn-start"
                          aria-label="Play replay"
                          title="Play replay"
                        >
                          <span class="btn-icon" aria-hidden="true"></span>
                        </button>
                        <button
                          id="resultReplayRestart"
                          type="button"
                          class="accel-toolbar-icon-btn accel-replay-icon-btn"
                          data-i18n-aria="accelReplayRestart"
                          data-i18n-title="accelReplayRestart"
                          aria-label="Restart replay"
                          title="Restart replay"
                        >
                          <span class="btn-icon" aria-hidden="true"></span>
                        </button>
                      </div>

                      <div
                        class="accel-replay-axis accel-replay-sheet-axis-group"
                        role="group"
                        aria-label="Replay axis"
                        data-i18n-aria="accelReplayAxis"
                      >
                        <button
                          id="resultReplayAxisTime"
                          type="button"
                          class="accel-segment-btn accel-replay-axis-btn"
                          data-axis="time"
                          data-i18n-aria="accelReplayAxisTime"
                          data-i18n-title="accelReplayAxisTime"
                          aria-label="Time"
                          title="Time"
                        >
                          <span class="btn-icon" aria-hidden="true"></span>
                          <span class="accel-replay-axis-label" data-i18n="accelReplayAxisTime"
                            >Time</span
                          >
                        </button>
                        <button
                          id="resultReplayAxisDistance"
                          type="button"
                          class="accel-segment-btn accel-replay-axis-btn"
                          data-axis="distance"
                          data-i18n-aria="accelReplayAxisDistance"
                          data-i18n-title="accelReplayAxisDistance"
                          aria-label="Distance"
                          title="Distance"
                        >
                          <span class="btn-icon" aria-hidden="true"></span>
                          <span class="accel-replay-axis-label" data-i18n="accelReplayAxisDistance"
                            >Distance</span
                          >
                        </button>
                      </div>

                      <button
                        id="resultReplayChartsBtn"
                        type="button"
                        class="accel-action-btn accel-action-btn-compact accel-replay-charts-btn"
                        data-i18n="accelExploreCharts"
                      >
                        Explore charts
                      </button>
                    </div>

                    <div class="accel-replay-progress-row">
                      <strong id="resultReplayCurrentValue" class="accel-replay-progress-value"
                        >0.000 s</strong
                      >
                      <input
                        id="resultReplayProgress"
                        type="range"
                        min="0"
                        max="0"
                        step="any"
                        value="0"
                        class="accel-replay-progress"
                        data-i18n-aria="accelReplayProgress"
                        aria-label="Replay progress"
                      />
                      <strong id="resultReplayMaxValue" class="accel-replay-progress-value"
                        >0.000 s</strong
                      >
                    </div>
                  </div>

                  <div id="resultReplayMapShell" class="accel-result-map-shell" hidden>
                    <div
                      id="resultReplayMap"
                      class="accel-result-map"
                      data-i18n-aria="accelReplayMapAria"
                      aria-label="Acceleration replay map"
                    ></div>
                    <div id="resultReplayMapStatus" class="accel-result-map-status" hidden role="status">
                      <span id="resultReplayMapStatusText" data-i18n="accelMapLoading">Loading route map…</span>
                      <button id="resultReplayMapRetry" type="button" class="accel-action-btn" hidden data-i18n="retry">Retry</button>
                    </div>
                  </div>

                  <div
                    id="resultGraphEmptyState"
                    class="accel-empty-copy"
                    hidden
                    data-i18n="accelSpeedGraphEmpty"
                  >
                    Speed graph data is available for new runs.
                  </div>

                  <div id="resultGraphFrame" class="accel-result-graph-frame" hidden>
                    <div class="accel-result-graph-canvas-shell">
                      <canvas
                        id="resultGraphCanvas"
                        class="accel-result-graph-canvas"
                        data-i18n-aria="accelSpeedGraphAria"
                        aria-label="Interactive speed graph"
                      ></canvas>
                    </div>
                    <p
                      class="accel-result-graph-hint accel-inline-note"
                      data-i18n="accelSpeedGraphHint"
                    >
                      Touch or click the graph to inspect each sample.
                    </p>
                    <div class="accel-result-graph-details">
                      <div class="accel-result-graph-detail">
                        <span class="accel-metric-label" data-i18n="accelGraphPointTime">Time</span>
                        <strong id="resultGraphTimeValue" class="accel-metric-value">—</strong>
                      </div>
                      <div class="accel-result-graph-detail">
                        <span class="accel-metric-label" data-i18n="accelGraphPointSpeed"
                          >Speed</span
                        >
                        <strong id="resultGraphSpeedValue" class="accel-metric-value">—</strong>
                      </div>
                      <div class="accel-result-graph-detail">
                        <span class="accel-metric-label" data-i18n="accelGraphPointDistance"
                          >Distance</span
                        >
                        <strong id="resultGraphDistanceValue" class="accel-metric-value">—</strong>
                      </div>
                      <div class="accel-result-graph-detail">
                        <span class="accel-metric-label" data-i18n="altitude">Altitude</span>
                        <strong id="resultGraphAltitudeValue" class="accel-metric-value">—</strong>
                      </div>
                      <div class="accel-result-graph-detail">
                        <span class="accel-metric-label" data-i18n="accelGraphPointAccuracy"
                          >Accuracy</span
                        >
                        <strong id="resultGraphAccuracyValue" class="accel-metric-value">—</strong>
                      </div>
                      <div class="accel-result-graph-detail">
                        <span class="accel-metric-label" data-i18n="accelGraphPointSlope"
                          >Slope</span
                        >
                        <strong id="resultGraphSlopeValue" class="accel-metric-value">—</strong>
                      </div>
                    </div>
                  </div>
                </section>

                <section id="resultPartialsSection" class="accel-result-partials" hidden>
                  <span class="accel-section-title" data-i18n="accelPartials">Partials</span>
                  <div id="resultPartialsList" class="accel-partials-list"></div>
                </section>

                <div class="accel-result-grid">
                  <div class="accel-metric">
                    <span class="accel-metric-label" data-i18n="accelRolloutUsed">Rollout</span>
                    <strong id="resultRolloutValue" class="accel-metric-value">—</strong>
                  </div>
                  <div class="accel-metric">
                    <span class="accel-metric-label" data-i18n="accelAverageAccuracy"
                      >Average accuracy</span
                    >
                    <strong id="resultAccuracyValue" class="accel-metric-value">—</strong>
                  </div>
                  <div class="accel-metric">
                    <span class="accel-metric-label" data-i18n="accelSlope">Slope</span>
                    <strong id="resultSlopeValue" class="accel-metric-value">—</strong>
                  </div>
                  <div class="accel-metric">
                    <span class="accel-metric-label" data-i18n="accelElevationChange"
                      >Elevation change</span
                    >
                    <strong id="resultElevationValue" class="accel-metric-value">—</strong>
                  </div>
                  <div class="accel-metric">
                    <span class="accel-metric-label" data-i18n="accelRunHz">Run avg Hz</span>
                    <strong id="resultHzValue" class="accel-metric-value">—</strong>
                  </div>
                </div>

                <div class="accel-result-footnotes">
                  <p class="accel-result-footnote">
                    <span class="accel-metric-label" data-i18n="accelBestComparison"
                      >Best vs latest</span
                    >
                    <strong id="resultComparisonValue" class="accel-metric-value accel-metric-wrap"
                      >—</strong
                    >
                  </p>
                  <p id="resultNotesRow" class="accel-result-footnote" hidden>
                    <span class="accel-metric-label" data-i18n="accelNotes">Run notes</span>
                    <strong id="resultNotesValue" class="accel-metric-value accel-metric-wrap"
                      >—</strong
                    >
                  </p>
                  <p class="accel-result-footnote">
                    <span class="accel-metric-label" data-i18n="accelLocation">Location</span>
                    <strong id="resultLocationValue" class="accel-metric-value accel-result-location-value"
                      ><span class="accel-result-location-text">—</span></strong
                    >
                  </p>
                  <p class="accel-result-footnote">
                    <span class="accel-metric-label" data-i18n="accelTimestamp">Timestamp</span>
                    <strong id="resultTimestampValue" class="accel-metric-value accel-metric-wrap"
                      >—</strong
                    >
                  </p>
                </div>
              </div>
            </section>

            <section class="accel-sheet-section accel-result-details-section">
              <header class="accel-card-head">
                <span class="accel-card-kicker" data-i18n="accelDiagnostics">Diagnostics</span>
                <p class="accel-card-lead" data-i18n="accelDiagnosticsLead">
                  Observed callback timing, uncertainty, and warning flags.
                </p>
              </header>

              <div id="warningBadges" class="accel-warning-list"></div>

              <div class="accel-metrics-grid">
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelAverageInterval"
                    >Average interval</span
                  >
                  <strong id="diagnosticAverageIntervalValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelJitter">Jitter</span>
                  <strong id="diagnosticJitterValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelSparseUpdates"
                    >Sparse updates</span
                  >
                  <strong id="diagnosticSparseValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelStaleSamples"
                    >Stale samples</span
                  >
                  <strong id="diagnosticStaleValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelSpeedSource">Speed source</span>
                  <strong id="diagnosticSpeedSourceValue" class="accel-metric-value">—</strong>
                </div>
                <div class="accel-metric">
                  <span class="accel-metric-label" data-i18n="accelSamples">Samples</span>
                  <strong id="diagnosticSamplesValue" class="accel-metric-value">—</strong>
                </div>
              </div>
            </section>

            <section class="accel-technical-data-control">
              <button
                id="resultTechnicalDataToggle"
                type="button"
                class="accel-action-btn accel-technical-data-toggle"
                aria-expanded="false"
                aria-controls="resultTechnicalDataContent"
              >
                <span data-i18n="accelTechnicalData">Technical data</span>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </section>

            <div id="resultTechnicalDataContent" class="accel-technical-data-content">
            <section id="debugRawSection" class="accel-sheet-section" hidden>
              <header class="accel-card-head">
                <span class="accel-card-kicker">Debug</span>
                <p class="accel-card-lead">
                  Raw samples captured during the run before graph processing.
                </p>
              </header>

              <div id="debugRawEmptyState" class="accel-empty-copy">
                No raw run samples captured yet.
              </div>

              <div id="debugRawTableWrap" class="accel-debug-table-wrap" hidden>
                <table class="accel-debug-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Delta ms</th>
                      <th>Hz</th>
                      <th>Lat / Lon</th>
                      <th>Raw speed</th>
                      <th>Derived speed</th>
                      <th>Used speed</th>
                      <th>Heading</th>
                      <th>Accuracy</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody id="debugRawTableBody"></tbody>
                </table>
              </div>
            </section>

            <section id="debugGraphSection" class="accel-sheet-section" hidden>
              <header class="accel-card-head">
                <span class="accel-card-kicker">Debug</span>
                <p class="accel-card-lead">Points passed into the Results speed graph.</p>
              </header>

              <div id="debugGraphEmptyState" class="accel-empty-copy">
                No graph points available yet.
              </div>

              <div id="debugGraphTableWrap" class="accel-debug-table-wrap" hidden>
                <table class="accel-debug-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Elapsed ms</th>
                      <th>Time</th>
                      <th>Speed</th>
                      <th>Distance</th>
                      <th>Altitude</th>
                      <th>Accuracy</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody id="debugGraphTableBody"></tbody>
                </table>
              </div>
            </section>
            </div>

            <section class="accel-sheet-section accel-history-card">
              <header class="accel-card-head accel-history-head">
                <div class="accel-history-head-copy">
                  <span class="accel-card-kicker" data-i18n="accelHistory">History</span>
                  <p class="accel-card-lead" data-i18n="accelHistoryLead">
                    Saved locally in this browser. Newest runs first.
                  </p>
                </div>
                <button
                  id="clearHistory"
                  type="button"
                  class="accel-action-btn accel-action-btn-compact"
                  data-i18n="accelClearHistory"
                >
                  Clear all
                </button>
              </header>

              <div id="historyEmptyState" class="accel-empty-copy" data-i18n="accelNoHistory">
                No saved runs yet.
              </div>
              <div id="historyList" class="accel-history-list"></div>
            </section>
          </div>
        </section>

        <section
          id="resultReplayChartSheet"
          class="accel-replay-chart-sheet"
          hidden
          role="dialog"
          aria-modal="true"
          aria-labelledby="resultReplayChartSheetTitle"
          tabindex="-1"
        >
          <div
            id="resultReplayChartSheetBackdrop"
            class="accel-replay-chart-sheet-backdrop"
            aria-hidden="true"
          ></div>

          <section class="accel-replay-chart-sheet-panel">
            <header class="accel-replay-chart-sheet-header">
              <h3
                id="resultReplayChartSheetTitle"
                class="accel-replay-chart-sheet-title"
                data-i18n="accelExploreCharts"
              >
                Explore charts
              </h3>

              <div
                class="accel-replay-chart-sheet-axis accel-replay-sheet-axis-group"
                role="group"
                aria-label="Replay axis"
                data-i18n-aria="accelReplayAxis"
              >
                <button
                  id="resultReplaySheetAxisTime"
                  type="button"
                  class="accel-segment-btn accel-replay-axis-btn"
                  data-axis="time"
                  data-i18n-aria="accelReplayAxisTime"
                  data-i18n-title="accelReplayAxisTime"
                  aria-label="Time"
                  title="Time"
                >
                  <span class="btn-icon" aria-hidden="true"></span>
                  <span class="accel-replay-axis-label" data-i18n="accelReplayAxisTime">Time</span>
                </button>
                <button
                  id="resultReplaySheetAxisDistance"
                  type="button"
                  class="accel-segment-btn accel-replay-axis-btn"
                  data-axis="distance"
                  data-i18n-aria="accelReplayAxisDistance"
                  data-i18n-title="accelReplayAxisDistance"
                  aria-label="Distance"
                  title="Distance"
                >
                  <span class="btn-icon" aria-hidden="true"></span>
                  <span class="accel-replay-axis-label" data-i18n="accelReplayAxisDistance"
                    >Distance</span
                  >
                </button>
              </div>

              <div class="accel-result-chart-metric-tabs" role="group" aria-label="Chart metric" data-i18n-aria="accelChartMetric">
                <button type="button" class="accel-result-chart-metric-btn" data-accel-result-chart-metric="speedMs" data-i18n="speed" aria-pressed="true">Speed</button>
                <button type="button" class="accel-result-chart-metric-btn" data-accel-result-chart-metric="altitudeM" data-i18n="altitude" aria-pressed="false">Altitude</button>
                <button type="button" class="accel-result-chart-metric-btn" data-accel-result-chart-metric="headingDeg" data-i18n="heading" aria-pressed="false">Heading</button>
              </div>

              <button
                id="closeResultReplayChartSheet"
                type="button"
                class="accel-sheet-close accel-replay-chart-sheet-close"
                data-i18n="close"
              >
                Close
              </button>
            </header>

            <section
              class="accel-replay-filter-group"
              aria-label="Filter range"
              data-i18n-aria="replayFilterRange"
            >
              <div class="accel-replay-filter-row">
                <span class="accel-replay-filter-value">
                  <span class="accel-metric-label" data-i18n="replayFilterStart">Start</span>
                  <strong
                    id="resultReplaySheetFilterStartValue"
                    class="accel-replay-filter-value-text"
                    >0.000 s</strong
                  >
                </span>

                <div
                  id="resultReplaySheetFilterSlider"
                  class="accel-replay-filter-slider dual-range-input"
                >
                  <input
                    id="resultReplaySheetFilterStart"
                    class="accel-replay-filter-range accel-replay-filter-range-start"
                    type="range"
                    min="0"
                    max="1000"
                    value="0"
                    step="1"
                    aria-label="Filter start"
                    data-i18n-aria="replayFilterStart"
                  />
                  <input
                    id="resultReplaySheetFilterEnd"
                    class="accel-replay-filter-range accel-replay-filter-range-end"
                    type="range"
                    min="0"
                    max="1000"
                    value="1000"
                    step="1"
                    aria-label="Filter end"
                    data-i18n-aria="replayFilterEnd"
                  />
                </div>

                <span class="accel-replay-filter-value accel-replay-filter-value-end">
                  <span class="accel-metric-label" data-i18n="replayFilterEnd">End</span>
                  <strong
                    id="resultReplaySheetFilterEndValue"
                    class="accel-replay-filter-value-text"
                    >0.000 s</strong
                  >
                </span>
              </div>
            </section>

            <section
              class="accel-replay-chart-sheet-grid"
              aria-label="Expanded accel replay charts"
            >
              <article id="resultReplaySheetSpeedStage" class="accel-replay-chart-stage">
                <header class="accel-replay-chart-stage-head">
                  <span class="accel-section-title" data-i18n="speed">Speed</span>
                  <strong id="resultReplaySheetSpeedValue" class="accel-replay-chart-current"
                    >—</strong
                  >
                </header>
                <div class="accel-replay-chart-canvas-wrap">
                  <canvas
                    id="resultReplaySheetSpeedCanvas"
                    class="accel-replay-chart-canvas"
                    data-accel-replay-scrub="speedMs"
                    data-i18n-aria="accelReplaySpeedChart"
                    aria-label="Replay speed chart"
                  ></canvas>
                </div>
              </article>

              <article id="resultReplaySheetAltitudeStage" class="accel-replay-chart-stage">
                <header class="accel-replay-chart-stage-head">
                  <span class="accel-section-title" data-i18n="altitude">Altitude</span>
                  <strong id="resultReplaySheetAltitudeValue" class="accel-replay-chart-current"
                    >—</strong
                  >
                </header>
                <div class="accel-replay-chart-canvas-wrap">
                  <canvas
                    id="resultReplaySheetAltitudeCanvas"
                    class="accel-replay-chart-canvas"
                    data-accel-replay-scrub="altitudeM"
                    data-i18n-aria="accelReplayAltitudeChart"
                    aria-label="Replay altitude chart"
                  ></canvas>
                </div>
              </article>

              <article id="resultReplaySheetHeadingStage" class="accel-replay-chart-stage">
                <header class="accel-replay-chart-stage-head">
                  <span class="accel-section-title" data-i18n="heading">Heading</span>
                  <strong id="resultReplaySheetHeadingValue" class="accel-replay-chart-current"
                    >—</strong
                  >
                </header>
                <div class="accel-replay-chart-canvas-wrap">
                  <canvas
                    id="resultReplaySheetHeadingCanvas"
                    class="accel-replay-chart-canvas"
                    data-accel-replay-scrub="headingDeg"
                    data-i18n-aria="accelReplayHeadingChart"
                    aria-label="Replay heading chart"
                  ></canvas>
                </div>
              </article>
            </section>

            <p
              class="accel-inline-note accel-replay-chart-sheet-hint"
              data-i18n="accelReplayDragToExplore"
            >
              Drag across the chart to scrub the replay.
            </p>
          </section>
        </section>
      </main>
    </div>
`;

export default accelTemplate;
