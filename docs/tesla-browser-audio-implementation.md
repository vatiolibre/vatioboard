# Tesla browser audio continuity implementation

## Compatibility experiment following vehicle results (2026-09-16)

The vehicle comparison found that direct, relay-native and relay-Web-Audio baselines worked while the shared runtime failed. This narrows the investigation to runtime integration without proving a single cause. The new mode is opt-in on the main app (`?audioCompatibility=1&debugAudio=1`) and default on the standalone harness. No new physical success is claimed.

The primary element is attached with native controls. Logical leases remain continuous, while a delegated carrier suppresses silent playback during primary startup/playback. Pausing reactivates silent retention; stopping releases only Player ownership. Generation checks protect pending silent playback across carrier changes. Player gestures can omit unrelated consumer priming. A shared adapter gate disables platform writes for every owner, and a separate gate disables Audio Session hints. When custom Media Session is enabled within compatibility mode, Player playback state follows actual media events. Native pauses are respected after startup guards.

Five independently selectable reload-time options isolate attachment, concurrent silence, other-consumer activation, Media Session writes, and Audio Session hints. The harness preserves station inputs across reloads when storage works, exposes applied configuration in diagnostics, and links to the main app with matching flags. See [the runbook](tesla-radio-background-runbook.md#next-test-shared-runtime-compatibility-mode) for URLs and acceptance steps. This is an experimental comparison, not a deployed fix or a promise of execution after freezing/discard.

Files changed for this experiment:

- `src/shared/audio-compatibility.ts`: immutable URL configuration.
- `src/shared/audio-runtime.ts`: attachment, activation gates, carrier delegation and native pause handling.
- `src/shared/audio-system.ts`: delegated retention and pending-operation protection.
- `src/shared/media-session-adapter.ts`: global platform-write gate.
- `src/types/services.ts`: delegated state contract.
- `src/shared/audio-lifecycle-diagnostics.ts`, `src/shared/background-diagnostics.ts`: configuration and attachment diagnostics.
- `src/player/tesla-background-audio.ts`, `tesla-background-audio.html`: controls, reload options, lease ordering and responsive native controls.
- `test/unit/audio-compatibility.test.js`, `test/unit/audio-system.test.js`: configuration, global write suppression and carrier races.
- `test/e2e/tesla-background-audio.spec.ts`: real Chromium compatibility playback and option reload, alongside legacy coverage.
- `test/smoke/dev-harness-tesla-audio-page.test.js`: explicit legacy preset for the existing retention assertions.
- Both Tesla documentation files: experiment scope, test URLs and results.

Validation for this experiment (separate from historical checks below):

| Command | Result |
| --- | --- |
| `pnpm test` | Passed: 2,051 unit/architecture, 100 general smoke, 14 GPS/background tests (2,165 total). |
| `pnpm exec vitest run test/unit/audio-compatibility.test.js test/unit/audio-system.test.js test/smoke/dev-harness-tesla-audio-page.test.js` | Passed: 16 tests. |
| `pnpm exec playwright test test/e2e/tesla-background-audio.spec.ts --project=model-y-2024` | Passed: 3 real-media Chromium tests, including compatibility delegation, no platform writes, native Pause/Rearm and options reload. |
| `pnpm run typecheck` | Passed. |
| `pnpm run lint` | Passed: 0 errors, 73 existing warnings. |
| `pnpm run build` | Passed; existing vendor externalization, mixed-import and chunk-size warnings remain. |
| `git diff --check` | Passed. |

An initial focused run exposed a missing jsdom dialog `close()` method during harness unmount; cleanup now relies on removing the dialog with its root. A new test initially assumed a position-state mock that the test environment did not provide; the test now supplies it. Both focused and full suites pass after these corrections. Physical Tesla validation of this mode is pending.

## Isolated single-element baseline after the second Tesla failure

The native shared-runtime path also failed the vehicle test. The next implementation is a separate `/tesla-radio-poc.html` document copied byte-for-byte from the user-provided working POC. It is included in the Vite production build and linked from the background-audio harness. It provides station search, direct native playback and native controls without importing or activating any VatioBoard audio services. Full-page navigation is intentional: SPA embedding would leave the runtime active and invalidate isolation.

This adds an isolated playback mode; it does not claim to repair the main Player. It preserves the original POC's code, including Radio Browser mirror selection and non-blocking click analytics. No features are added back until the physical baseline is established on VatioBoard's hostname.

Changed files for this follow-up: `tesla-radio-poc.html` (new unchanged POC copy), `vite.config.js` (production entry), `tesla-background-audio.html` (full-page link), `test/e2e/tesla-radio-poc.spec.ts` (real playback and isolation checks), and these two Tesla documents.

Validation for the isolated page:

- `pnpm exec playwright test test/e2e/tesla-radio-poc.spec.ts --project=model-y-2024`: 1 passed. The first run had an incorrect HTTPS-only expectation on the local HTTP test server; that test assertion was removed without changing the copied POC.
- `pnpm exec vitest run test/frontend-architecture test/smoke/dev-harness-tesla-audio-page.test.js --maxWorkers=2`: 25 passed.
- `pnpm run typecheck`: passed.
- `pnpm run build`: passed (25.78s Vite build), with existing vendor/chunk warnings. `dist/tesla-radio-poc.html`, the source copy and the user-provided local POC have identical SHA-256 hashes: `b998368bf0ba9b8f38b14abe3f9297a961481a97eff643b7474c6578a7b8f0f0`.
- `pnpm run lint`: passed with 73 warnings and zero errors.
- `git diff --check`: passed.

The browser test traps Audio/AudioContext construction and any navigator Media Session/Audio Session access, verifies no shared source modules are requested, plays cross-origin media without CORS headers, and checks one connected element is reused across stations. The test also verifies that failed click analytics do not block playback. Physical Tesla validation remains pending.

## Native radio correction after Tesla testing

The physical test of the previous implementation failed: radio mixed with vehicle audio and minimized playback stopped. The plain radio POC succeeded on the same vehicle. The sections below describe the original continuity work; this correction supersedes their references to radio sharing the MP3 graph and priming before station playback.

- HTTPS radio now uses the station URL directly and omits CORS mode. HTTP-only/missing-URL stations retain the relay and its required anonymous CORS mode. Both use native audio, with analysis disabled.
- Actual radio play is initiated before silent retention and registered gesture consumers. Primary radio priming is skipped, including rearm while intentionally paused. Existing Player, recording and alert leases survive handoffs.
- An existing graph-bound element is replaced on entry to native radio and diagnosed as an incompatible graph. Native station changes and Stop preserve element identity. MP3 visualization remains available.
- Relay probes only classify relay failures; direct failures use bounded station retries. Hidden-page recovery policy is unchanged.
- The standalone harness now compares direct native, relay native, relay Web Audio, and shared-runtime native output. Every baseline creates a fresh element and owns its cleanup, with no silent lease or retry timers.

Changed files: `src/shared/audio-source-resolver.ts`, `src/shared/audio-runtime.ts`, `src/types/services.ts`, `src/player/player-shell.ts`, `src/player/tesla-background-audio.ts`, `test/setup/test-env.js`, `test/unit/radio-audio-source.test.js`, `test/unit/radio-audio-runtime.test.js`, `test/unit/player-widget.test.js`, `test/e2e/tesla-background-audio.spec.ts`, and the two Tesla documents. The test audio mock now supports source/CORS attribute removal.

Validation for this correction:

- `pnpm test`: the first concurrent run hit worker-start timeouts and the old widget expectation. After updating the expectation, the isolated rerun passed all 2,046 unit/architecture tests but hit an acceleration-route GPS-watch assertion in smoke coverage.
- `pnpm run test:smoke`: rerun passed all 100 general smoke and 14 GPS/background tests, including that acceleration case, without changing its code or expectations.
- `pnpm exec vitest run test/unit/player-widget.test.js test/unit/radio-audio-runtime.test.js`: 80 passed after the final empty-source radio visualizer guard and its new test. This adds one unit test beyond the full-suite count above.
- `pnpm exec vitest run test/unit/radio-audio-source.test.js test/unit/radio-audio-runtime.test.js test/smoke/dev-harness-tesla-audio-page.test.js`: 28 passed.
- `pnpm exec playwright test test/e2e/tesla-background-audio.spec.ts --project=model-y-2024`: both tests passed, including a station-like HTTPS source intentionally served without CORS headers. This is desktop Chromium at a Tesla viewport, not the vehicle browser.
- `pnpm run typecheck`: passed after the final code change.
- `pnpm run lint`: passed with 73 warnings and zero errors.
- `pnpm run build`: final rebuild passed (25.79s Vite build), with existing vendor externalization and chunk-size warnings.
- `git diff --check`: passed.

Physical results for the revised code are pending; neither passing browser automation nor silent leases prove Tesla continuity.

## Previous architecture and weaknesses

VatioBoard already had a shared primary audio runtime, one PCM keep-alive element, independent background leases, priority-based Media Session clients, gesture priming, and radio/GPS lifecycle recovery. This change extends those systems.

Previously, Player Pause released the Player lease; Stop discarded the primary element and graph; local-to-remote transitions could replace a compatible graph-bound element; primary and alert priming sometimes followed asynchronous work; stale arm completion could stop a newer lease, and per-feature armed flags could miss shared recovery; diagnostics lacked a heartbeat and complete media/lifecycle observations.

## New lifecycle

1. Play, track selection, recording Start, or alert arming establishes the feature’s intent and lease.
2. The gesture activation registry synchronously starts priming/resuming registered media consumers and the shared keep-alive. Calls happen before waiting for their promises. Quiet telemetry does not cancel an in-flight silent prime, and asynchronous completion does not claim a new user gesture. Known radio sources and caller-owned blob sources start directly; asynchronous music resolution first primes the actual primary element with reusable PCM silence when it has no source.
3. The existing adapter installs current metadata and transport handlers. Source configuration and subsequent actual playback invalidate stale primary priming completion.
4. Music, radio, pauses, buffering, errors, and source changes retain the Player session. Stop or terminal queue completion releases its lease, clears the source, and preserves the element/graph for reuse.
5. Recording and enabled/armed alert consumers retain independent leases. A browser interruption does not relinquish intent. The shared channel stops when no owners remain.
6. Interruption recovery has a bounded automatic attempt. Repeated lifecycle events/telemetry updates cannot produce an autoplay retry loop. A fresh gesture can rearm all registered consumers. Actual media progress permits a new recovery episode.

Normal MP3/radio/local/remote transitions preserve the primary element. An explicitly analysis-incompatible remote source can still require replacement of a graph-bound element; this exceptional path is logged and tested. The shared keep-alive element is never replaced.

## Ownership, pause, and retention

The Player retains priority 10 and its metadata/handlers throughout its session, including Pause. Speed retains priority 5; recording retains its existing priority. A new lowest-priority background-retention client covers alert-only operation when no more specific client is active. All platform writes still go through the same adapter.

Media Session `playbackState` reports the retained session as `playing`. Music pause remains separate runtime state. Play resumes music, Pause silences it without releasing retention, Stop ends only the Player session, and Next/Previous/seek use current runtime state. Unsupported actions fail independently. Invalid/live position state clears the prior track’s position; finite positions are clamped.

The keep-alive is a valid two-second mono 44.1 kHz, 16-bit PCM WAV with zero samples. Its element is looping, unmuted, volume 1, and playback rate 1. It remains the same object for the document lifetime. Separate alert and speech elements are preserved.

The Player’s **Rearm background audio** button appears for interrupted/blocked shared audio. Rearming retains intentional music Pause and alert preferences. GPS recording intent and existing GPS recovery remain intact; no web technique fills a gap where the browser stopped delivering location callbacks.

## Interfaces

- Shared audio coordinator: `registerBackgroundAudioGestureHandler`, `activateBackgroundAudioFromGesture`, and `recoverBackgroundAudioAutomatically`. Registered handlers initiate media calls synchronously and do not acquire leases themselves.
- Priming helper: optional `isCurrent` completion guard and `silentSource` flag; existing callers remain supported.
- Diagnostics: start/stop one optional observer, read its latest snapshot, and subscribe to snapshot changes. Existing sanitized JSON exports and bounded storage remain in use, with an in-memory fallback when storage is denied.
- No backend API, database, Worker, or authentication changes.

## Harness and physical verification

Open `/tesla-background-audio.html` using `pnpm dev`, or from the built preview. The diagnostic entry is included in the build and marked `noindex`; it has no product-navigation link. START plays generated audible fixtures through the shared runtime and takes an explicit diagnostic lease. The harness maintains a two-track queue as entries are consumed, so multi-minute playback and repeated Next actions do not exhaust the fixtures. STOP releases only harness-owned playback/leases and stops the harness observer. The full manual procedure and five-minute test matrix are in [the Tesla runbook](tesla-radio-background-runbook.md#standalone-tesla-background-audio-harness).

The same recorder is enabled in the SPA by `?debugAudio=1` or `?debugBackground=1`. It samples every two seconds, aggregates timeupdate counts, records both media elements and lifecycle/action events, prints console snapshots, and supports JSON export. The heartbeat measures execution; it does not drive recovery or claim to keep a renderer awake.

Physical Tesla testing has **not** been performed here. Headless desktop Chromium is useful for genuine HTMLMediaElement playback and gesture checks, but neither it nor a Tesla-sized viewport proves vehicle background behavior. Tesla Miniplayer button presentation, hidden action delivery, audible and silent-only retention, geolocation continuity, and renderer lifecycle must be verified in the vehicle.

## Browser limits and reference evidence

Chrome documents that a silent track does not qualify for its sound-based minimal timer-throttling condition: [timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/). An active media element and explicit Media Session state are therefore a best-effort retention hypothesis, not a guarantee of uninterrupted JavaScript. [Page lifecycle documentation](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) describes browser-controlled freezing and discarding. Frozen tasks cannot restart themselves; discarded renderers and destroyed browser processes cannot continue page code.

LongPlay’s [historical background helper](https://github.com/Hiepler/LongPlay/commit/15a278b1c13979e06723b61e665354e8bbe57cb1) and [Connect-only migration](https://github.com/Hiepler/LongPlay/commit/3f03403e0e4589322536029e3744bb3786290576) were inspected. The latter removed browser playback/activation and visibility recovery. VatioBoard continues to own browser playback and does not adopt that Connect-only design.

## Validation

Automated coverage includes lease isolation and races, silent WAV bytes/properties, primary identity/graph reuse, stale priming completion, synchronous alert activation, bounded recovery, Media Session ownership/actions/position state, diagnostic storage failure, observer deduplication, and harness controls/cleanup. Existing Player, radio, Speed, recording/GPS, visualizer, and route architecture suites are included in the full test command.

The real Chromium check demonstrated advancing primary/keep-alive clocks after one START, silent retention during Pause, Pause preserved by Rearm, Next metadata updates, Stop clearing Media Session, and no page errors. A repeatable Playwright test covers this behavior plus seek.

Commands used for validation (repeated after relevant fixes):

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm exec playwright test test/e2e/tesla-background-audio.spec.ts --project=model-y-2024
pnpm exec vitest run test/unit/audio-system.test.js test/unit/audio-channel-retainer.test.js test/unit/audio-player.test.js test/unit/radio-audio-runtime.test.js
pnpm exec vitest run test/unit/audio-system.test.js test/unit/audio-channel-retainer.test.js test/unit/audio-player.test.js test/unit/radio-audio-runtime.test.js test/unit/driving-alert-service.test.js test/unit/drive-recording-service.test.js test/unit/speed-audio-recovery.test.js test/unit/media-session-adapter.test.js
pnpm exec vitest run test/unit/audio-system.test.js test/unit/audio-channel-retainer.test.js test/unit/audio-player.test.js test/unit/radio-audio-runtime.test.js test/unit/audio-lifecycle-diagnostics.test.js test/unit/media-session-adapter.test.js test/smoke/dev-harness-tesla-audio-page.test.js
pnpm exec vitest run test/unit/audio-lifecycle-diagnostics.test.js test/unit/media-session-adapter.test.js test/smoke/dev-harness-tesla-audio-page.test.js test/frontend-architecture/route-lifecycle-contract.test.js test/frontend-architecture/no-legacy-spa-scaffolding.test.js
pnpm exec vitest run test/unit/audio-player.test.js test/unit/radio-audio-runtime.test.js test/unit/driving-audio-activation.test.js test/unit/speed-audio-recovery.test.js test/unit/audio-system.test.js
pnpm exec vitest run test/unit/audio-player.test.js test/unit/radio-audio-runtime.test.js
pnpm exec vitest run test/unit/driving-audio-activation.test.js test/unit/driving-alert-service.test.js test/unit/speed-audio-recovery.test.js test/smoke/spa-gps-background.test.js
pnpm exec vitest run test/unit/driving-audio-activation.test.js test/unit/driving-alert-service.test.js test/unit/speed-audio-recovery.test.js
pnpm exec vitest run test/smoke/spa-gps-background.test.js
pnpm exec vitest run test/smoke/spa-gps-background.test.js -t 'uses the prompt primary pointerdown'
pnpm exec vitest run test/smoke/dev-harness-tesla-audio-page.test.js
git diff --check
```

Final results:

| Check | Result |
| --- | --- |
| `pnpm test` | Passed: 2,040 unit/architecture tests, 100 general smoke tests, and 14 GPS/background smoke tests (2,154 total). |
| Final harness regression | Passed after adding continuous fixture replenishment; six successive Next actions retain two queued tracks and the Player lease. |
| Playwright Chromium | Passed: 1 real-media test at the configured Model Y viewport. This is desktop Chromium, not a Tesla browser. |
| `pnpm run typecheck` | Passed. |
| `pnpm run lint` | Passed: 0 errors, 73 warnings. |
| `pnpm run build` | Passed; existing vendor externalization, mixed-import, and chunk-size warnings remain. |
| `git diff --check` | Passed. |


## Files changed

- `docs/tesla-browser-audio-implementation.md`
- `docs/tesla-radio-background-runbook.md`
- `src/app/services/drive-recording-service.ts`
- `src/app/services/driving-alert-service.ts`
- `src/app/services/driving-audio-alert-controller.ts`
- `src/i18n.ts`
- `src/player/player-shell.ts`
- `src/player/tesla-background-audio.ts`
- `src/shared/audio-channel-retainer.ts`
- `src/shared/audio-lifecycle-diagnostics.ts`
- `src/shared/audio-runtime.ts`
- `src/shared/audio-system.ts`
- `src/shared/background-diagnostics.ts`
- `src/shared/media-session-adapter.ts`
- `src/speed/audio.ts`
- `src/styles/player.less`
- `tesla-background-audio.html`
- `test/e2e/tesla-background-audio.spec.ts`
- `test/smoke/dev-harness-tesla-audio-page.test.js`
- `test/unit/audio-channel-retainer.test.js`
- `test/unit/audio-lifecycle-diagnostics.test.js`
- `test/unit/audio-player.test.js`
- `test/unit/audio-system.test.js`
- `test/unit/driving-audio-activation.test.js`
- `test/unit/media-session-adapter.test.js`
- `test/unit/radio-audio-runtime.test.js`
- `vite.config.js`
