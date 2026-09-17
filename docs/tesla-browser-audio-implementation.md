# Tesla-tested audio default implementation

## Outcome and evidence

The user reported both the main Player and runtime harness passing audio takeover, 30-second minimized playback and five-minute minimized playback on Tesla software **2026.26.6.1**. Those tests used an attached primary element with visible native controls. No browser version or exported diagnostics was available.

This revision adopts that configuration as the application default, removes its flags and legacy branches, and hides native controls. It adds a photographable report. **Hidden controls and combined alerts/recording still need physical testing.** The build has not been deployed by this implementation task.

## Previous architecture and weaknesses

The shared runtime owned a primary element, reusable visualizer graph, independent Player/alert/recording leases, and a zero-sample PCM retention channel. A shared adapter arbitrated custom Media Session metadata and actions. Player gestures could prime other consumers. The original default used a detached primary element and simultaneous silent retention; the later compatibility experiment attached it, delegated retention, skipped unrelated Player activation, and suppressed platform writes.

The vehicle comparison found direct, relay-native, relay-Web-Audio and isolated POC paths worked while the old runtime failed. The combined compatibility configuration then worked, narrowing the investigation to runtime integration without proving which individual change was decisive. Its fixed native-controls host obscured application buttons.

## Changes and lifecycle

- The primary is always a document-attached audio element in a hidden, zero-layout host outside route ownership. Controls are disabled; application transport controls remain. Stop clears the source and state while preserving identity and reusable graph. The existing graph-bound MP3-to-native-radio replacement exception remains logged.
- Primary startup/playback intent delegates retention and pauses the silent channel; leases remain continuous through buffering, retries and handoffs. Player Pause retains its lease and attempts silent retention. Player Stop releases only Player ownership. Final-owner release stops silence.
- Player gestures do not activate unrelated consumers. Alert and recording activation remains feature-specific. Native/browser pauses are respected after startup guards. Rearm preserves intentional music pause; existing recovery budgets and operation tokens remain.
- Custom Media Session writers, action/position/metadata ownership plumbing, artwork-only helpers and Audio Session type writes are removed. The obsolete `setMediaSessionEnabled`, `updatePlayerMediaSessionMetadata`, widget `mediaSession` option and Player-app audio ownership initialization are removed, rather than retained as no-ops. Read-only platform observation remains.
- Compatibility configuration and the harness options dialog are removed. Old query switches do nothing; all browsers use the same runtime. The isolated POC and direct/relay comparison modes remain available.
- The shared diagnostic summary uses the existing observer, with no new timer. It shows build timestamp (or supplied `VITE_BUILD_ID`), elapsed wall time, primary/retention state, owners, interruption/recovery-call totals, latest lifecycle event, and manually entered vehicle version and test outcomes. Counts are document-scoped and independent of bounded event-history rollover. Recovery resolution is explicitly not proof of audible output. Manual entries survive panel remounts, not full navigation.
- Storage and clipboard are optional. The summary displays in the Player Radio diagnostics area and harness and can be photographed. Export also includes the observation fields; privacy filtering remains in place for event details.

## Test changes

Media mocks now provide controllable state on actual DOM audio elements. Obsolete tests of removed platform ownership/metadata APIs were retired; retained Player/radio, lease, GPS, alert and visualizer tests exercise the new behavior. Browser assertions cover attached controls-hidden playback, silent delegation, paused-music Rearm, source handoffs, inert old query switches, no platform writes, and manual report controls. Summary tests cover unavailable storage, repeated mounts without timers and totals surviving history rollover.

## Validation

