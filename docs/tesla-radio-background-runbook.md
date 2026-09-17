# Tesla radio and GPS background validation

Use this runbook against the hosted development SPA at `https://dev.vatioboard.com`. The radio Worker remains at `https://radio-media.dev.vatioboard.com`; no Tesla-specific Worker or DNS entry is required.

## Vehicle results reported 2026-09-16

| Path | User-reported outcome |
| --- | --- |
| Original POC on dev.vatiolibre.com | Works |
| Isolated POC on dev.vatioboard.com | Works |
| Harness: POC direct radio | Works |
| Harness: Relay native radio | Works |
| Harness: Relay Web Audio radio | Works |
| Harness: VatioBoard native radio | Does not work |
| Main VatioBoard Player | Does not work |

The reported failure is competing vehicle audio during radio playback and radio stopping on browser minimization. This matrix narrows the failure to the runtime-managed path; relay transport, the hosting origin and Web Audio are not sufficient explanations. It does not yet distinguish the runtime's detached element, extra silent/priming playback, Audio Session hints or Media Session updates. Per-duration exports and vehicle/browser versions were not supplied with this result.

The compatibility experiment below implements the next comparison. It has automated Chromium coverage, but has not yet been tested in the vehicle. The previous results do not identify a single proven cause.

## Next test: shared-runtime compatibility mode

After deploying this build, open:

- **Main Player:** https://dev.vatioboard.com/?audioCompatibility=1&debugAudio=1
- **Comparison harness (compatibility is now the default):** https://dev.vatioboard.com/tesla-background-audio.html
- **Previous runtime behavior:** https://dev.vatioboard.com/tesla-background-audio.html?audioCompatibility=0
- **Working isolated reference:** https://dev.vatioboard.com/tesla-radio-poc.html

Compatibility uses a document-attached primary element with native controls. Player and other service leases remain owned, but the silent loop is paused while primary playback starts, buffers, or plays. The diagnostic status is `delegated`; it describes retention intent, not proof of audible output. Pause returns retention to the silent loop; rejection preserves leases and requires Rearm. Stop releases only the Player lease. Native-control/platform pauses are respected after the startup guard, rather than automatically restarting the station.

Player Play does not prime other consumers. All custom Media Session writes (including background and alert owners) and Audio Session type hints are disabled. The vehicle/browser supplies native media presentation; custom station metadata and Next/Previous platform actions are therefore not expected in the default experiment. Harness transport buttons still work. Alert and recording preferences are unchanged; their own activation paths remain available.

1. Start with recording and alerts inactive. In the harness, tap **VatioBoard native radio** using the default station. Confirm `primaryConnected: true`, `backgroundStatus: delegated`, and `keepAlivePaused: true`.
2. Check whether other Tesla audio stops, then minimize for 30 seconds and five minutes. Export before changing options. Repeat in the main Player with the same station.
3. If this succeeds, use **Runtime options** to restore one feature at a time. **Apply and reload** creates a fresh document and retains the entered station pair when session storage is available. The main-Player link carries the currently applied options.
4. Repeat Pause, Rearm, Play, Next, Stop, MP3/radio handoffs, then combined recording/alerts. Silent-only retention during Pause is a separate hypothesis, even if audible playback works.

| Reload-time query flag | Compatibility default | Set to test |
| --- | --- | --- |
| `audioAttach` | `1` | `0`: detached primary element |
| `audioSilence` | `0` | `1`: silent loop alongside real playback |
| `audioPrimeOthers` | `0` | `1`: Player gesture activates other consumers |
| `audioMediaSession` | `0` | `1`: shared adapter publishes metadata/actions; Player state follows actual playback events |
| `audioSessionHints` | `0` | `1`: runtime writes Audio Session type hints |

Use `audioCompatibility=1` with these flags on the main app. Without it, the main app keeps its existing behavior. Changing flags requires a full navigation/reload. Diagnostics include the applied flags and element attachment. Do not conclude that a specific feature caused the failure until its independent comparison reproduces the difference.

