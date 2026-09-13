# Tesla radio and GPS background validation

Use this runbook against the hosted development SPA at `https://dev.vatioboard.com`. The radio Worker remains at `https://radio-media.dev.vatioboard.com`; no Tesla-specific Worker or DNS entry is required.

## Prepare the test

1. Confirm the development SPA and radio Worker are running using the checks in `workers/radio-media/README.md`.
2. In the Tesla browser, open `https://dev.vatioboard.com/?debugBackground=1`.
3. Allow location access if GPS recording will be tested.
4. Open Player, select Radio, and choose a non-HLS station.
5. Confirm initial playback shows `LIVE · RELAY`. HTTP and HTTPS stations both start on the same relay-backed Web Audio channel used by MP3 music.
6. Before minimizing anything, start another Tesla audio source and then start VatioBoard radio. Confirm VatioBoard takes over the audible media channel instead of mixing with the other source.
7. Confirm the Tesla Miniplayer appears with the station title and a square station image (or the square VatioBoard fallback while the station image is being normalized).

The diagnostic flag is stored locally for the browser session. It records lifecycle and media state, but not coordinates, station identifiers, stream URLs, or listening history. Open Radio after returning to VatioBoard to copy or download the report. Use `?debugBackground=0` to disable it.

Radio reuses the same shared two-second silent keep-alive element as music, recording, and camera alerts; it does not create a second loop. A trusted station tap sets playback intent, selects the browser `playback` audio session, and acquires the `player-runtime` lease before requesting station playback. This is the same opportunistic ordering used by the mature music path: Tesla audio ownership is armed inside the gesture and remains continuous while the real source connects or changes.

The Player keeps two bounded media-element roles, but normal playback uses only the `analysis` role. MP3 and relay radio share that physical element, reusable Web Audio graph, `AudioContext`, Player lease, Audio Session, and Media Session owner. Station changes and radio-to-music handoffs replace the source on that same channel without destroying its graph or closing its context. The graph-free `native-radio` role is reserved for the explicit **Use compatibility playback** recovery action (or browsers without Web Audio). Explicit Player Stop is the normal point at which both roles and the graph are disposed.

The Player lease is retained while a station connects, buffers, retries, fails, changes to another station, or explicitly enters/leaves compatibility playback. Only an explicit Player Pause or Stop releases it. Recording and armed camera/speed-alert leases are separate, so releasing the Player lease does not stop the shared loop while either of those owners remains active.

## Background audio matrix

Run each applicable combination with the Tesla browser or Player window minimized for at least five minutes:

| Scenario | Expected result |
| --- | --- |
| HTTPS or HTTP relay/Web Audio | The trusted tap arms the shared Player keep-alive first, configures CORS before the relay source, then immediately requests playback on the MP3 analysis element. |
| Player minimized | Audio and Tesla Media Session play/pause continue to target the selected station. |
| Browser minimized | Audio continues, or bounded recovery restores the same station without advancing the queue. |
| Relay failure | Player retries the same relay/analysis channel once, then performs one delayed final retry; it never migrates to native automatically. |
| Web Audio unavailable | Radio remains playable from the relay in graph-free mode and visualizers are reported unavailable. |
| Visuals hidden | Rendering/analyser consumers stop, but the relay source, analysis element, graph, context, and Player lease remain unchanged. |
| Visuals enabled | The existing **Visuals** toggle attaches to the already active shared graph and produces spectrum/scope data without changing transport. |
| Suspended graph | The same station and Player lease remain intact and the explicit compatibility action is exposed; native playback is never selected silently. |
| Audio Session interruption | `interrupted` retains intent, source, graph, and leases. Recovery waits for `active`, a visible lifecycle event, or an explicit user action. |

## Cleared-cache MP3-to-radio regression

Repeat this exact sequence before the broader matrix:

1. Clear the Tesla browser cache and open VatioBoard with `?debugBackground=1`.
2. Tap `quickAudioToggle` twice to arm background camera/speed alerts. Confirm VatioBoard takes the audio channel while remaining silent.
3. Open Player, play a demo-library MP3, and then pause it.
4. While another Tesla media source is available, select a radio station with one trusted tap.
5. Confirm the other source is muted, no competing audio appears during the transition, and radio remains audible for at least five minutes after minimizing the browser.
6. Restore VatioBoard and download diagnostics before changing playback again.

The report should show the same numeric keep-alive identity, retained `speed-alerts,player-runtime` lease IDs, the same primary/analysis element ID used by the MP3, `activeRole: "analysis"`, `analysisGraphPreserved: true`, and `graphClosedDuringHandoff: false`. A new primary element, graph close, native-role activation, or Player lease release between the trusted station tap and radio playback is a regression.

After restoring the browser, verify the station remains selected and the connection status settles on playing. Visible-page lifecycle reconciliation rearms all retained owners and reconciles the same station element and AudioContext. If the shared graph cannot resume, **Use compatibility playback** explicitly moves only that live session to the native role. This mode may provide weaker visualizers and Tesla background continuity; the next station selection returns to the analysis channel.

Use the normal **Visuals** button to test radio spectrum/scope output; there is no separate radio-only visualizer action. Turning it on primes/resumes the already active shared graph without releasing the Player lease or changing the source. Select several stations and confirm the same relay-backed element/graph is reused. Turning Visuals off stops visual rendering only: transport, element, graph, and ownership must not change.

Chromium or the vehicle OS may fully suspend or discard a hidden document. A web application cannot override that platform decision, so an explicit recovery tap can still be required after restoration.

## Combined recording and camera alerts

1. Start drive recording before starting radio.
2. Confirm the recording indicator and a fresh GPS fix.
3. Arm camera alerts with alert sound enabled. Confirm that muted or disabled alert settings are not changed by this test.
4. Start radio and confirm a test camera alert can mix over the station without replacing it.
5. Minimize the Tesla browser for at least five minutes, then restore VatioBoard and verify recording intent, alert arming, and the selected radio station all remain intact.
6. Change stations and toggle Visuals on/off. Confirm no competing Tesla audio is heard between handoffs and no owner lease is released.
7. Pause and resume radio. Confirm recording and camera-alert leases remain armed while only the Player lease is released and reacquired.
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
- relay/analysis or explicit direct-native compatibility transport;
- shared analysis or explicit compatibility mode;
- whether VatioBoard took over the Tesla audio channel before minimization;
- whether the Miniplayer showed normalized station artwork or the VatioBoard fallback;
- whether audio continued, reconnected automatically, or required one tap;
- whether station changes and Visuals transport changes remained free of competing Tesla audio;
- on iPhone Safari, whether both spectrum and scope produced live analyser data and survived a station change;
- whether GPS callbacks continued or resumed after restoration;
- whether recording and camera-alert intent survived radio pause, stop, failure, and recovery.

Run `pnpm run verify` before promoting the change beyond the development environment.