| Command | Result |
| --- | --- |
| `pnpm test` | Unit/architecture stage passed: 171 files, 2,029 tests. Smoke stage exposed three obsolete Speed assertions expecting custom Media Session writes; these were corrected and the complete smoke command rerun below. |
| `pnpm run test:smoke` | Passed: 100 general smoke and 14 GPS/background tests. |
| `pnpm exec vitest run test/unit/drive-recording-service.test.js` | Passed: 9 tests, including the added delegated-retention recording regression. |
| `pnpm exec vitest run test/unit/audio-diagnostic-summary.test.js` | Passed: 3 tests after the final live-state summary adjustment. |
| `pnpm exec playwright test test/e2e/tesla-background-audio.spec.ts test/e2e/tesla-radio-poc.spec.ts --project=model-y-2024` | Passed: 4 Chromium tests. |
| `pnpm run typecheck` | Passed after final source changes. |
| `pnpm run lint` | Passed: 0 errors, 73 warnings. Final changed summary/recording files also passed targeted lint. |
| `pnpm run build` | Passed; existing vendor externalization, mixed-import and chunk-size warnings remain. |
| `git diff --check` | Passed. |

Earlier focused runs identified obsolete Media Session expectations and primary-element mocks that targeted the old `Audio` constructor. The tests now exercise DOM media nodes and native platform ownership. A full run started before obsolete tests were removed was stopped; the recorded unit/architecture pass above is from its replacement. No remaining test failures are known.

Recording's subscription now treats `delegated` as armed while its lease is owned. The dedicated regression confirms recording remains armed through Player delegation and the return to silent retention.

## Vehicle acceptance and limitations

Use **https://dev.vatioboard.com/?debugAudio=1** and **https://dev.vatioboard.com/tesla-background-audio.html** after deployment. Follow [the runbook](tesla-radio-background-runbook.md) for hidden-controls takeover/minimization, Pause/Rearm, MP3/radio handoffs, routes, combined recording/alerts, and final-owner shutdown.

The initial successful configuration had visible controls; hiding them changes one browser-facing property and remains unverified in the vehicle. Silent-only retention remains a hypothesis. Renderer freezing, discard or destruction cannot be overridden by application timers. Missing background GPS callbacks are not continuous route coverage. No automated result is presented as Tesla continuity proof.

## Every changed file

- `docs/tesla-browser-audio-implementation.md`
- `docs/tesla-radio-background-runbook.md`
- `src/app-platform/services.ts`
- `src/app/services/drive-recording-service.ts`
- `src/apps/player/player-app.ts`
- `src/player/integrate-player-widget.ts`
- `src/player/player-shell.ts`
- `src/player/tesla-background-audio.ts`
- `src/shared/audio-compatibility.ts`
- `src/shared/audio-diagnostic-summary.css`
- `src/shared/audio-diagnostic-summary.ts`
- `src/shared/audio-lifecycle-diagnostics.ts`
- `src/shared/audio-runtime.ts`
- `src/shared/audio-system.ts`
- `src/shared/background-diagnostics.ts`
- `src/shared/media-session-adapter.ts`
- `src/shared/media-session-artwork.ts`
- `src/speed/audio.ts`
- `src/speed/constants.ts`
- `src/speed/speed.ts`
- `src/types/services.ts`
- `tesla-background-audio.html`
- `test/e2e/tesla-background-audio.spec.ts`
- `test/setup/test-env.js`
- `test/smoke/dev-harness-speed-page.test.js`
- `test/smoke/dev-harness-tesla-audio-page.test.js`
- `test/smoke/spa-gps-background.test.js`
- `test/unit/app-control-platform.test.js`
- `test/unit/audio-compatibility.test.js`
- `test/unit/audio-diagnostic-summary.test.js`
- `test/unit/audio-player.test.js`
- `test/unit/audio-system.test.js`
- `test/unit/drive-recording-service.test.js`
- `test/unit/floating-panel-z-order.test.js`
- `test/unit/integrate-player-widget.test.js`
- `test/unit/media-session-adapter.test.js`
- `test/unit/media-session-artwork.test.js`
- `test/unit/milkdrop-app.test.js`
- `test/unit/player-app.test.js`
- `test/unit/player-widget.test.js`
- `test/unit/radio-audio-runtime.test.js`
- `test/unit/shell-window-integration.test.js`
- `test/unit/speed-audio-recovery.test.js`
- `vite.config.js`
