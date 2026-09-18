# Best-effort radio visualization

## Status

Optional enhancement to the [vehicle-accepted audio reference](tesla-browser-audio-implementation.md).
Scope, spectrum and Milkdrop can analyse radio through a separate relay stream.
The enhancement has not yet been vehicle-accepted. The recorded reference commit
and its physical acceptance remain unchanged.

## Playback and failure policy

- Audible radio keeps its connected native element, original direct/relay source,
  CORS policy and native Media Session ownership. It is never bound to Web Audio.
- Scope/spectrum starts disabled for each radio station. Once native radio reports
  playing, the Player makes one automatic attempt to enable analysis. Only success
  turns the toggle on; browser restrictions leave it off for a single-tap retry.
  This does not change the saved MP3 visualizer preference. Milkdrop opens manually.
- Requesting a radio visualizer opens a second, CORS-enabled stream from our relay.
  All open visualizers share that analysis element and its single audio graph.
- The analysis element starts muted. It is unmuted only after its graph connects
  through a gain fixed at zero to the destination. Visualizers read samples before
  that gain; the second stream must not produce audible output.
- For manual requests, context resume and analysis `play()` start synchronously
  from the requesting gesture. The automatic attempt may be blocked by the browser. Optional module loading never delays primary radio playback.
- Missing AudioContext, blocked playback, relay/CORS/codec errors, startup taking
  longer than eight seconds, media interruption or suspended context makes analysis
  unavailable. Stale completions cannot unmute or change a newer analysis element.
  There is no recovery polling, repeated automatic retry or primary source reset.
- Scope/spectrum and Milkdrop retain independent analysis ownership. Closing the
  last viewer releases the analysis stream and graph. Unsupported renderers release
  their ownership without stopping another viewer or the audible stream.
- Pause, Stop, a new track, a hidden document or pagehide disposes the current
  analysis stream. A station change or explicit Play can start a new analysis
  attempt for already-requested viewers. Returning from a minimized browser alone
  does not restart analysis; tap a visualization control to retry it.
- Recording/alert leases, silent PCM and their platform ownership are unchanged.
  Analysis acquires no background lease and writes no platform metadata/actions.

## Tradeoffs

While active, analysis opens a second stream and increases bandwidth, relay load
and decoding/rendering work. The native stream and relay stream buffer independently;
visuals may lag or lead the sound and are not sample-synchronized. A silent station
or a CORS response that yields zero samples can produce a flat visualizer; this is
not evidence that audible playback failed. There is no waveform-based retry loop.

The inaudible graph is intended to preserve native playback, but additional media
and Web Audio activity can still affect Tesla's platform behavior. This must be
measured in the vehicle before designating the enhancement a stable successor.

## Controls and vehicle checks

Main app: https://dev.vatioboard.com/?debugAudio=1

Start radio: the Visuals toggle stays off while connecting, then turns on only if
the automatic attempt succeeds. If unavailable, playback should continue and the
toggle stays off; tap it once to retry. Disabling visuals keeps them off for that
station. A new station receives a fresh automatic attempt. Open Milkdrop manually
and close/reopen it for an explicit retry.

Harness: https://dev.vatioboard.com/tesla-background-audio.html

1. Tap **VatioBoard native radio** and reconfirm the accepted baseline.
2. Tap **Radio spectrum**, **Radio scope**, then **Radio Milkdrop**. Check animation
   and confirm there is no second audible stream or echo.
3. Check takeover of other Tesla audio, 30 seconds minimized and five minutes
   minimized. Analysis should stop while hidden; native audio must continue.
4. Return and explicitly enable visualization again. Switch stations, test Pause,
   Play and Stop, and use **Disable visualizations** while the radio is playing.
5. In the main application repeat the accepted recording/alerts, radio, and combined
   test groups. Verify recorded GPS samples separately from audio continuity.
6. Test a relay failure or unsupported visualizer: audio should remain on the same
   native element and recording/alerts should retain their leases.

The harness reports `visualizationStatus` and `analysisCurrentTime` separately from
primary playback and keep-alive state. An analysis failure is not a radio failure.
Photograph results; exporting is optional.

## Automated validation

Tests cover radio visuals disabled during connection, one automatic attempt,
single-tap retry after rejection, stale station changes, zero-gain routing,
synchronous requests, unavailable APIs, media errors,
deadlines, stale promises, shared viewer ownership, independent feature leases,
Pause/hidden cleanup and renderer teardown. Chromium uses controlled radio fixtures
to verify nonzero analyser samples and native-element isolation. Validation completed on 2026-09-18:

| Command | Result |
| --- | --- |
| `pnpm test` | Pass: 2,030 unit/architecture + 100 smoke + 14 SPA/GPS tests (2,144 total) |
| `pnpm run typecheck` | Pass |
| `pnpm run lint` | Pass: 0 errors, 73 warnings |
| `pnpm run build` | Pass, with Vite externalization/chunk warnings |
| `pnpm exec playwright test test/e2e/tesla-background-audio.spec.ts test/e2e/tesla-radio-poc.spec.ts --project=model-y-2024` | Pass: 4 Chromium tests |

The new Chromium test verifies nonzero analysis samples, scope/spectrum controls,
Milkdrop opening without disrupting primary playback, analysis shutdown, and relay
failure while the original native element keeps playing without a Web Audio graph.
Automation does not establish Tesla focus or vehicle acceptance of this enhancement.

## Implementation locations

- `src/shared/radio-analysis.ts`: optional stream, timeout, cancellation and cleanup.
- `src/shared/audio-graph-registry.ts`: zero-gain analysis output; native guard retained.
- `src/shared/audio-runtime.ts`: viewer ownership and playback/visibility lifecycle.
- `src/player/player-shell.ts`, `src/player/player-widget.ts`: scope/spectrum controls
  and release when hidden/destroyed.
- `src/player/milkdrop-panel.ts`: analysis source selection, independent ownership,
  stale-wiring guards and renderer disconnection.
- `src/player/tesla-background-audio.ts`: comparison controls and separate analysis state.
- `test/unit/radio-analysis.test.js`, `test/unit/radio-audio-runtime.test.js`,
  `test/unit/audio-graph-registry.test.js`, `test/e2e/tesla-background-audio.spec.ts`:
  feature regression coverage.
