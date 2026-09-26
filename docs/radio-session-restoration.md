# Radio restoration after refresh or revisit

## Evidence and comparison

The user reports that MP3 restores successfully, takes Tesla audio focus and keeps
playing minimized, but restored radio briefly takes focus, then mixes with other
vehicle audio and stops when minimized. This is a separate failure from the
previously accepted native-radio tests. The Tesla audio-focus decision is not
exposed by the browser; a resolved `play()` promise does not establish focus.

| Path | Retention and activation before this change |
| --- | --- |
| MP3 restore | Restores the queue, enables background mode, acquires `player-runtime` silence, resumes its existing graph, primes and plays music; publishes managed Media Session state |
| Radio restore | Restores the queue and immediately plays the connected native element; explicitly skips Player silence and leaves platform presentation native |
| Radio visualization | After `playing`, automatically opens a second inaudible relay stream and AudioContext, even after autoplay restoration |

The missing Player carrier is confirmed in code. The optional second stream is
another possible cause of the delayed focus change, **not a proven Tesla cause**.
Chrome also treats media autoplay and AudioContext activation separately; see
[Chrome autoplay policy](https://developer.chrome.com/blog/autoplay).

## Change

- A radio station loaded from a saved session now uses the existing MP3 Player
  keep-alive lease while playback is requested, including connecting and retries.
  The native primary element stays connected, controls-hidden and graph-free.
- A newly selected station keeps the accepted native startup path. Selecting a
  different track ends the restoration-specific policy; there is no URL switch.
- The restored station's visuals stay off until explicitly requested. Fresh station
  selection still permits one automatic visualization attempt after connection.
- Pause, Stop, blocked native autoplay and terminal failure release only the Player
  lease. Recording and alert leases remain independent. A saved paused session
  stays paused. Play retries primary and retention without waiting between them.
- Failure to start silence does not pause successful radio. There is no heartbeat
  retry loop, no claim that silent audio guarantees JavaScript/GPS execution, and
  no new custom Media Session writes or Audio Session hints for radio.
- A persisted `pageshow` (Back/Forward cache return) rearms a previously active
  station once, unless the user paused, stopped or selected another track. Ordinary
  visibility changes do not restart paused music.
- Diagnostics show **Restored radio retention: yes (visuals manual)**, lease owners
  and primary/silent progress. The bounded event log records
  `native-radio-restoration` with `saved-session` or `pageshow` as its reason.

This is a recovery candidate pending vehicle acceptance. Reusing MP3's carrier
does not prove identical Tesla behavior; native radio still intentionally leaves
platform presentation to the browser.

## Vehicle checks (parked)

Open https://dev.vatioboard.com/?debugAudio=1 after deploying this build.

1. Keep recording and alerts off. Start another Tesla audio app, select a known
   working station and confirm the fresh-radio baseline.
2. Refresh while radio plays. Leave Visuals and Milkdrop off. Expand **Audio test
   summary**: expect restored retention **yes**, owner **player-runtime**, silent
   paused **false**, and advancing primary/silent clocks. Photograph the summary.
3. Confirm other vehicle audio stays stopped for at least 30 seconds. Minimize for
   30 seconds, then five minutes. Record takeover and playback results separately.
4. Navigate away and return, then repeat by closing/reopening the page. Repeat the
   same takeover and minimized checks. Back/Forward cache and a new document are
   different browser paths and should be reported separately.
5. Pause and refresh: radio must stay paused. Tap Play once and repeat the checks.
   If autoplay is blocked, record that separately and retry with Play.
6. After restoration passes with visuals off, tap Visuals once and repeat. If focus
   fails only now, report it as analysis-related rather than restoration failure.
7. Repeat with recording/alerts enabled; Player Stop must leave their silence active.
   Finally retest MP3 restoration and fresh radio selection.

Do not mark this candidate stable until these checks pass in the vehicle. Record
Tesla software version, build identity and whether visuals were enabled.