The sections below describe the previous runtime and broader regression matrix. Their custom Miniplayer metadata and simultaneous silent-loop expectations apply to `audioCompatibility=0`, not the default harness compatibility experiment.

## Isolated single-element reference

The native shared-runtime revision also failed physical testing: other vehicle audio played alongside radio, and radio stopped when Chromium was minimized. Do not treat the native revision as a verified Tesla fix.

Open **`https://dev.vatioboard.com/tesla-radio-poc.html`** after deploying this build. For local testing, run `pnpm dev` and use `/tesla-radio-poc.html`. The existing background-audio harness has a link to this page.

This is a byte-for-byte copy of `/home/oscar/frappe-bench/apps/vatiosite/vatiosite/www/radio.html`, the working reference supplied by Oscar. It uses a single visible `<audio controls preload="none">` element, direct station streams and the POC's existing directory search and click analytics. It has no VatioBoard runtime imports, silent PCM, alert/speech activation, custom Media Session/Audio Session writes, Web Audio, heartbeat or recovery timer. Native media controls provide pause/resume; changing stations reuses the same element. HTTP-only stations are disabled on HTTPS.

1. Stop recording before leaving the main app. Open the isolated page as a full page in the same Tesla browser, not inside the SPA or an iframe. Its isolation comes from a new document; it does not keep app services running.
2. Start a Tesla media app, search for the same HTTPS station that worked in the original POC, and tap the station's **Play** once.
3. Record whether other vehicle audio stops immediately. Minimize for 30 seconds, then at least five minutes, and record whether the station stays audible.
4. Repeat with the original `https://dev.vatiolibre.com/radio.html`, using the same station, vehicle and browser session. Record vehicle software and browser versions and both URLs.
5. If only the original works, compare hosting headers, cached content and site/browser state. If both work, add shared-runtime components individually in a later experiment: metadata/actions, then retention, then alerts. This page intentionally contains none of those integrations yet.

The isolated page has no diagnostics export because adding shared diagnostics would change the reference under test. Record the results manually. Existing harness **POC direct radio** is a separate comparison: it still imports the runtime, so it is not equivalent to this isolated document. The user subsequently reported this reference working; per-duration results remain unrecorded.

## Prepare the test

1. Confirm the development SPA and radio Worker are running using the checks in `workers/radio-media/README.md`.
   The production radio hostname is intentionally undeployed and must not be used as a readiness signal for this feature branch.
2. In the Tesla browser, open `https://dev.vatioboard.com/?debugBackground=1`.
3. Allow location access if GPS recording will be tested.
4. Open Player, select Radio, and choose a non-HLS station.
5. Confirm HTTPS stations show `LIVE` and use a direct native media stream. HTTP-only stations and entries without a stored URL show `LIVE · RELAY`; they also use native media output. Radio visualization is unavailable.
6. Before minimizing anything, start another Tesla audio source and then start VatioBoard radio. Confirm VatioBoard takes over the audible media channel instead of mixing with the other source.
7. Confirm the Tesla Miniplayer appears with the station title and a square station image (or the square VatioBoard fallback while the station image is being normalized).

The diagnostic flag is stored locally for the browser session. It records lifecycle and media state, but not coordinates, station identifiers, stream URLs, or listening history. Open Radio after returning to VatioBoard to copy or download the report. Use `?debugBackground=0` to disable it.

Radio retains the existing shared two-second silent keep-alive and independent leases. A station tap starts the actual stream before initiating silent retention and gesture activation for other consumers. Radio never primes its primary element with silence. Media Session metadata and actions remain managed by the shared adapter; they are not evidence that Tesla granted exclusive audio focus.

Radio uses native HTML media output, without a MediaElementAudioSourceNode. Direct HTTPS streams omit `crossorigin`; relay streams retain `anonymous` because the Worker requires an Origin header. Native radio-to-radio handoffs reuse the element. Transitioning from a graph-bound MP3 element replaces that incompatible element while retaining all leases. Returning to MP3 can reuse the native element and attach its normal visualization graph. Stop preserves the current element.

## Compare native playback with the POC

