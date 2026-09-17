# Tesla audio validation runbook

## Vehicle evidence

On 2026-09-17 the user reported that the main Player and runtime harness passed audio takeover, 30-second minimized playback, and five-minute minimized playback on **Tesla software 2026.26.6.1**. The reported harness state was `primaryConnected: true`, `backgroundStatus: delegated`, and `keepAlivePaused: true`. The native controls covered the bottom of the app. Browser version and downloadable reports were unavailable; the observations are user-reported physical results.

Earlier comparisons found the original POC, isolated VatioBoard POC, direct radio, relay-native radio, and relay-Web-Audio radio worked, while the former shared-runtime path failed. The successful configuration changed several runtime behaviors together, so no individual cause is established.

The next build makes that configuration the default for every browser and hides native controls. **The hidden-controls variant and combined-feature cases have not yet passed vehicle validation.** Automated Chromium tests are not evidence of Tesla audio focus or continuous background execution.

## URLs after deploying this build

- Main Player with diagnostics: **https://dev.vatioboard.com/?debugAudio=1**
- Comparison harness: **https://dev.vatioboard.com/tesla-background-audio.html**
- Unmodified isolated reference: **https://dev.vatioboard.com/tesla-radio-poc.html**
- Original reference: **https://dev.vatiolibre.com/radio.html**

No compatibility URL is required. Old `audioCompatibility`, `audioAttach`, `audioSilence`, `audioPrimeOthers`, `audioMediaSession`, and `audioSessionHints` parameters have no effect. Runtime options and the former playback path have been removed.

## First vehicle check: hidden controls

While parked:

1. Keep alerts and recording off. Start music in another Tesla audio app.
2. Open the main Player URL and start the same radio station used in the successful test.
3. Confirm the native-player overlay is gone and all VatioBoard buttons remain usable.
4. Record whether the competing Tesla audio stops.
5. Minimize for 30 seconds, restore, then repeat for five minutes. Record actual audible continuity.
6. Open **Audio test summary** in the Player's Radio diagnostics area. Enter the vehicle software version and select Pass/Fail/Not tested for each observation. Photograph or transcribe the summary; download and clipboard support are optional.
7. Repeat in the harness with **VatioBoard native radio** and its prefilled station. Leave the isolated comparison modes for a separate run.

Expected runtime state while playing:

- Primary attached: true; native controls: false.
- Retention: `delegated`; silent channel paused: true.
- Main app Player lease present; harness also owns its diagnostic lease.

The summary reports build identity, elapsed observation time, element state, visibility, lease owners, unrequested pauses, recovery-call outcomes, and latest lifecycle event. Counts cover the current document observation and survive bounded-history rollover. Native/browser pauses count as unrequested pauses; they are not necessarily faults. A resolved recovery promise does not prove audible output. Elapsed wall time and heartbeat gaps do not prove JavaScript or GPS ran while minimized.

Manual results are explicitly separate from detected state. They remain available across panel remounts in the same document, but reset on full reload. Storage failure does not prevent viewing or entering results. Photograph each run before navigating away.

## Playback and retention behavior

The runtime owns one document-attached primary element with controls disabled. Player controls operate it directly. Stop clears its source without destroying the reusable element/graph; routes do not own its lifetime. Native radio-to-radio handoffs reuse the element. A graph-bound MP3-to-native-radio transition may replace the incompatible element; diagnostics record `primary-element-replacement` with reason `incompatible-visualizer-graph`.

HTTPS stations use direct native playback without `crossorigin`. HTTP-only or missing stored URLs use the relay with `crossorigin=anonymous`; the Worker needs an Origin header. Radio never attaches a visualization graph. Returning to MP3 retains its visualization behavior. Source configuration and initial radio `play()` occur inside the trusted tap.

Player Play does not activate unrelated alert/speech consumers. Alert arming and recording retain their own activation paths. Custom Media Session metadata, action registration, position updates, and Audio Session type hints have been removed from all owners. The browser manages platform media presentation. Use VatioBoard controls for queue navigation and seeking; custom platform Next/Previous actions and station artwork are not promised.

