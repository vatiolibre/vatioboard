# Stable audio reference: restored main and isolated native radio

> A subsequent [best-effort radio visualization enhancement](radio-visualization-best-effort.md)
> adds optional analysis through a separate inaudible relay stream. Its vehicle
> acceptance is pending; the stable reference recorded below is preserved.

## Stable-reference designation

**Accepted on 2026-09-18.** The user reported **Pass** for all three vehicle test
groups: recording/alerts, native radio, and combined operation. They confirmed
that this codebase works as expected and designated it as the stable reference.
The [vehicle runbook](tesla-radio-background-runbook.md) records the acceptance
and preserves the test sequence for future regressions.

Repository reference at acceptance: `019b918c4a1df6c3c338f33db9258a8c9ba32c58`.
The vehicle report did not separately identify the deployed build hash. The
previously reported vehicle software for this sequence is **2026.26.6.1**;
browser version and per-step diagnostic exports were not supplied.

## Reference contract for future changes

Future audio work must preserve these behaviors and use this implementation as
the comparison baseline:

- Recording, alerts, Speed and GPS retain the restored main lifecycle, activation,
  normal audible cues and service Media Session behavior.
- Shared silent PCM remains detached, looping, unmuted, volume/rate 1, with
  independent leases. Radio never suppresses recording or alert silence.
- Native radio uses its own connected, controls-hidden element, separate from
  MP3's Web Audio graph. Resolved stations start synchronously in the user gesture;
  direct stations do not require CORS headers and relay uses anonymous CORS.
- MP3 retains main's playback/graph and Media Session behavior. MP3 Pause releases
  only the Player lease. Player Stop leaves recording/alert ownership intact;
  the final silent-channel owner releasing its lease stops silence.
- Native radio yields platform presentation to the browser while it owns the
  session; active services regain their existing ownership when it pauses/stops.
  Keep source/play token guards, bounded radio retries and paused-music Rearm.
- Diagnostics remain passive. Do not reintroduce universal primary delegation,
  forced concurrent-silence experiments, global gesture priming or recovery polling
  as a replacement for this accepted architecture without new comparative evidence.

For changes to these behaviors, run the documented automated checks and repeat
all three vehicle test groups before declaring the change a stable successor.
Keep this reference and its acceptance record identifiable for comparison.

## Decision and historical evidence

The implementation decision was to return to the stable original-main approach
and extend only native radio. The silent-retention and narrower session-declaration
experiments did not restore vehicle recording/GPS behavior. Steady native radio
passed. The user explicitly clarified that the combined silent-radio experiment
was not tested; it is not recorded as a failed combined test.

The restoration reference is local `main` and `origin/main`, both at
`715223334fa72765b496ab694156a843ef5e7538`. The exact commit previously tested in
the vehicle was not supplied. Vehicle software reported is **2026.26.6.1**.
The historical main commit is the restoration source; the current stable
reference and its subsequent physical acceptance are identified above.

## Why a broader restoration was needed

The experimental branch changed the shared lease coordinator, primary delegation,
gesture activation, recording lifecycle recovery, GPS reconciliation and Media
Session ownership together. Main's PCM was already a two-second mono 44.1 kHz
zero-sample WAV, looping, unmuted, volume/rate 1. Attaching that PCM or restoring
only a session declaration did not recreate the main application.

Main's recording/Speed activation also includes feature-specific handling and
normal audible cues. A silent-only diagnostic page does not reproduce it. There
is no evidence establishing one of those differences as the Tesla root cause.
This change restores the feature implementations together and isolates radio's
specific native-media requirements.

## Restored baseline

These source files match the reference main exactly:

- `src/shared/audio-channel-retainer.ts`
- `src/app/services/drive-recording-service.ts`
- `src/app/services/driving-alert-service.ts`
- `src/app/services/driving-audio-alert-controller.ts`
- `src/app/services/gps-service.ts`
- `src/app/runtime-context.ts`
- `src/shared/recovery-coordinator.ts`
- `src/speed/audio.ts`
- `src/speed/constants.ts`
- `src/speed/speed.ts`
- `src/player/integrate-player-widget.ts`

