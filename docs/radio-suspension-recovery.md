# Radio recovery after browser suspension

The retained-page failure reported in production is consistent with a stale live
HTTP connection: Play consumes buffered audio for a few seconds, then the stream
waits indefinitely. This is a leading hypothesis, not a confirmed trace from the
vehicle. A page can survive while its execution and network connections do not.

## Recovery policy

The runtime tracks a transient connection generation, reconnect reason, last
observed media progress, and retry count. None changes the saved session format,
station, queue identities, playback intent, or radio Visuals preference.

- Freeze/resume, foreground/BFCache return, network return, and the existing Play
  action share recovery coordination. Duplicate events and Play taps coalesce.
- A known freeze or network interruption invalidates the old transport. Play from
  paused/failed radio also aborts the retained media resource and loads the same
  canonical relay URL. No cache-busting query is added (the Worker rejects it).
- Ordinary foreground returns leave demonstrably advancing background audio alone.
  A visible, previously playing station has a 12-second progress deadline. Only
  advancing media time renews it. `playing`, repeated `waiting`, or a resolved
  `play()` promise cannot turn a drained buffer into a healthy connection.
- A one-shot deadline also handles missed lifecycle notifications. On an overdue
  callback, it samples current media time before deciding to reconnect. Hidden
  pages defer reconnect work until they return. No recovery polling was added.
- An initial attempt permits two retries, five seconds apart. Reloading a source
  does not reset that budget. Existing native radio is reused first; a closed
  graph or repeated loads without progress permits one Player radio-element
  replacement. Optional analysis wiring is invalidated and visuals can reattach.
- The accepted local-demo-to-native-radio activation sequence remains available.
  Demo source preparation is bounded at five seconds, graph resume at 1.5 seconds.
  Handoff completion requires progress from the current native station.
- Autoplay/context rejection stops automatic work. The existing Play control
  retries. Pause, Stop, another track, logout, and ownership loss cancel stale
  timers/completions. Only Player retention is released; recording and alerts keep
  their independent leases. Explicitly paused/stopped sessions never auto-start.

Browser playback and analyser success do not confirm Tesla audio ownership. The
browser cannot reconnect while the operating system prevents it from executing.

## Which workers stop?

Cloudflare Workers run remotely. The car sleeping does not suspend the deployed
service. A particular invocation/response may end when its client disconnects;
recovery must make another request. Cloudflare documents no fixed HTTP duration
limit while a client remains connected, but infrastructure can interrupt streams:
[Worker request lifetime](https://developers.cloudflare.com/workers/platform/limits/).

The relay's existing 12-second AbortController deadline is cleared once upstream
headers arrive. It is a connection timeout, not a stream lifetime. Audio responses
use `Cache-Control: no-store`; directory metadata caching does not reuse a previous
audio response. Worker contract tests cover both properties. This change requires
only frontend deployment; no Worker runtime or API change is included.

Browser dedicated workers may freeze with their owning execution context. Moving
recovery into a Web Worker cannot guarantee execution during vehicle suspension:
[Chromium pausing and freezing](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/execution_context/PausingAndFreezing.md).

## Desktop reproduction and automated coverage

The browser fixture in `test/helpers/streaming-radio.ts` serves actual continuous
PCM over chunked HTTP. It initially supplies four seconds of audio, then paces the
remaining bytes. Chromium startup can accumulate additional buffered audio, so
stale-stream assertions bound its remaining duration from the fixture's delivered
PCM (which can be ahead of published decoded ranges) before allowing the 12-second
progress deadline and five-second retry delay. Tests can leave existing
responses open without delivering more
bytes, or destroy them; subsequent GETs remain healthy. Unlike a finite mocked
response, this reproduces a half-open stream that may never emit a media error.

Run the recovery suite against a freshly started Vite server (avoid HMR creating
separate module instances for test imports):

```sh
pnpm exec playwright test test/e2e/player-recovery.spec.ts --project=desktop --workers=1
```

The browser test server disables Vite HMR, whose reconnect would otherwise reload
an actually frozen document. Freeze cases launch native Chromium through CDP
without Playwright's automatic focus/visibility overrides, require an observed
freeze callback, and activate another blank tab before returning to the same
Player document. The desktop project runs these transport cases once; viewport
layout coverage stays separate.

The host controls `Page.setWebLifecycleState` with `frozen`/`active`, so the test
runner can resume the page even while its JavaScript is suspended. Tests verify
new HTTP connections, unchanged document identity/station/queue, and over 30
seconds of actual recovered media progression. They also cover missing lifecycle
events, abrupt disconnection, offline/online, blocked autoplay with a trusted Play
click, and healthy hidden/visible playback. Analyser activity checks visual
reattachment while native audio continues.

For a manual Chrome test, play radio, use `chrome://discards` to freeze the retained
page, interrupt the connection, then resume without reloading. A half-open proxy
is more representative than simply closing a TCP connection. Minimization alone
does not guarantee freezing. See [Chrome lifecycle testing](https://developer.chrome.com/docs/web-platform/page-lifecycle-api#testing-your-app-in-the-frozen-and-discarded-states).

## Diagnostics and parked-vehicle acceptance

The bounded existing diagnostic log includes `radio-connection` entries with
trigger, outcome, station UUID, connection generation, reconnect reason, attempt,
media time, last progress timestamp, buffered ranges, and media error code. Native
HTMLMediaElement does not expose HTTP response status or relay-version headers;
use browser network inspection or existing Worker observability for those.

Vehicle validation remains pending. On the deployed frontend, retain the page
through departures of about one, five, and fifteen minutes. Record:

- Tesla software version and deployed frontend build;
- station, connection type/quality, and climate/Sentry awake conditions;
- automatic recovery, Play fallback, and at least 30 seconds of uninterrupted
  station audio after recovery;
- scope/spectrum recovery, competing-audio takeover, and minimized playback;
- recording and alert coexistence, with both disabled and enabled.

Export audio diagnostics and correlate production Worker disconnect/error metrics.
Report physical audio ownership separately from browser progress. Live radio
reconnects at the current broadcast; finite MP3 position recovery is unchanged.

## Local validation (2026-10-25)

- All 172 unit/architecture files passed (2,098 tests); a final focused run of
  radio/diagnostics tests passed 69 tests, including the added offline-open case.
- All 115 smoke tests passed, including the separately run GPS/background suite.
- All nine desktop Player recovery browser cases passed across the complete run
  and focused reruns. Every continuous-stream case requires at least 30 seconds
  of recovered media progress and analyser activity in the original document.
- All eight radio Worker contract tests passed. App and Worker typechecks, lint,
  and production build passed. Lint retains 72 existing warnings; the build retains
  the existing OpenCV/chunk-size notices.

These results verify browser recovery, not physical vehicle audio ownership.
Vehicle software version and deployed frontend build must be recorded during the
parked-Tesla acceptance run; no deployment or vehicle test was performed here.