Open `/tesla-background-audio.html` on the development host. Both fields default to SomaFM Groove Salad (128k MP3): `https://ice2.somafm.com/groovesalad-128-mp3`, UUID `960cf833-0601-11e8-ae97-52543be04c81` (directory record and stream response checked 2026-09-16). They remain editable; change both together to compare another station. The controls use a compact Tesla layout with separately scrolling state and timeline panes. Test in a fresh page with alerts and recording inactive to isolate playback; baseline modes do not acquire shared leases. STOP TEST and unmount release only resources owned by this harness.

1. **POC direct radio**: fresh visible audio element, direct stream, native controls, no runtime ownership or silent channel.
2. **Relay native radio**: same native output, station resolved through the relay.
3. **Relay Web Audio radio**: same relay with audio routed through an AudioContext.
4. **VatioBoard native radio**: direct stream through the shared runtime, metadata, transport actions and retained Player/harness leases. Use the harness transport buttons in this mode; baseline modes use their native controls.

Each baseline start disposes its previous element and context. Turning off a visualization is not equivalent to removing its audio graph. Baseline event reports include output mode, current time, duration, context state, media state and visibility; frequent time updates update the display without filling exported lifecycle history. Baselines deliberately have no heartbeat or recovery timer.

For each mode, start a Tesla audio app first, start the test radio, verify whether the other app stops, minimize for 30 seconds and then five minutes, and export the report after returning. Record station/URL privately, vehicle software version, browser user agent, output mode, takeover outcome and minimized outcome. Compare the Player shell against the runtime harness as well. Do not infer exclusive focus from the Miniplayer title alone.

The reported pre-change Tesla test failed: VatioBoard stopped immediately on minimize and radio mixed with other vehicle audio, while the direct POC worked. The revised native runtime path also failed the subsequent vehicle test, as recorded above. Hidden-page radio recovery remains deferred; this change targets acquisition/output parity rather than forcing playback against a platform interruption. Direct HTTPS failures retry the direct stream within the existing bound; HTTP/missing URLs select the relay at resolution time, not after a failed direct attempt.

The Player lease is retained while a station connects, buffers, retries, fails, or changes to another station. Pause retains the Player lease; only explicit Stop or terminal queue completion releases it. Recording and armed camera/speed-alert leases are separate, so releasing the Player lease does not stop the shared loop while either of those owners remains active.

## Background audio matrix

Run each applicable combination with the Tesla browser or Player window minimized for at least five minutes:

| Scenario | Expected result |
| --- | --- |
| HTTPS direct / HTTP relay | The trusted tap configures the native stream and calls play before starting silent retention. |
| Player minimized | Audio and Tesla Media Session play/pause continue to target the selected station. |
| Browser minimized | Acceptance target: audio continues. Record any interruption; hidden-page recovery remains deferred. |
| Slow response | After 12 seconds the UI reports a slow connection without resetting source or leases. |
| Hard failure | Bounded immediate and delayed retries retain the same native transport. Only relay failures run relay probes. |
| Web Audio unavailable | Native radio remains playable; radio visualizers are unavailable. |
| Visuals toggled during radio | No graph attaches, including while radio is loading. |
| Audio Session interruption | Intent, source and leases survive. Recovery waits for supported lifecycle/user action. |

## Cleared-cache MP3-to-radio regression

Repeat this exact sequence before the broader matrix:

1. Clear the Tesla browser cache and open VatioBoard with `?debugBackground=1`.
2. Tap `quickAudioToggle` twice to arm background camera/speed alerts. Confirm VatioBoard takes the audio channel while remaining silent.
3. Open Player, play a demo-library MP3, and then pause it.
4. While another Tesla media source is available, select a radio station with one trusted tap.
5. Confirm the other source is muted, no competing audio appears during the transition, and radio remains audible for at least five minutes after minimizing the browser.
6. Restore VatioBoard and download diagnostics before changing playback again.

For relay startup failures, inspect Worker health and privacy-safe probe outcomes. Direct streams do not run relay probes; inspect primary media error and readiness/network state instead.