`src/shared/audio-system.ts` restores main's lease logic, with read-only snapshot
and subscription helpers plus an explicit diagnostic rearm wrapper. There is no
primary delegation, `requireSilent`, gesture broadcast, or new recovery polling.
Main's independent owners acquire and release the original detached silent element.

`src/shared/audio-runtime.ts` restores main's MP3 queue, source handling, priming,
background-mode policy and platform controls. MP3 Pause releases its Player lease;
Stop retains main's graph cleanup/replacement behavior. Recording and alert leases
remain independent. This intentionally supersedes the branch's paused-music
retention and universal persistent-primary policies.

`src/shared/media-session-adapter.ts` restores main's safe API facade and client
priorities. Recording and Speed again publish their original metadata and actions;
Player MP3 publishes its normal metadata, artwork, position and transports.
`setMediaSessionEnabled` plumbing is restored through the service boundary/widget.
No Audio Session type hints are added.

## Narrow native-radio extension

- A separate document-owned hidden `#vatio-native-radio-host` contains the native
  radio element. Controls occupy no screen space. MP3's element and graph are
  separate; switching back reuses its existing element when main permits.
- Station selection resolves the existing direct/relay URL synchronously and calls
  native `play()` within the gesture. Direct HTTPS stations need no CORS headers;
  relay uses anonymous CORS. HLS/invalid sources remain unsupported by the resolver.
- Radio is excluded from Web Audio graph acquisition and background caching.
  Existing radio directory, permission checks, relay worker and station UI remain.
- Radio does not acquire a Player silent lease and cannot suppress feature leases.
  A recording/alert lease runs the same silent element during station changes,
  radio Pause and Player Stop. Radio alone retains its native-only baseline.
- The native client participates in main's priorities. When it wins, prior custom
  platform metadata/actions are cleared and the browser supplies presentation.
  When radio pauses/stops, active recording/Speed ownership can resume. The
  application continues to provide queue and transport controls for radio.
- Live seek is disabled. Stations reuse the same native element. A startup timeout
  reports failure; an established stream has at most two delayed retry attempts.
  Duplicate retry events coalesce; Pause/Stop cancel retries. Operation tokens
  reject stale source/play completions. Delayed MP3 preparation cannot start the
  old music element after switching to radio.
- Explicit Rearm retries current background leases without resuming paused music.

Radio-only and actual recording/alerts now have different, deliberate ownership
paths. Their combination passed the user-reported vehicle integration test.
The main lease implementation's original timing behavior is retained rather than
reintroducing the experimental coordinator under another name.

## Diagnostics and harness

The existing passive observer, bounded event history, optional JSON export and
photographable summary remain. Added experiment-only GPS/silent-demand fields and
modes have been removed; no placeholder GPS readings are shown as measurements.
Recording validation uses the actual main app's service and sample timestamps.
The diagnostic heartbeat observes media/lifecycle state; it never recovers audio.

The harness compares native runtime radio, direct POC radio, relay-native radio,
relay-Web-Audio radio and generated audible PCM through main's finite-track path.
Stop/unmount releases its own runtime playback and reference elements/contexts,
subscriptions and diagnostic observer; it does not clear recording/alert leases.
Repeated starts/mounts are checked for duplicate observation intervals and cleanup.

`retentionTest` and `audioCompatibility` parameters are inert. There is no application
compatibility switch or optional harness GPS consumer. Photos/manual Pass/Fail are
supported without clipboard or session storage.

## Validation

Final automated results (2026-09-18):

