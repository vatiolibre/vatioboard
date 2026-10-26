# Automatic playback recovery

> Retained-page suspension and stale live-stream recovery are documented in
> [radio suspension recovery](radio-suspension-recovery.md). Vehicle validation is pending.

The Player restores its saved session before catalog loading completes and makes
one best-effort playback attempt when its saved intent is playing. Paused and
stopped sessions stay paused/stopped. The existing Play button retries blocked
audio; its status message asks the user to tap Play. Unrelated taps do not resume
playback.

A first visit with no saved session attempts the public demo playlist, including
when backend authentication is slow. Saved unavailable tracks remain selected.
Public recovery does not wait for authentication; private source access still
waits for the existing auth/cache-namespace checks. Catalog refresh never replaces
a restored listening queue. Production SPA playback waits for single-tab ownership
and an enabled Player.

## Session and lifecycle

The v4 snapshot records `playbackIntent` (`playing`, `paused`, `stopped`), queue
entry identity/order, played history, position, volume/mute, repeat/shuffle,
background mode, and library continuation including shuffle history. Readers
migrate v1–v3; v3/v2 compatibility mirrors remain. Blobs and temporary/signed
playback URLs are excluded. Explicit Pause/Stop/logout cancel pending work;
a browser interruption or autoplay rejection preserves playing intent.

Progress is saved during playback and flushed on hidden/pagehide/freeze. Recovery
reconciles foreground, persisted pageshow, and resume events, coalescing duplicate
notifications and leaving continuing playback alone. Suspended Web Audio contexts
get a bounded resume attempt. There is no recovery polling loop. Abrupt process
termination can lose progress after the last checkpoint. Radio returns to the
same live station, not the historical broadcast position.

Radio retains the previously vehicle-tested local-demo activation, actual decoded
audio advancement, and handoff to the native station. Temporary demo entries are
excluded from durable snapshots and removed on success, failure, or cancellation.
Recovery releases only Player retention; recording/alert leases remain independent.
A retry uses the same demo handoff when the recovery source is available.

Player is added to toolbar favorites once for new and existing installations.
Removing it afterward is persistent. The migration preserves disabled apps and
existing permissions.

## Diagnostics and validation

Runtime snapshots expose `playbackIntent` and `restorationStatus` (`idle`,
`restoring`, `blocked`, `failed`, `restored`). Existing debug audio diagnostics
record attempts/outcomes and display intent/status. Playing/progress observations
are not confirmation of vehicle audio ownership.

Automated coverage includes migration, continuation, early hydration, first visits,
blocked media/AudioContext, cancelled handoffs, lifecycle returns, toolbar defaults,
and real Chromium runs with permissive and gesture-required autoplay policies.
The blocked browser branch injects `NotAllowedError` until the existing Play
button is clicked, since debugging/engagement can grant autoplay despite launch
policy. Successful retries use actual decoded browser audio.

The user reports successful MP3 demo and internet-radio audio recovery in Tesla.
A recorded vehicle software/build matrix and automatic visual recovery acceptance
remain pending. The earlier manual-Play acceptance in
[radio-session-restoration.md](radio-session-restoration.md) remains a historical baseline.

Radio scope/spectrum now restores its independently saved Visuals preference after
native playback and demo-handoff completion, with one bounded attempt while Player
is visible. The saved mode is preserved. Failure leaves audio alone and the existing
Visuals button ready to retry. Panel height follows restored content and supports
internal scrolling within the shell work area. See
[best-effort radio visuals](radio-visualization-best-effort.md) for lifecycle,
ownership, diagnostics, and the pending vehicle checklist.

### Parked Tesla checklist

Record Tesla software/browser version and deployed build ID. Use `?debugAudio=1`
and capture the existing Audio test summary for each result.

1. Clear the saved session in a test profile, open the page, and check first-visit
   demo autoplay. If blocked, press the existing Play button once.
2. With competing Tesla audio playing, restore a playing radio station. Confirm
   the brief demo precedes the station and competing audio stops. Record autoplay
   permission and actual vehicle takeover as separate results.
3. Repeat by refresh, navigating away/back, closing/reopening the browser, and
   minimizing/returning. Check continued playback after 30 seconds and five minutes.
4. Pause and refresh; then Stop and refresh. Neither should start audio. Repeat
   with a finite track, checking queue, position, volume/mute, repeat and shuffle.
5. Interrupt the demo handoff with Pause, Stop, another selection, and refresh.
   Confirm the temporary demo never replaces the saved station or queue.
6. Repeat with recording/alerts on. Player failures and Stop must preserve their
   leases. Test radio visuals separately after playback recovery succeeds.
7. Confirm Player appears as a toolbar favorite; remove it and reload to confirm
   it stays removed. Check saved window visibility/layout during these cases.

A website cannot reopen its own URL after Tesla closes it, and cannot override
Chromium's audible-autoplay policy. Recovery starts once the page is opened.