| State | Retention behavior |
| --- | --- |
| Primary starts, plays, buffers, retries, or changes tracks | Leases remain; primary carries retention; silent loop paused |
| Player Pause or accepted native/browser pause | Player lease remains; silent retention is attempted |
| Rearm with intentionally paused music | Restore retention without resuming music |
| Player Stop | Release Player lease only; other owners retain silence |
| Recording active or alerts armed | Independent leases remain, including quiet/suppressed intervals |
| Final owner releases | Silent loop stops |
| Retention rejected | Keep leases and offer Rearm; no heartbeat retries |

Silent-only retention is a separate hypothesis from the successful audible-radio test. Primary-carrier delegation records intent and does not guarantee sound while a source buffers or fails.

## Combined-feature regression matrix

After the first check, repeat takeover and minimized playback for:

1. Pause → Rearm → Play, confirming Rearm leaves music paused.
2. Station changes and Next/Previous; Stop followed by another Play.
3. MP3 → radio → MP3, including enabled MP3 visualization and unchanged lease ownership through handoffs.
4. Alerts armed before playback, quiet intervals, temporary suppression, and an audible alert during radio.
5. Recording started before radio, then combined recording and alerts.
6. Player Stop while recording/alerts remain active, followed by final-owner shutdown.
7. Navigate away from Player and return while playback continues.
8. Restore after an interruption and exercise the displayed Rearm control.

Record browser version when available. For GPS, distinguish missing callbacks while hidden from recovery after return; preserved recording intent does not establish continuous route coverage.

## Harness controls and cleanup

The radio inputs default to SomaFM Groove Salad (128k MP3), `https://ice2.somafm.com/groovesalad-128-mp3`, UUID `960cf833-0601-11e8-ae97-52543be04c81`. Edit both for another station.

- **START TESLA BACKGROUND TEST** uses two locally generated audible PCM tones; no network resolution is needed at the tap.
- **VatioBoard native radio** exercises the production runtime and Player/harness leases.
- **POC direct radio**, **Relay native radio**, and **Relay Web Audio radio** remain independent comparison modes with visible native controls and no runtime leases.
- Play, Pause, Next, Previous, Seek and Rearm operate runtime playback. Baselines use their native controls.
- **STOP TEST**, **Stop everything**, and unmount release harness-owned resources and the harness-started Player session; unrelated feature leases remain.
- **Audio test summary** provides the photographable runtime report. Baseline-specific state and events remain in Current state / Recent events; the summary's primary metrics describe the shared runtime.

The existing observer has one optional two-second heartbeat and bounded history with aggregated time updates. The summary adds no timer. `?debugAudio=0` disables diagnostics in the main app; `?debugBackground=1` remains an alias. Reports omit stream URLs, station identifiers, and coordinates.

## Validation commands

```sh
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm exec playwright test test/e2e/tesla-background-audio.spec.ts test/e2e/tesla-radio-poc.spec.ts --project=model-y-2024
```

See [the implementation report](tesla-browser-audio-implementation.md) for exact results. Deploy separately after reviewing the build.

## Platform limits

- **Minimized/backgrounded:** the document exists; callbacks may be throttled while media continues.
- **Frozen:** freezable task queues stop. Timers cannot wake the page.
- **Discarded:** the document is gone; reloading creates new elements and loses in-memory observations.
- **Browser process destroyed:** page JavaScript and media cannot continue.

Silent PCM is not a timer exemption guarantee: [Chrome timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/). Freezing and discard are controlled by the browser: [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).

LongPlay remains historical evidence only. Its [Connect-only migration](https://github.com/Hiepler/LongPlay/commit/3f03403e0e4589322536029e3744bb3786290576) removed browser playback activation and visibility recovery; its zero-volume keep-alive is not used here.
