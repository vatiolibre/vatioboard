# Tesla audio stable-reference runbook

> Refresh/revisit radio recovery is covered by [user-reported Tesla-browser
> physical acceptance](radio-session-restoration.md#physical-acceptance) dated
> 2026-09-26. The station restores after refresh/revisit, follows the local-demo
> activation path on Play, acquires Tesla audio ownership and continues when
> minimized.

> A subsequent [best-effort radio visualization enhancement](radio-visualization-best-effort.md)
> adds optional analysis through a separate inaudible relay stream. Its vehicle
> acceptance is pending; the stable reference recorded below is preserved.

## Status: stable, vehicle-accepted reference

On **2026-09-18**, the user reported **Pass** for all three vehicle test groups
below and confirmed that this codebase works as expected. This implementation is
now the **stable audio reference** for VatioBoard.

Repository reference at acceptance: `019b918c4a1df6c3c338f33db9258a8c9ba32c58`.
This identifies the current implementation in the repository; the deployed build
identifier was not separately supplied in the vehicle report. Vehicle software
previously reported for this test sequence: **2026.26.6.1**.

| Vehicle test group                                                    | User-reported result |
| --------------------------------------------------------------------- | -------------------- |
| 1. Recording and alerts, including minimized GPS/recording behavior   | **Pass**             |
| 2. Native radio                                                       | **Pass**             |
| 3. Combined recording, alerts and playback, including handoffs        | **Pass**             |
| 4. Restored radio after refresh/revisit, including minimized playback | **Pass**             |

These are user-reported physical acceptance results for the four test groups,
not new automated measurements or per-step diagnostic records. Use the tests
below as the regression checklist for future audio changes. Preserve the
[reference architecture](tesla-browser-audio-implementation.md#reference-contract-for-future-changes).

## Reference architecture: restored main plus isolated native radio

The recording, alert, GPS and MP3 audio behavior has been restored from local
`main` / `origin/main` at `715223334fa72765b496ab694156a843ef5e7538`.
The native-radio extension uses a separate connected audio element with hidden
controls. It does not acquire or suppress the shared silent channel. Recording
and alert owners use main's original leases and Media Session behavior.

This replaces the experimental delegated/required-silence approaches. There is
no `retentionTest` mode selector or optional harness GPS consumer. Old
`retentionTest` and `audioCompatibility` query parameters have no effect.

## Historical evidence and acceptance

- Vehicle software reported: **2026.26.6.1**; browser version unavailable.
- Original main: user reports stable recording/alert ownership and GPS while minimized.
- Original POC, isolated POC, and steady native radio: user reports successful
  takeover and minimized playback, including the hidden-controls variant.
- Experimental standalone recording and silent-only harness: failed takeover
  and/or minimized GPS recording in the user's tests. The later narrow session
  declaration change also failed; restoring that declaration alone was insufficient.
- The earlier experimental combined radio-plus-silence mode was **not tested**.
  That historical result is distinct from the restored-main integration test.
- The restored-main implementation is now **vehicle accepted**: the user reported
  Pass for recording/alerts, native radio, and combined operation as recorded above.
- On **2026-09-26**, the user separately reported **Pass** for restored radio after
  refresh and revisit in the Tesla browser: saved station metadata returned, Play
  completed the local-demo activation path, Tesla audio ownership was acquired,
  competing Tesla audio was interrupted and playback continued while minimized.
  Tesla software/browser versions, deployed build hash and per-step diagnostics
  were not supplied.

## Reference and regression-test URLs

| Purpose                                   | URL                                                    |
| ----------------------------------------- | ------------------------------------------------------ |
| Actual recording, alerts, MP3 and radio   | https://dev.vatioboard.com/?debugAudio=1               |
| Radio/MP3 comparison harness              | https://dev.vatioboard.com/tesla-background-audio.html |
| Unchanged isolated native-radio reference | https://dev.vatioboard.com/tesla-radio-poc.html        |
| Original reference                        | https://dev.vatiolibre.com/radio.html                  |

Use a fresh document for each independent test. Record the build shown in
**Audio test summary**, vehicle version, and results. Photographs are sufficient;
copy/export is optional and Tesla browser download support is not required.

## Test 1 — original recording and alerts behavior

Use the **main application**, not the comparison harness.

1. While parked, stop the Player and turn alerts off. Start another Tesla audio app.
2. Start recording through Speed/HUD as on original main. Note the normal start cue,
   whether competing Tesla audio stops, and whether the silent channel plays.
3. Minimize for 30 seconds, then repeat for five minutes. After restoring, check
   recording sample timestamps and continuity. A fresh fix after restoration does
   not prove fixes were received while minimized. For route geometry, have a
   passenger inspect results after a normal drive; do not operate test controls
   while driving.
4. Stop recording. Repeat with alerts armed and recording off. Check audio takeover
   and the feature's GPS status after each minimized interval.
5. Enable both recording and alerts, then stop each separately. Silence must remain
   while the other owner needs it, and stop after the final owner releases it.

Expected: main's detached silent element is normal (`attached: false`). When armed,
`silent paused: false` and advancing media time indicate media playback. Main's
original service metadata and transport handlers are restored. These observations
alone do not establish GPS continuity or car audio focus.

## Test 2 — preserve working native radio

1. Open the main app fresh with recording and alerts off. Start competing Tesla audio.
2. Play the same radio station that passed the reference test.
3. Check takeover, 30 seconds minimized and five minutes minimized.
4. Change stations repeatedly. Check Pause/Play and Stop.
5. In the harness, tap **VatioBoard native radio** using the prefilled station.
   Repeat the checks. Expected: primary connected, controls hidden, no Player
   silent lease, and keep-alive paused when no feature owns it.
6. If this fails, repeat **POC direct radio** or the isolated reference in a fresh
   document and record the difference.

Radio-only uses native browser presentation, not custom Player Media Session
metadata or Next/Previous handlers. In-app controls remain available.

## Test 3 — integration, after tests 1 and 2

1. In the main app, start recording and arm alerts; verify their baseline behavior.
2. Start radio, switch stations, play an MP3, then return to radio.
3. Check that the shared silence continues while recording/alerts own it. Stop the
   Player: recording/alerts must continue. Stop one feature, then the final feature.
4. Repeat takeover and minimized checks. Verify GPS timestamps separately from audio.
5. Test actual MP3 Pause/Resume and route navigation. MP3 uses original main policy:
   Pause releases its Player lease; other feature leases remain independent.

The harness's **START TESLA BACKGROUND TEST** generates audible PCM tones through
main's finite-track path. It is not a recording test or an actual MP3 fixture.
**STOP TEST**, **Stop everything**, and unmount stop only harness-owned playback.
The comparison page retains direct, relay-native and relay-Web-Audio reference buttons.

## Test 4 — restored radio after refresh or revisit

1. Start a known-good radio station in VatioBoard and verify it is playing.
2. Refresh the page and confirm the saved station metadata returns without
   immediately starting the native station.
3. Press Play once. Confirm the real local demo activates the managed playback
   runtime first, then the restored station starts and the Player lease remains
   active across the handoff.
4. Confirm competing Tesla audio is interrupted/muted and playback continues
   after minimizing the Tesla browser.
5. Repeat after navigating away and revisiting VatioBoard. Record this as
   user-observed physical evidence, separately from automated Chromium tests.

## Recording results

For each test record: build, vehicle version, startup cue, takeover Pass/Fail,
30-second and five-minute playback Pass/Fail, recording/GPS continuity, and the
last owner stopped. Expand **Audio test summary**, enter the vehicle version and
manual outcomes, and photograph it. Diagnostic state and manually observed
outcomes are deliberately separate. The passive diagnostic heartbeat does not
restart audio or GPS.

Audio continuity, timer execution and GPS callbacks are different outcomes.
Minimized pages may remain active; frozen pages suspend tasks; discarded or
destroyed pages lose the running document. Silent media is not a guarantee
against those platform states. No automated check establishes Tesla audio focus
or uninterrupted GPS. The physical acceptance above establishes this implementation as the stable
reference for the reported vehicle tests; it does not guarantee execution after
freezing, discarding or document destruction, or on every future browser version.

Automated validation for this revision: 2,131 unit/architecture/smoke/GPS tests
and three Chromium tests passed; typecheck, lint and production build passed.
See [the implementation report](tesla-browser-audio-implementation.md) for exact
commands, warnings and the changed-file inventory. Automated results and the
user-reported vehicle acceptance above are separate evidence.
