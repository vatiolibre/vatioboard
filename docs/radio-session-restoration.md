# Radio restoration after refresh or revisit

## Physical acceptance

**User-reported vehicle verification: Pass on 2026-09-26.** The restored-radio
implementation was tested in the Tesla browser and confirmed to restore saved
stations after both refresh and revisit. After Play, the restored session follows
the working local-demo activation lifecycle, acquires Tesla vehicle audio
ownership, interrupts competing Tesla audio, and continues playing when the
Tesla browser is minimized.

This is user-reported physical acceptance, not an automated browser measurement.
Tesla software/browser versions, deployed build hash, and per-step diagnostic
exports were not supplied. Fresh radio playback and unrelated audio-service
ownership remained unchanged in the reported verification.

## Evidence and comparison

The user reports that MP3 restores successfully, takes Tesla audio focus and keeps
playing minimized, but restored radio briefly takes focus, then mixes with other
vehicle audio and stops when minimized. This is a separate failure from the
previously accepted native-radio tests. The Tesla audio-focus decision is not
exposed by the browser; a resolved `play()` promise does not establish focus.

| Path                | Retention and activation before this change                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MP3 restore         | Restores the queue, enables background mode, acquires `player-runtime` silence, resumes its existing graph, primes and plays music; publishes managed Media Session state |
| Radio restore       | Restores station metadata and native source paused; Play first runs the real restored local-demo lifecycle, then swaps that active managed session to native radio        |
| Radio visualization | After `playing`, automatically opens a second inaudible relay stream and AudioContext, even after autoplay restoration                                                    |

The missing Player carrier is confirmed in code. The optional second stream is
another possible cause of the delayed focus change, **not a proven Tesla cause**.
Chrome also treats media autoplay and AudioContext activation separately; see
[Chrome autoplay policy](https://developer.chrome.com/blog/autoplay).

## Change

- A radio station loaded from a saved session stays paused until Play. When a
  locally available demo track is present, Play loads that track through the
  same `loadTrack`/prime/visualizer/background-lease lifecycle used by restored
  demo playback, waits for decoded audio to advance, and only then swaps the
  active managed session to native radio. The demo is removed from the queue
  after the swap without releasing the Player lease.
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
- A persisted `pageshow` (Back/Forward cache return) restores a previously active
  station to the same paused local-demo gate when a takeover track is available;
  the station resumes only after Play. Fresh radio sessions retain their native
  one-time rearm behavior. Ordinary visibility changes do not restart paused music.
- The takeover source is resolved before Play and must be a local demo/static
  source; no protected takeover download is started from the gesture. There is
  no independent hidden carrier or timed silent handoff element.
- Diagnostics show restoration source/reason, focus-handoff readiness, lease owners
  and primary/silent progress. The bounded event log records
  `native-radio-restoration` with `saved-session` or `pageshow` as its reason.

This implementation is accepted for the reported Tesla-browser refresh/revisit
scenario. Continue using the checks below as a regression checklist; they do not
claim compatibility with every future Tesla software or browser version.

## Vehicle regression checklist (parked)

Open https://dev.vatioboard.com/?debugAudio=1 after deploying this build.

1. Keep recording and alerts off. Start another Tesla audio app, select a known
   working station and confirm the fresh-radio baseline.
2. Refresh while radio plays. Leave Visuals and Milkdrop off. Confirm the station
   metadata is restored but native radio remains paused and no Player lease is
   active before Play.
3. Press Play once. Confirm a real local demo is audible first, the managed
   visualizer/runtime and Player lease become active, then the station starts and
   the demo disappears from the queue without a lease drop. Expand **Audio test
   summary** and photograph the transition.
4. Confirm other vehicle audio stays stopped for at least 30 seconds. Minimize for
   30 seconds, then five minutes. Record takeover and playback results separately.
5. Navigate away and return, then repeat by closing/reopening the page. Repeat the
   same takeover and minimized checks. Back/Forward cache and a new document are
   different browser paths and should be reported separately.
6. Pause and refresh: radio must stay paused. Tap Play once and repeat the checks.
   If autoplay is blocked, record that separately and retry with Play.
7. After restoration passes with visuals off, tap Visuals once and repeat. If focus
   fails only now, report it as analysis-related rather than restoration failure.
8. Repeat with recording/alerts enabled; Player Stop must leave their silence active.
   Finally retest MP3 restoration and fresh radio selection.

For future runs, record Tesla software version, build identity and whether visuals
were enabled. Keep the physical result separate from automated browser results.
