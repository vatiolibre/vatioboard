# Tesla radio and GPS background validation

Use this runbook against the hosted development SPA at `https://dev.vatioboard.com`. The radio Worker remains at `https://radio-media.dev.vatioboard.com`; no Tesla-specific Worker or DNS entry is required.

## Prepare the test

1. Confirm the development SPA and radio Worker are running using the checks in `workers/radio-media/README.md`.
   The production radio hostname is intentionally undeployed and must not be used as a readiness signal for this feature branch.
2. In the Tesla browser, open `https://dev.vatioboard.com/?debugBackground=1`.
3. Allow location access if GPS recording will be tested.
4. Open Player, select Radio, and choose a non-HLS station.
5. Confirm initial playback shows `LIVE · RELAY`. HTTP and HTTPS stations both start on the same relay-backed Web Audio channel used by MP3 music.
6. Before minimizing anything, start another Tesla audio source and then start VatioBoard radio. Confirm VatioBoard takes over the audible media channel instead of mixing with the other source.
7. Confirm the Tesla Miniplayer appears with the station title and a square station image (or the square VatioBoard fallback while the station image is being normalized).

The diagnostic flag is stored locally for the browser session. It records lifecycle and media state, but not coordinates, station identifiers, stream URLs, or listening history. Open Radio after returning to VatioBoard to copy or download the report. Use `?debugBackground=0` to disable it.

Radio reuses the same shared two-second silent keep-alive element as music, recording, and camera alerts; it does not create a second loop. A trusted station tap sets playback intent, selects the browser `playback` audio session, and acquires the `player-runtime` lease before requesting station playback. This is the same opportunistic ordering used by the mature music path: Tesla audio ownership is armed inside the gesture and remains continuous while the real source connects or changes.

The Player keeps one long-lived media element for both MP3 and relay radio. They share that physical element, reusable Web Audio graph, `AudioContext`, Player lease, Audio Session, and Media Session owner. Station changes and radio-to-music handoffs replace the source on that same channel without destroying its graph or closing its context. Explicit Player Stop clears the source and Player lease while preserving the same element and reusable graph for the next Play. Normal local/remote MP3 and relay-radio handoffs preserve both. Only a source explicitly declared incompatible with analysis can require replacing a graph-bound element.

The Player lease is retained while a station connects, buffers, retries, fails, or changes to another station. Pause retains the Player lease; only explicit Stop or terminal queue completion releases it. Recording and armed camera/speed-alert leases are separate, so releasing the Player lease does not stop the shared loop while either of those owners remains active.

## Background audio matrix

Run each applicable combination with the Tesla browser or Player window minimized for at least five minutes:

| Scenario | Expected result |
| --- | --- |
| HTTPS or HTTP relay/Web Audio | The trusted tap arms the shared Player keep-alive first, configures CORS before the relay source, then immediately requests playback on the MP3 analysis element. |
| Player minimized | Audio and Tesla Media Session play/pause continue to target the selected station. |
| Browser minimized | Audio continues, or bounded recovery restores the same station without advancing the queue. |
| Slow relay response | After 12 seconds the UI reports a slow connection, but keeps the same source request, element, graph, lease, and Media Session intact. |
| Hard relay failure | A media error starts a privacy-safe station probe and retries the same relay/analysis channel once, then performs one delayed final retry without changing elements. |
| Web Audio unavailable | Radio remains playable from the relay and visualizers are reported unavailable. |
| Visuals hidden | Rendering/analyser consumers stop, but the relay source, analysis element, graph, context, and Player lease remain unchanged. |
| Visuals enabled | The existing **Visuals** toggle attaches to the already active shared graph and produces spectrum/scope data without changing transport. |
| Suspended graph | The same station, element, and Player lease remain intact; use the normal Play control if a fresh gesture is required. |
| Audio Session interruption | `interrupted` retains intent, source, graph, and leases. Recovery waits for `active`, a visible lifecycle event, or an explicit user action. |

## Cleared-cache MP3-to-radio regression

Repeat this exact sequence before the broader matrix:

1. Clear the Tesla browser cache and open VatioBoard with `?debugBackground=1`.
2. Tap `quickAudioToggle` twice to arm background camera/speed alerts. Confirm VatioBoard takes the audio channel while remaining silent.
3. Open Player, play a demo-library MP3, and then pause it.
4. While another Tesla media source is available, select a radio station with one trusted tap.
5. Confirm the other source is muted, no competing audio appears during the transition, and radio remains audible for at least five minutes after minimizing the browser.
6. Restore VatioBoard and download diagnostics before changing playback again.

If startup fails, the report should include `relayEnvironment: "development"`, the Worker build version, and either a relay health state or categorical probe outcome. A healthy probe paired with a media decode error points toward CORS/codec/Web Audio compatibility; a failed probe identifies the directory, target, upstream, or content stage without storing the station URL.

The report should show the same numeric keep-alive identity, retained `speed-alerts,player-runtime` lease IDs, the same primary/analysis element ID used by the MP3, `analysisGraphPreserved: true`, and `graphClosedDuringHandoff: false`. A new primary element, graph close, or Player lease release between the trusted station tap and radio playback is a regression.

After restoring the browser, verify the station remains selected and the connection status settles on playing. Visible-page lifecycle reconciliation rearms all retained owners and reconciles the same station element and AudioContext. If the browser requires a fresh gesture, use **Rearm background audio** to restore retention without resuming intentionally paused music, or Play to resume music; no alternate radio transport is created.

Use the normal **Visuals** button to test radio spectrum/scope output; there is no separate radio-only visualizer action. Turning it on primes/resumes the already active shared graph without releasing the Player lease or changing the source. Select several stations and confirm the same relay-backed element/graph is reused. Turning Visuals off stops visual rendering only: transport, element, graph, and ownership must not change.

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
- relay transport on the shared analysis element;
- whether VatioBoard took over the Tesla audio channel before minimization;
- whether the Miniplayer showed normalized station artwork or the VatioBoard fallback;
- whether audio continued, reconnected automatically, or required one tap;
- whether station changes and Visuals state changes remained free of competing Tesla audio;
- on iPhone Safari, whether both spectrum and scope produced live analyser data and survived a station change;
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

**Physical Tesla validation has not been performed in the development environment.** Unit/smoke checks demonstrate software behavior only. Run the matrix on each supported vehicle/browser version before claiming continuous minimized playback or background JavaScript/GPS execution.
