const replayTemplate: string = String.raw`
<h1 class="sr-only" data-i18n="replayPageH1">Vatio Drive Replay</h1>
    <p class="sr-only" data-i18n="replayPageLead">
      Replay your latest Vatio Speed drive on a hardware-accelerated 3D globe with a progress
      timeline and live metrics.
    </p>

    <div class="app replay-app">
      <header>
        <div class="header-inner replay-header-inner">
          <div class="brand" data-i18n-title="replayTagline" title="Drive replay by VatioLibre">
            <a class="brand-home" href="#/board" data-i18n-aria="openBoard" aria-label="Open VatioLibre drawing board">
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
              data-i18n-aria="changeLanguage"
              aria-label="Change language"
            >
              EN
            </button>
          </div>

          <div class="toolbar replay-toolbar" data-vb-shell-toolbar>
            <div class="replay-toolbar-right">
              <div class="replay-toolbar-strip">
                <section
                  class="replay-axis-group"
                  role="group"
                  aria-label="Dashboard axis"
                  data-i18n-aria="replayDashboardAxis"
                >
                  <button
                    id="replayAxisTime"
                    type="button"
                    class="replay-axis-btn replay-toolbar-icon-btn"
                    data-axis="time"
                    data-i18n-aria="replayAxisTime"
                    data-i18n-title="replayAxisTime"
                    aria-label="Time"
                    title="Time"
                  >
                    <span class="btn-icon" aria-hidden="true"></span>
                  </button>
                  <button
                    id="replayAxisDistance"
                    type="button"
                    class="replay-axis-btn replay-toolbar-icon-btn"
                    data-axis="distance"
                    data-i18n-aria="replayAxisDistance"
                    data-i18n-title="replayAxisDistance"
                    aria-label="Distance"
                    title="Distance"
                  >
                    <span class="btn-icon" aria-hidden="true"></span>
                  </button>
                </section>

                <section class="replay-panel-actions" role="group" aria-label="Replay panels" data-i18n-aria="replayPanels">
                  <button
                    id="replayOpenRecordings"
                    type="button"
                    class="replay-toolbar-icon-btn replay-panel-action"
                    data-replay-open-panel="recordings"
                    aria-label="Recordings"
                    title="Recordings"
                    data-i18n-aria="replayRecordings"
                    data-i18n-title="replayRecordings"
                    aria-expanded="false"
                  ><span class="btn-icon" aria-hidden="true"></span></button>
                  <button
                    id="replayOpenCharts"
                    type="button"
                    class="replay-toolbar-icon-btn replay-panel-action"
                    data-replay-open-panel="charts"
                    aria-label="Charts"
                    title="Charts"
                    data-i18n-aria="replayCharts"
                    data-i18n-title="replayCharts"
                    aria-expanded="false"
                  ><span class="btn-icon" aria-hidden="true"></span></button>
                  <button
                    id="replayOpenDetails"
                    type="button"
                    class="replay-toolbar-icon-btn replay-panel-action"
                    data-replay-open-panel="details"
                    aria-label="Details"
                    title="Details"
                    data-i18n-aria="replayDetails"
                    data-i18n-title="replayDetails"
                    aria-expanded="false"
                  ><span class="btn-icon" aria-hidden="true"></span></button>
                </section>

                <button
                  id="replayPlayPause"
                  type="button"
                  class="replay-toolbar-icon-btn replay-toolbar-transport-btn replay-toolbar-transport-btn-play"
                  aria-label="Play"
                  title="Play"
                >
                  <span
                    id="replayPlayPauseIcon"
                    class="replay-action-icon"
                    aria-hidden="true"
                  ></span>
                  <span id="replayPlayPauseText" class="sr-only">Play</span>
                </button>
                <button
                  id="replayRestart"
                  type="button"
                  class="replay-toolbar-icon-btn replay-toolbar-transport-btn"
                  aria-label="Restart"
                  title="Restart"
                >
                  <span id="replayRestartIcon" class="replay-action-icon" aria-hidden="true"></span>
                  <span class="sr-only" data-i18n="replayRestart">Restart</span>
                </button>
                <button
                  id="replayApproach"
                  type="button"
                  class="replay-toolbar-icon-btn replay-toolbar-transport-btn"
                  aria-label="World approach"
                  title="World approach"
                >
                  <span
                    id="replayApproachIcon"
                    class="replay-action-icon"
                    aria-hidden="true"
                  ></span>
                  <span class="sr-only" data-i18n="replayApproach">World approach</span>
                </button>
              </div>
            </div>

            <button
              id="replaySessionChip"
              type="button"
              class="status replay-session-chip"
              aria-live="polite"
              aria-expanded="false"
              data-replay-open-panel="recordings"
              data-i18n="replaySessionActive"
            >Active session</button>
          </div>

          <span class="route-chip" aria-hidden="true" data-i18n="replayRoute">REPLAY</span>
        </div>
      </header>

      <main class="replay-main">
        <section id="replayEmptyState" class="replay-empty-card" hidden>
          <span class="replay-card-kicker" data-i18n="driveReplay">Drive Replay</span>
          <h2 class="replay-empty-title" data-i18n="replayEmptyTitle">
            No replay session saved yet
          </h2>
          <p class="replay-card-lead" data-i18n="replayEmptyLead">
            Open Vatio Speed, let GPS collect a route, then come back here to replay it on the
            globe.
          </p>
          <button
            id="replayOpenSpeed"
            type="button"
            class="replay-action-btn"
            data-i18n="replayOpenSpeed"
          >
            Open Vatio Speed
          </button>
        </section>

        <section id="replayShell" class="replay-shell" hidden>
          <article class="replay-card replay-graphs-card">
            <section class="replay-graphs-grid" aria-label="Replay graphs">
              <button
                type="button"
                class="replay-graph-card replay-graph-trigger"
                data-graph-metric="speedMs"
                data-i18n-aria="replayExpandGraph"
                aria-label="Expand graph"
              >
                <header class="replay-graph-head">
                  <span class="replay-metric-label" data-i18n="speed">Speed</span>
                  <strong id="replayGraphSpeedCurrent" class="replay-graph-current">—</strong>
                </header>
                <canvas
                  id="replayGraphSpeedCanvas"
                  class="replay-graph-canvas"
                  aria-label="Replay speed chart"
                ></canvas>
              </button>

              <button
                type="button"
                class="replay-graph-card replay-graph-trigger"
                data-graph-metric="altitudeM"
                data-i18n-aria="replayExpandGraph"
                aria-label="Expand graph"
              >
                <header class="replay-graph-head">
                  <span class="replay-metric-label" data-i18n="altitude">Altitude</span>
                  <strong id="replayGraphAltitudeCurrent" class="replay-graph-current">—</strong>
                </header>
                <canvas
                  id="replayGraphAltitudeCanvas"
                  class="replay-graph-canvas"
                  aria-label="Replay altitude chart"
                ></canvas>
              </button>

              <button
                type="button"
                class="replay-graph-card replay-graph-trigger"
                data-graph-metric="headingDeg"
                data-i18n-aria="replayExpandGraph"
                aria-label="Expand graph"
              >
                <header class="replay-graph-head">
                  <span class="replay-metric-label" data-i18n="heading">Heading</span>
                  <strong id="replayGraphHeadingCurrent" class="replay-graph-current">—</strong>
                </header>
                <canvas
                  id="replayGraphHeadingCanvas"
                  class="replay-graph-canvas"
                  aria-label="Replay heading chart"
                ></canvas>
              </button>
            </section>
          </article>

          <section class="replay-stage" aria-label="Replay content">
            <article class="replay-card replay-map-card">
              <div id="replayMap" class="replay-map"></div>

              <section class="replay-map-hud" aria-live="polite">
                <span id="replayHudRecorded" class="replay-map-hud-recorded">—</span>
                <strong id="replayHudRoute" class="replay-map-hud-route">—</strong>
                <span id="replayHudSpeed" class="replay-map-hud-speed">—</span>
              </section>

              <section id="replayMapStatus" class="replay-map-status" role="status" aria-live="polite" data-status="idle" hidden>
                <span id="replayMapStatusText" class="replay-map-status-text"></span>
                <button id="replayMapRetry" class="replay-map-retry" type="button" data-i18n="retry" hidden>Retry</button>
              </section>

              <div class="replay-map-transport-actions" aria-label="Replay controls" data-i18n-aria="replayControls">
                <button type="button" class="replay-map-action replay-map-play" data-replay-action="play" aria-label="Play">
                  <span class="replay-action-icon" aria-hidden="true"></span>
                </button>
                <button type="button" class="replay-map-action" data-replay-action="restart" aria-label="Restart" data-i18n-aria="replayRestart">
                  <span class="replay-action-icon" aria-hidden="true"></span>
                </button>
                <button type="button" class="replay-map-action" data-replay-action="overview" aria-label="Route overview" data-i18n-aria="replayApproach">
                  <span class="replay-action-icon" aria-hidden="true"></span>
                </button>
              </div>

              <div class="replay-transport-row">
                <div class="replay-progress-wrap">
                  <input
                    id="replayProgress"
                    type="range"
                    min="0"
                    max="1000"
                    value="0"
                    step="1"
                    aria-label="Progress"
                    data-i18n-aria="replayProgress"
                  />
                  <div class="replay-progress-meta">
                    <div class="replay-progress-values">
                      <span id="replayElapsedValue">00:00</span>
                      <span id="replayDurationValue">00:00</span>
                    </div>
                    <button id="replayRateToggle" class="replay-rate-toggle" type="button" aria-expanded="false" aria-label="Playback speed" data-i18n-aria="replayPlaybackSpeed">1000×</button>
                    <section class="replay-rate-group" role="group" aria-label="Replay speed" data-i18n-aria="replayPlaybackSpeed">
                      <button type="button" class="replay-rate-btn" data-rate="1">1x</button>
                      <button type="button" class="replay-rate-btn" data-rate="4">4x</button>
                      <button type="button" class="replay-rate-btn" data-rate="10">10x</button>
                      <button type="button" class="replay-rate-btn" data-rate="100">100x</button>
                      <button type="button" class="replay-rate-btn" data-rate="1000">1000x</button>
                    </section>
                  </div>
                </div>
              </div>

              <section class="replay-recordings-section" data-replay-panel="recordings">
                <header class="replay-panel-header">
                  <strong data-i18n="replayRecordings">Recordings</strong>
                  <button class="replay-panel-close" type="button" data-replay-close-panel aria-label="Close" data-i18n-aria="close"><span class="btn-icon" aria-hidden="true"></span></button>
                </header>
                <section
                  id="replayRecordingsList"
                  class="replay-recordings-list"
                  aria-label="Replay recordings"
                ></section>
              </section>
            </article>

            <aside class="replay-side-panel" aria-label="Replay details" data-replay-panel="details">
              <article class="replay-card replay-details-card">
                <header class="replay-panel-header">
                  <strong data-i18n="replayDetails">Details</strong>
                  <button class="replay-panel-close" type="button" data-replay-close-panel aria-label="Close" data-i18n-aria="close"><span class="btn-icon" aria-hidden="true"></span></button>
                </header>
                <section class="replay-summary-grid" aria-label="Replay summary metrics">
                  <article class="replay-metric">
                    <span class="replay-metric-label" data-i18n="replayRecordedAt">Recorded</span>
                    <strong id="replayRecordedAtValue" class="replay-metric-value">—</strong>
                  </article>
                  <article class="replay-metric">
                    <span class="replay-metric-label" data-i18n="replaySamples">Samples</span>
                    <strong id="replaySampleCountValue" class="replay-metric-value">0</strong>
                  </article>
                  <article class="replay-metric">
                    <span class="replay-metric-label" data-i18n="max">Max</span>
                    <strong id="replayPeakSpeedValue" class="replay-metric-value">—</strong>
                  </article>
                  <article class="replay-metric">
                    <span class="replay-metric-label" data-i18n="average">Average</span>
                    <strong id="replayAverageSpeedValue" class="replay-metric-value">—</strong>
                  </article>
                  <article class="replay-metric">
                    <span class="replay-metric-label" data-i18n="distance">Distance</span>
                    <strong id="replaySummaryDistanceValue" class="replay-metric-value">—</strong>
                  </article>
                  <article class="replay-metric">
                    <span class="replay-metric-label" data-i18n="duration">Duration</span>
                    <strong id="replaySummaryDurationValue" class="replay-metric-value">—</strong>
                  </article>
                  <article class="replay-metric replay-metric-wide">
                    <span class="replay-metric-label" data-i18n="replayRouteLabel">Route</span>
                    <strong id="replayRouteValue" class="replay-metric-value">—</strong>
                  </article>
                  <article class="replay-metric replay-metric-wide">
                    <span class="replay-metric-label" data-i18n="replayAltitudeRange"
                      >Altitude range</span
                    >
                    <strong id="replayAltitudeRangeValue" class="replay-metric-value">—</strong>
                  </article>
                </section>

                <section
                  id="replayHighlightsList"
                  class="replay-highlights-list"
                  aria-label="Replay highlights"
                ></section>
              </article>
            </aside>
          </section>
          <button id="replayPanelBackdrop" class="replay-panel-backdrop" type="button" aria-label="Close" data-i18n-aria="close" hidden></button>
        </section>
      </main>
    </div>

    <section
      id="replayGraphSheet"
      class="replay-graph-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="replayGraphSheetTitle"
      hidden
    >
      <div
        id="replayGraphSheetBackdrop"
        class="replay-graph-sheet-backdrop"
        aria-hidden="true"
      ></div>

      <section class="replay-graph-sheet-panel">
        <header class="replay-graph-sheet-header">
          <h2
            id="replayGraphSheetTitle"
            class="sr-only"
            data-i18n="replayExploreCharts"
          >
            Explore charts
          </h2>
          <div class="replay-graph-sheet-grip" aria-hidden="true"></div>
          <section
            class="replay-axis-group replay-sheet-axis-group"
            role="group"
            aria-label="Dashboard axis"
            data-i18n-aria="replayDashboardAxis"
          >
            <button
              type="button"
              class="replay-axis-btn replay-toolbar-icon-btn"
              data-axis="time"
              data-i18n-aria="replayAxisTime"
              data-i18n-title="replayAxisTime"
              aria-label="Time"
              title="Time"
            >
              <span class="btn-icon" aria-hidden="true"></span>
              <span class="replay-sheet-axis-label" data-i18n="replayAxisTime">Time</span>
            </button>
            <button
              type="button"
              class="replay-axis-btn replay-toolbar-icon-btn"
              data-axis="distance"
              data-i18n-aria="replayAxisDistance"
              data-i18n-title="replayAxisDistance"
              aria-label="Distance"
              title="Distance"
            >
              <span class="btn-icon" aria-hidden="true"></span>
              <span class="replay-sheet-axis-label" data-i18n="replayAxisDistance">Distance</span>
            </button>
          </section>
          <button
            id="closeReplayGraphSheet"
            type="button"
            class="replay-graph-sheet-close"
            data-i18n-aria="close"
            data-i18n-title="close"
            aria-label="Close"
            title="Close"
          >
            <span class="btn-icon" aria-hidden="true"></span>
          </button>
        </header>

        <section class="replay-graph-sheet-controls">
          <section
            class="replay-filter-group"
            aria-label="Filter range"
            data-i18n-aria="replayFilterRange"
          >
            <div class="replay-filter-row">
              <span class="replay-filter-value">
                <span class="replay-metric-label" data-i18n="replayFilterStart">Start</span>
                <strong id="replayFilterStartValue" class="replay-filter-value-text">00:00</strong>
              </span>

              <div id="replayFilterSlider" class="replay-filter-slider dual-range-input">
                <input
                  id="replayFilterStart"
                  class="replay-filter-range replay-filter-range-start"
                  type="range"
                  min="0"
                  max="1000"
                  value="0"
                  step="1"
                  aria-label="Filter start"
                  data-i18n-aria="replayFilterStart"
                />
                <input
                  id="replayFilterEnd"
                  class="replay-filter-range replay-filter-range-end"
                  type="range"
                  min="0"
                  max="1000"
                  value="1000"
                  step="1"
                  aria-label="Filter end"
                  data-i18n-aria="replayFilterEnd"
                />
              </div>

              <span class="replay-filter-value replay-filter-value-end">
                <span class="replay-metric-label" data-i18n="replayFilterEnd">End</span>
                <strong id="replayFilterEndValue" class="replay-filter-value-text">00:00</strong>
              </span>
            </div>
          </section>
        </section>

        <section class="replay-graph-sheet-grid" aria-label="Expanded replay charts">
          <article class="replay-graph-sheet-stage">
            <header class="replay-graph-sheet-stage-head">
              <span class="replay-metric-label" data-i18n="speed">Speed</span>
              <strong id="replayExpandedSpeedCurrent" class="replay-graph-sheet-current">—</strong>
            </header>
            <div class="replay-graph-sheet-canvas-wrap">
              <canvas
                id="replayExpandedSpeedCanvas"
                class="replay-expanded-graph-canvas"
                data-graph-sheet-scrub="speedMs"
                aria-label="Expanded replay speed chart"
              ></canvas>
            </div>
          </article>

          <article class="replay-graph-sheet-stage">
            <header class="replay-graph-sheet-stage-head">
              <span class="replay-metric-label" data-i18n="altitude">Altitude</span>
              <strong id="replayExpandedAltitudeCurrent" class="replay-graph-sheet-current"
                >—</strong
              >
            </header>
            <div class="replay-graph-sheet-canvas-wrap">
              <canvas
                id="replayExpandedAltitudeCanvas"
                class="replay-expanded-graph-canvas"
                data-graph-sheet-scrub="altitudeM"
                aria-label="Expanded replay altitude chart"
              ></canvas>
            </div>
          </article>

          <article class="replay-graph-sheet-stage">
            <header class="replay-graph-sheet-stage-head">
              <span class="replay-metric-label" data-i18n="heading">Heading</span>
              <strong id="replayExpandedHeadingCurrent" class="replay-graph-sheet-current"
                >—</strong
              >
            </header>
            <div class="replay-graph-sheet-canvas-wrap">
              <canvas
                id="replayExpandedHeadingCanvas"
                class="replay-expanded-graph-canvas"
                data-graph-sheet-scrub="headingDeg"
                aria-label="Expanded replay heading chart"
              ></canvas>
            </div>
          </article>
        </section>

        <section class="replay-graph-sheet-foot">
          <p class="replay-graph-sheet-hint" data-i18n="replayDragToExplore">
            Drag across the chart to scrub the replay.
          </p>
        </section>
      </section>
    </section>
`;

export default replayTemplate;