| Command | Result |
| --- | --- |
| `pnpm test` | Pass: 2,017 unit/architecture + 100 smoke + 14 SPA/GPS tests (2,131 total) |
| `pnpm run typecheck` | Pass |
| `pnpm run lint` | Pass: 0 errors, 73 warnings |
| `pnpm run build` | Pass; Vite reported externalization, chunk-splitting and size warnings |
| `pnpm exec playwright test test/e2e/tesla-background-audio.spec.ts test/e2e/tesla-radio-poc.spec.ts --project=model-y-2024` | Pass: 3 Chromium tests |

The targeted
suite exercises synchronous native startup, CORS, no graph/cache, MP3 separation,
stale promises, bounded retries, Pause/Rearm, independent owner release, platform
ownership return, and harness lifecycle cleanup. Main's original tests exercise
recording, Speed, GPS, MP3 and Media Session behavior. The PCM test checks WAV format,
zero samples and playback properties.

Automated Chromium uses intercepted audible PCM station responses. It establishes
browser playback and isolation, not Tesla audio takeover or minimized GPS behavior.

## Physical acceptance and future regression checks

The user reported Pass for standalone recording/alerts, native radio, and combined
operation after executing the supplied vehicle test sequence. This is the physical
acceptance supporting the stable-reference designation; it is distinct from the
automated results above. The report gives group-level outcomes, not individual
step timings or exported traces.

For future builds, follow [the vehicle runbook](tesla-radio-background-runbook.md):
actual standalone recording and alerts first, native radio second, then their
combination and MP3/radio handoffs.
Use https://dev.vatioboard.com/?debugAudio=1 and
https://dev.vatioboard.com/tesla-background-audio.html.

Minimization, freezing, discarding and document destruction are different states.
Playing media does not establish continuous JavaScript/GPS execution. Record GPS
samples during minimized intervals separately from a fix obtained after returning.
The accepted reference covers the reported vehicle tests. It does not establish
execution after freezing or destruction, or compatibility with every future
vehicle/browser version.

## Changed-file inventory

### Documentation

- `docs/tesla-browser-audio-implementation.md`
- `docs/tesla-radio-background-runbook.md`

### Application, service and Speed integration

- `src/app-platform/services.ts`
- `src/app/runtime-context.ts`
- `src/app/services/drive-recording-service.ts`
- `src/app/services/driving-alert-service.ts`
- `src/app/services/driving-audio-alert-controller.ts`
- `src/app/services/gps-service.ts`
- `src/apps/player/player-app.ts`
- `src/speed/audio.ts`
- `src/speed/constants.ts`
- `src/speed/speed.ts`
- `src/types/services.ts`

### Player, shared audio and diagnostics

- `src/player/integrate-player-widget.ts`
- `src/player/player-shell.ts`
- `src/player/tesla-background-audio.ts`
- `src/shared/audio-channel-retainer.ts`
- `src/shared/audio-diagnostic-summary.ts`
- `src/shared/audio-graph-registry.ts`
- `src/shared/audio-lifecycle-diagnostics.ts`
- `src/shared/audio-runtime.ts`
- `src/shared/audio-system.ts`
- `src/shared/background-diagnostics.ts`
- `src/shared/media-session-adapter.ts`
- `src/shared/recovery-coordinator.ts`
- `tesla-background-audio.html`

### Regression and browser coverage

- `test/e2e/tesla-background-audio.spec.ts`
- `test/smoke/dev-harness-speed-page.test.js`
- `test/smoke/dev-harness-tesla-audio-page.test.js`
- `test/smoke/spa-gps-background.test.js`
- `test/unit/audio-channel-retainer.test.js`
- `test/unit/audio-player.test.js`
- `test/unit/audio-system.test.js`
- `test/unit/drive-recording-service.test.js`
- `test/unit/driving-audio-activation.test.js`
- `test/unit/gps-service.test.js`
- `test/unit/integrate-player-widget.test.js`
- `test/unit/player-widget.test.js`
- `test/unit/radio-audio-runtime.test.js`
- `test/unit/recovery-coordinator.test.js`
- `test/unit/speed-audio-recovery.test.js`
