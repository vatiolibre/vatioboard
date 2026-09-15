# Tesla browser audio continuity implementation

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
