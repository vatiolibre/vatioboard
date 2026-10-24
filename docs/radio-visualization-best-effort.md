# Best-effort radio visualization

## Current behavior

Player saves radio Visuals on/off separately from the MP3 preference. The existing
scope/spectrum mode remains shared and persisted. Missing radio preferences default
to enabled; old radio toggle choices were not saved and cannot be migrated.
Transient failures, interruptions, and the temporary demo handoff never change the
saved radio preference. Milkdrop restoration is outside this improvement.

On reload, scope/spectrum waits for native radio playback and completion of the
accepted demo-to-station audio handoff. It also waits until Player and the document
are visible. A paused/stopped session stays paused/stopped. A minimized Player stays
minimized and performs no scope rendering until opened.

Each station/playback recovery or foreground-return cycle permits one automatic
attempt. Duplicate pageshow, visibility and resume events coalesce; continuing
visuals stay alone. Preparation has an eight-second deadline. Pause, Stop, track
changes, hiding/minimization, freeze, ownership loss and destruction invalidate
pending work. Late results cannot enable a renderer for a different session.

Failure leaves the Visuals button off with the existing unavailable tooltip and
preserves the saved preference. Tap Visuals once to retry with browser activation;
tap again during preparation to cancel and save off. There is no polling or new
recovery button. Optional visualization failures do not become playback errors.

## Audio and graph ownership

Chromium uses the existing shared media-element audio graph. New media sources are
bound only after their context runs and a current consumer still requests them.
A manual retry can resume pending preparation on that same context. Cancelling
scope must not destroy a graph still used by playback or Milkdrop.

Safari uses the existing independent decoded-PCM analysis transport. Consumers
share that station's analysis graph. Releasing one viewer does not dispose a graph
still owned by another viewer. Hiding or changing stations disposes transient PCM
analysis; reopening Player creates a renderer against the current graph.

Visualization restoration never restarts radio, repeats the demo, changes the
saved station/queue or acquires a background lease. Recording/alert retention and
Media Session arbitration remain independent. Releasing the last Chromium viewer
keeps the native audio graph connected because it remains the playback route.

A running graph or flat waveform is not evidence of Tesla audio ownership. Silence,
CORS restrictions, unsupported decoding and context suspension can still prevent
useful visuals. No waveform-based retry loop is introduced.

## Panel geometry

Compact Player height follows current content instead of a cached shell height.
Intrinsic header/body-content changes trigger coalesced refits without persisting
new derived window bounds. The panel stays within the current shell work area;
its body can scroll if it cannot fit. Control touch sizes and the Browse sidecar
remain available. Saved visibility and position are preserved where they fit.

## Diagnostics and validation

Existing diagnostics record `radio-visual-recovery` with trigger, station,
outcome/readiness and media progress. Runtime `radio-visualization` events distinguish
ready, unavailable, cancellation and timeout. The handoff-ready snapshot is
published after its pending flag clears. These observations do not certify audible
vehicle playback or competing-audio takeover.

Regression coverage includes saved preferences, mode selection, handoff gating,
context failures, deadlines, stale completions, lifecycle coalescing, shared graph
ownership, real Chromium analyser output and utility-button geometry/hit testing
at Tesla compact and expanded sizes. Earlier validation and physical acceptance
in [radio restoration](radio-session-restoration.md) describe the historical audio
baseline, not acceptance of automatic visuals.

Automated validation on 2026-10-24 passed 2,078 unit/architecture tests,
115 smoke tests (including 14 GPS/background tests), four Chromium audio/visual
recovery cases, four Tesla viewport containment cases, and two Player-only Browse
snapshot cases. Typecheck, lint and production build passed. Lint retains 72
existing warnings. The build retains its existing OpenCV externalization and
chunk-size notices. Focused tests were repeated after final lifecycle adjustments.

## Parked Tesla checks (pending)

Record vehicle software/browser version and deployed build ID. Use `?debugAudio=1`
and capture the Audio test summary separately from physical audio observations.

1. Restore a playing station with scope enabled, then spectrum. Confirm demo-to-radio
   ordering, animated visuals, unchanged station/queue, and competing-audio takeover.
2. Refresh and revisit at compact and expanded browser sizes. Confirm the utility
   row is fully available after visuals and metadata appear. Exercise Browse.
3. Turn Visuals off and refresh: it must stay off. Pause and refresh: neither audio
   nor analysis should start. Exercise the existing Visuals retry after a failure.
4. Minimize for 30 seconds and five minutes. Confirm audible radio continues and
   scope resumes once on return. Exercise Back/Forward cache separately from reload.
5. Repeat with recording/alerts enabled. Verify their retention survives visual
   failure and Player Stop. Open/close Milkdrop manually to check shared ownership.
6. Recheck MP3 demo restoration. Report audio ownership, audio continuity, visual
   animation and panel geometry as separate results.