The report must show unchanged keep-alive identity and retained `speed-alerts,player-runtime` leases. A graph-bound MP3-to-radio transition should log `primary-element-replacement` with reason `incompatible-visualizer-graph`, and `graphClosedDuringHandoff: true`. The new radio element must have no graph. A native station-to-station change must preserve its element. Any Player lease release during either handoff is a regression.

After restoring the browser, verify the station remains selected. Use **Rearm background audio** to restore retention without resuming intentionally paused radio, or Play to resume it. Toggle Visuals during loading and playback and verify no audio graph appears. Return to MP3 and verify its visualization still works.

Chromium or the vehicle OS may fully suspend or discard a hidden document. A web application cannot override that platform decision, so an explicit recovery tap can still be required after restoration.

## Combined recording and camera alerts

1. Start drive recording before starting radio.
2. Confirm the recording indicator and a fresh GPS fix.
3. Arm camera alerts with alert sound enabled. Confirm that muted or disabled alert settings are not changed by this test.
4. Start radio and confirm a test camera alert can mix over the station without replacing it.
5. Minimize the Tesla browser for at least five minutes, then restore VatioBoard and verify recording intent, alert arming, and the selected radio station all remain intact.
6. Change stations and toggle Visuals on/off. Confirm no competing Tesla audio is heard between handoffs and no owner lease is released.
7. Pause and resume radio. Confirm recording and camera-alert leases remain armed without releasing or reacquiring the Player lease.
8. Stop radio. Confirm recording continues and camera alerts remain capable of sounding.
9. If GPS callbacks stopped while hidden, verify the GPS service becomes fresh again within the high-accuracy browser timeout (20 seconds).
10. If the shared audio channel was interrupted, tap the displayed rearm control and confirm the retained Player, recording, and armed-alert owners are restored. Previously muted or unarmed alerts must remain muted or unarmed.

## Compare with Radio Browser

