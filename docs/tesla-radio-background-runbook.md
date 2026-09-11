# Tesla radio and GPS background validation

Use this runbook against the hosted development SPA at `https://dev.vatioboard.com`. The radio Worker remains at `https://radio-media.dev.vatioboard.com`; no Tesla-specific Worker or DNS entry is required.

## Prepare the test

1. Confirm the development SPA and radio Worker are running using the checks in `workers/radio-media/README.md`.
2. In the Tesla browser, open `https://dev.vatioboard.com/?debugBackground=1`.
3. Allow location access if GPS recording will be tested.
4. Open Player, select Radio, and choose a non-HLS station.
5. Record the transport badge: `LIVE · DIRECT` or `LIVE · RELAY`.

The diagnostic flag is stored locally for the browser session. It records lifecycle and media state, but not coordinates, station identifiers, stream URLs, or listening history. Open Radio after returning to VatioBoard to copy or download the report. Use `?debugBackground=0` to disable it.

## Background audio matrix

Run each applicable combination with the Tesla browser minimized for at least five minutes:

| Transport | Visualizer | Expected result |
| --- | --- | --- |
| Direct | On | Audio continues, or Player reconnects through the relay without advancing the queue. |
| Direct | Off | Audio continues; Tesla Miniplayer play/pause controls remain functional. |
| Relay | On | Audio continues, or the bounded relay reconnect succeeds. |
| Relay | Off | Audio continues with no queue change. |

After restoring the browser, verify the station remains selected. If Tesla suspended Web Audio, use **Resume background playback** once. The Player restarts the same station in native-background mode and disables visualizers for that live session. **Try visualizers again** returns to the analyser path from another explicit tap.

## GPS recording

1. Start drive recording before starting radio.
2. Confirm the recording indicator and a fresh GPS fix.
3. Start radio and minimize the Tesla browser for at least five minutes.
4. Restore VatioBoard and verify the recording is still in the recording state.
5. If GPS callbacks stopped while hidden, verify the GPS service becomes fresh again within the high-accuracy browser timeout (20 seconds).
6. If the shared audio channel was interrupted, tap the displayed rearm control and confirm both Player and recording report an armed keepalive.

Browsers are permitted to suppress geolocation callbacks for hidden documents. The acceptance requirement is that recording intent and the existing GPS consumer survive, and that one native watch is restarted when the visible page detects stale fixes. Do not interpret a missing hidden interval as continuous route coverage.

## Capture a result

Download the background diagnostic JSON from Radio after every run and note:

- Tesla model and software version;
- test duration;
- direct or relay transport;
- visualizer or native-background mode;
- whether audio continued, reconnected automatically, or required one tap;
- whether GPS callbacks continued or resumed after restoration.

Run `pnpm run verify` before promoting the change beyond the development environment.