Use the same station in [Radio Browser](https://www.radio-browser.info/search?page=1&order=clickcount&reverse=true&hidebroken=true&has_extended_info=true) and VatioBoard:

1. Record whether each site stops the previously active Tesla media source when station playback starts.
2. Record whether the Tesla Miniplayer appears, whether play/pause works, and which artwork appears.
3. Minimize the browser for five minutes on each site under the same vehicle conditions.
4. Restore VatioBoard and immediately download the background diagnostic JSON before starting or stopping another source.
5. In the diagnostic, compare the primary `play` and `playing` events, duration classification, graph presence, Player lease state, keep-alive state, Media Session state, Audio Session type/state, transport, and artwork normalization result.

Browsers are permitted to suppress geolocation callbacks for hidden documents. The acceptance requirement is that recording intent and the existing GPS consumer survive, and that one native watch is restarted when the visible page detects stale fixes. Do not interpret a missing hidden interval as continuous route coverage.

## Capture a result

Download the background diagnostic JSON from Radio after every run and note:

- Tesla model and software version;
- test duration;
- direct/relay transport and whether the primary element has a graph;
- whether VatioBoard took over the Tesla audio channel before minimization;
- whether the Miniplayer showed normalized station artwork or the VatioBoard fallback;
- whether audio continued, reconnected automatically, or required one tap;
- whether station changes and Visuals state changes remained free of competing Tesla audio;
- on iPhone Safari, whether native radio plays and returning to MP3 restores spectrum/scope;
- whether GPS callbacks continued or resumed after restoration;
- whether recording and camera-alert intent survived radio pause, stop, failure, and recovery.

Run `pnpm run verify` before promoting the change beyond the development environment.


## Standalone Tesla background audio harness

Open `/tesla-background-audio.html` on the development server or built preview. The diagnostic entry is included in the build so a Tesla can reach it without a local development environment. It is not linked from product navigation and is marked `noindex`.

```bash
pnpm dev
# Open http://<development-host>:5174/tesla-background-audio.html
# Alternatively, after pnpm run build:
pnpm exec vite preview --host 0.0.0.0
```

1. Open the harness in a parked Tesla. Record the vehicle software version, browser user agent (included in export), and start time.
2. Press **START TESLA BACKGROUND TEST** once. The page generates two quiet audible WAV tones before the gesture; it needs no music account, network stream, or library download. START uses the normal shared runtime and Media Session adapter.
3. Confirm that the Miniplayer shows **Tesla test 1**, playback is audible, and both audio elements are active. Repeated START is a no-op.
4. Minimize the browser for 30 seconds. Exercise Miniplayer Pause, Play, Next, and Previous; exercise seek if available. Pause silences the real track but retains the silent channel.
5. Leave the browser minimized for at least five minutes. Repeat once with the real track paused to isolate silent retention from audible playback.
6. Reopen the browser and export the report **before restarting playback**. Compare wall-clock/performance deltas, heartbeat count, both currentTime values, timeupdate counts, media events, visibility/lifecycle events, lease owners, and element identities.
7. Try **Rearm keep-alive** after interruption. Paused music stays paused. A rejected automatic attempt must not cause repeated play calls or error spam.
8. **STOP TEST** / **Stop everything** stops harness playback, releases its diagnostic lease and Player lease, and stops its diagnostic heartbeat. Other feature leases are never cleared by this control. In an isolated harness document this stops all playback.

For the full SPA, either `?debugAudio=1` or `?debugBackground=1` enables the same diagnostic recorder. `?debugAudio=0` disables it. It records one heartbeat every two seconds and aggregates timeupdate counts. The console prints current snapshots; the harness displays snapshots and recent events. Storage failure falls back to a bounded in-memory log. Export before closing/reloading the page if storage is unavailable.

### Retention acceptance matrix

| State | Expected shared silent channel |
| --- | --- |
| Music or radio playing, connecting, buffering, or changing sources | Retained without a lease gap |
| Music or radio paused | Retained until Player Stop |
| Player stopped, recording active | Retained by recording |
| Player stopped, camera/speed audio alerts enabled and armed | Retained by alerts, including quiet intervals |
| Recording stops while Player or alerts remain active | Retained by remaining owners |
| Alerts disabled, recording inactive, Player stopped | Paused; no feature leases remain |
| Browser pauses audio unexpectedly | Retained intent; one automatic attempt, then a user rearm if blocked |

Miniplayer playback state describes the retained background session, while the Player pause button describes the real track. Tesla may consequently keep displaying a Pause icon during silent retention. Verify how the vehicle exposes Play after Pause; record this separately from JavaScript action delivery.

### What the report can and cannot establish

A heartbeat gap indicates delayed JavaScript callbacks; audio time progress can continue independently. Neither an advancing audio clock nor a `playing` event proves that GPS callbacks or JavaScript ran continuously. Missing geolocation callbacks remain missing route coverage.

- **Minimized/backgrounded:** the document still exists; audio and callbacks may continue with throttling.
- **Frozen:** freezable task queues stop. A timer cannot wake them; recovery can run only after the browser resumes the document.
- **Discarded:** the renderer/document is gone. A later navigation/reload creates a new document and new elements; prior authorization and in-memory diagnostics may be lost.
- **Browser process destroyed:** no page JavaScript or media can continue.

Silent PCM at full element volume is an active-media hypothesis, not an exemption guarantee. Chrome explicitly says a silent track does not qualify for the sound-based minimal timer-throttling condition: [Chrome timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/). Lifecycle policy and discard behavior are browser-controlled: [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).

LongPlay was inspected as historical evidence. Its [original background-audio helper](https://github.com/Hiepler/LongPlay/commit/15a278b1c13979e06723b61e665354e8bbe57cb1) generated PCM silence but used zero element volume. Its [Connect-only migration](https://github.com/Hiepler/LongPlay/commit/3f03403e0e4589322536029e3744bb3786290576) removed the browser Web Playback SDK, silent keep-alive activation, and visibility resume handler. Those changes explain its different ownership goal; they are not adopted here.

**The new compatibility mode has not been physically validated in a Tesla.** The user-reported results above apply to earlier builds. Unit/smoke checks demonstrate software behavior only. Run the matrix on each supported vehicle/browser version before claiming continuous minimized playback or background JavaScript/GPS execution.
