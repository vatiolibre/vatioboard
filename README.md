# VatioBoard

VatioBoard is an `index.html` Vite SPA of touch-first browser tools built for Tesla-sized screens and regular mobile/desktop browsers. Product navigation uses hash routes such as `#/speed`, `#/board`, `#/library`, `#/replay`, and `#/accel`; the root standalone HTML files are legacy dev/test harnesses only. The repo is mostly local-first: drawings, calculator state, trip estimates, replay sessions, and acceleration runs are stored in the browser, while some account-aware actions are optionally wired to the VatioLibre backend. Recent location-aware features also reuse a shared Nominatim client for lightweight reverse geocoding and first-run regional unit defaults.

The project is part of the VatioLibre community and is published for educational use.

- Production site: https://www.vatioboard.com
- Repository: https://github.com/vatiolibre/vatioboard
- Community: https://vatiolibre.com
- Creator: Oscar Perez

## Pages

### Board

`index.html` boots the SPA. Board is available at `#/board` through [`src/app/views/BoardView.js`](src/app/views/BoardView.js) and [`src/board/board.js`](src/board/board.js).

What it does:

- full-screen drawing canvas with pen and eraser tools
- brush size control, preset swatches, and an `iro` color picker
- undo, redo, clear, and PNG export
- local autosave of drawing history
- embedded calculator widget and EV trip cost widget
- shared English/Spanish toggle
- optional VatioLibre account auth and save-to-backend flow for eligible accounts

### Calculator Demo

`calculator.html` is a legacy standalone test/dev harness for [`src/calculator/calculator-demo.js`](src/calculator/calculator-demo.js). Production uses the calculator through SPA-owned floating tools.

What it does:

- opens the same calculator widget used by the board
- evaluates expressions with `mathjs`
- stores history, expression state, and formatting settings locally
- supports decimal precision and thousands separator settings

### Vatio Speed

Production Speed runs at `#/speed` through [`src/app/views/SpeedView.js`](src/app/views/SpeedView.js) and [`src/speed/speed.js`](src/speed/speed.js). `speed.html` is a legacy standalone test/dev harness.

What it does:

- reads live browser geolocation data
- renders an analog speedometer plus trip stats
- supports `km/h` or `mph`, and metric or imperial distance units
- can auto-configure shared speed and distance units from the detected country on first use
- offers manual overspeed alerts and nearby speed-trap alerts
- loads speed-camera data by country/tile from generated OpenStreetMap-style artifacts and caches it in IndexedDB for offline use after the first successful load
- supports quick audio mute and optional background-audio mode
- switches between gauge and Waze-style primary views
- records replay sessions for the replay page
- enriches saved replay sessions with approximate start/end place labels when available

### Drive Replay

Production Replay runs at `#/replay` through [`src/app/views/ReplayView.js`](src/app/views/ReplayView.js) and [`src/replay/replay.js`](src/replay/replay.js). `replay.html` is a legacy standalone test/dev harness.

What it does:

- loads the active and saved replay sessions recorded by Vatio Speed
- replays a route on a MapLibre globe/map
- shows speed, altitude, and heading charts
- supports time-based or distance-based playback
- offers playback-rate controls and session selection
- shows route labels derived from saved start/end place metadata
- lets users remove saved recordings locally

### Vatio GPS Rate Lab

`gps-rate.html` is a legacy standalone test/dev harness for the diagnostics page in [`src/gps-rate/gps-rate.js`](src/gps-rate/gps-rate.js). It is not a production SPA route.

What it does:

- measures observed `navigator.geolocation.watchPosition()` callback timing
- shows summary stats, live values, warnings, and an event log
- exports captured samples and summaries to JSON or CSV
- stores notes, wake-lock preference, and the latest saved summary locally
- reverse-geocodes saved summaries to a human-readable place label when available
- can auto-configure shared units from the first detected country during place resolution
- includes a rate-limited Nominatim test panel with cached response reuse and public-server policy guards

### Vatio Accel

Production Accel runs at `#/accel` through [`src/app/views/AccelView.js`](src/app/views/AccelView.js) and [`src/accel/accel.js`](src/accel/accel.js). `accel.html` is a legacy standalone test/dev harness.

What it does:

- times standing-start, rolling-start, distance, and custom speed-range runs
- uses browser geolocation updates only
- stores run history and settings locally
- saves approximate start/end place labels with completed runs when available
- keeps unit choices aligned with the shared regional unit bootstrap used by other pages
- shows quality grades, warning badges, and diagnostic stats
- includes result graphs plus replay map/chart views for completed runs

### Backend Login Test

`login.html` is a legacy standalone test/dev harness for backend auth checks.

What it does:

- logs into the configured Frappe backend with browser cookies
- checks the current session
- logs out again
- helps debug local CORS/session issues separately from the main UI

## Shared Widgets

### Calculator Widget

The calculator module under [`src/calculator/`](src/calculator/) is used by both the board and the standalone calculator demo.

### EV Trip Cost Widget

The energy widget under [`src/energy/`](src/energy/) is mounted from the board.

What it does:

- supports simple mode for one-trip estimates
- supports multi-trip mode with locally persisted trip data
- defaults to `km` or `mi` from the shared regional unit bootstrap
- handles `km` and `mi` ranges and formatting
- reuses calculator number-format settings where appropriate

## Stack

- Vite 7 SPA build with `index.html` as the production HTML entry
- Vanilla JavaScript ES modules
- LESS for styling
- `mathjs` for calculator evaluation
- `@jaames/iro` for the board color picker
- `maplibre-gl` for speed and replay maps
- `chart.js` for replay and acceleration charts
- `@stanko/dual-range-input` for replay and acceleration range controls
- `kdbush` and `geokdbush` for speed-trap lookup
- shared Nominatim helpers for reverse geocoding, cached lookup reuse, and regional unit bootstrapping
- Vitest + jsdom for unit and smoke tests
- ESLint + Prettier for code quality

## Speed Camera Data

Vatio Speed uses generated runtime artifacts in `public/geo/cameras`:

- `manifest.json` lists available countries, counts, hashes, bounding boxes, and country or tile artifact URLs.
- `countries/<code>.json` stores compact traps as `[lon, lat, speedKphOrNull, osmId?, speedMeta?]`.
- `countries/<code>.kdbush` stores the matching KDBush index.
- Large countries can be split into `countries/<code>/manifest.json` plus `tiles/<tile-id>.json` and `tiles/<tile-id>.kdbush`.

`speedMeta` is optional compact provenance for inferred limits and approach matching. Explicit camera maxspeed tags stay highest-confidence. Missing camera maxspeed can be enriched at fetch/build time from nearby OSM road ways with `maxspeed`, `maxspeed:forward`, or `maxspeed:backward`; unknown remains `null`, never `0`.

Approach metadata is stored inside `speedMeta.approach` when the build pipeline can match a camera to a nearby road segment. Each compact approach entry can include a forward bearing, reverse bearing, allowed direction, road distance, confidence, and a clipped two-point segment. Old artifacts without `approach` continue to load and alert through the fallback policy.

`npm run prepare:geo` is offline-safe. It builds from `data-src/osm_speed_cameras_overpass.json` and the optional `data-src/osm_speed_cameras_maxspeed_enrichment.json` sidecar when they exist, otherwise it uses the checked-in Colombia ANSV seed so dev/build never depend on live Overpass. Browser runtime does not query Overpass or parse road geometry while driving.

`npm run fetch:cameras` is the network/update command. By default it reuses the cached global camera source if `data-src/osm_speed_cameras_overpass.json` already exists, resumes cached road-speed tiles from `data-src/osm-road-speeds/`, fetches only missing road-speed tiles, writes `data-src/osm_speed_cameras_maxspeed_enrichment.json`, and rebuilds `public/geo/cameras`. Set `CAMERA_REFRESH_CACHE=1` only when you intentionally want to refresh the global camera Overpass source.

The global camera query is:

```txt
[out:json][timeout:1000];
node["highway"="speed_camera"];
out body;
```

For a first road-enrichment pass from a partly empty road cache, use a slow, restartable run that is gentle to public Overpass:

```bash
mkdir -p logs
CAMERA_ROAD_FETCH_MISSING=1 \
OVERPASS_MAX_RETRIES=8 \
OVERPASS_RETRY_INITIAL_DELAY_MS=10000 \
OVERPASS_RETRY_MAX_DELAY_MS=180000 \
CAMERA_ROAD_REQUEST_DELAY_MS=8000 \
CAMERA_ROAD_PROGRESS_EVERY=25 \
CAMERA_ROAD_SLOW_TILE_MS=5000 \
OVERPASS_PROGRESS_INTERVAL_MS=30000 \
npm run fetch:cameras 2>&1 | tee "logs/fetch-cameras-first-pass-$(date +%Y%m%d-%H%M%S).log"
```

After the first pass, most local work should avoid Overpass entirely:

```bash
CAMERA_ROAD_FETCH_MISSING=0 npm run fetch:cameras
npm run prepare:geo
npm run analyze:cameras:maxspeed
```

Only use `CAMERA_ROAD_REFRESH_CACHE=1` when you deliberately want to re-download every road-speed tile. That is much heavier than a normal camera refresh and should not be part of routine local development.

At runtime, Speed does not upload live location to fetch camera alerts. GPS matching happens locally: the app-level GPS service keeps one shared browser `watchPosition()` for active consumers, normalizes speed/heading/timestamps, and broadcasts local `vatioboard:gps-position` updates for Speed, Camera Map, recording, driving alerts, and other shells. Camera matching loads the manifest, chooses the current country or nearby tile from the GPS fix, tries IndexedDB first, and revalidates in the background. If the network drops during an update, the last good cached country/tile stays intact. With no cache and no network, the speedometer still works and trap alerts show an unavailable/offline camera database status.

Camera alerts are approach-aware instead of purely circular. The runtime still uses the point KDBush/geokdbush index for bounded candidate lookup, then evaluates several nearby cameras by exact distance, GPS or movement heading, whether the vehicle is moving toward the camera, whether distance is decreasing, and any build-time road approach metadata. Build-time enrichment stores a bounded set of plausible approach corridors for cameras near intersections, divided roads, ramps, frontage roads, and other multi-road geometry. Each corridor is a clipped local road segment with bearing, reverse bearing, direction, road distance, OSM way id, role (`primary`, `intersection`, `secondary`, or `ambiguous`), confidence, and compact ambiguity metadata when needed.

High- and medium-confidence corridors can require the vehicle heading to match an allowed approach bearing and, when segment geometry is present, to be plausibly near that short road corridor. Runtime accepts a camera when any valid corridor matches and reports the matched approach index, way id, role, confidence, direction, and reason through `cameraApproachDetails`. Low, missing, or ambiguous metadata degrades conservatively: heading-only matching is used when available, and legacy radius fallback remains available when heading is unavailable so old cached artifacts do not silently miss cameras.

Speed inference remains separate and conservative. When multiple plausible road corridors disagree on speed, VatioBoard stores the corridors for approach matching but avoids inferring a camera speed from the conflicting roads. Equal-speed intersection corridors can still produce one speed value while retaining multiple approach corridors. NYC, ANSV, and other local/official camera records can carry OSM-derived approach corridors when they merge with OSM or enrichment records; local-only records without OSM geometry continue to work without approach metadata. Local source direction hints are not treated as full road geometry unless a future source-specific converter adds compact segments.

Known limitations are intentionally conservative: curved roads may be represented by one short bearing, urban intersections can remain ambiguous, frontage roads can be lower confidence unless clearly closest, and poor GPS heading can fall back to radius matching rather than suppressing every alert.

Approach matching behavior can be tuned for development without a rebuild through localStorage:

- `vatio_speed_camera_approach_fallback_mode`: `legacy-radius` (default), `heading-only`, or `silent`.
- `vatio_speed_camera_approach_heading_tolerance_deg`: accepted approach angle, default `45`.
- `vatio_speed_camera_approach_minimum_speed_ms`: low-speed suppression threshold, default `1.5`.

Useful local camera-data commands:

```bash
npm run fetch:cameras
npm run prepare:geo
npm run analyze:cameras:maxspeed
npm run test:unit
npm run test:smoke
npm run lint
npm run build
```

### Camera Map

The Camera Map points come from the same local/static camera artifacts described above. The browser does not call Overpass or any camera API from the map panel.

The panel is designed as an in-car navigation display: the map takes nearly the whole window, controls are compact touch targets, and the live position is shown as a bright green vehicle puck. Native MapLibre zoom controls stay in the top-right, while Camera Map follow/orientation/layer controls are compact and offset so they remain usable on touch screens and fullscreen displays.

Heading comes from browser GPS `coords.heading` when available and is exposed through the app GPS service as `headingDeg`; when GPS heading is missing, Camera Map can derive a bearing from meaningful recent movement. Follow mode keeps the vehicle visible and can frame a nearby relevant camera from the currently loaded camera features. The orientation control cycles between north-up and heading-up; heading-up falls back gracefully to north-up behavior when heading is unavailable or stale. Camera-aware framing uses only loaded local/static artifacts and does not fetch live camera APIs.

Camera Map includes an Approach overlay in the normal layer menu. Enable **Approach** to show matched camera road segments, allowed detection directions, confidence styling, and a compact legend. Solid approach roads indicate higher-confidence matches; softer/dashed lines indicate low-confidence or ambiguous matches; direction rays show which traffic direction is believed to trigger the camera. Multiple corridors can be shown for one camera, such as a primary road plus an intersection candidate. The overlay reads only generated camera artifacts and cached map state, so it does not make live Overpass, Nominatim, or road-network requests while driving.

Tapping a camera opens a Camera approach section that summarizes confidence, direction, matched-road distance, bearing, source context, and the current match decision when live position is available. The details list each corridor, including its role, allowed direction, bearing pair, confidence, road match distance, and way id. The popup explains outcomes such as “Would alert now,” “Near but not approaching,” “Heading unavailable,” or “Using fallback,” and includes a **Copy camera review info** action with a local JSON payload for filing data fixes. Cameras with missing, low-confidence, or ambiguous approach data remain visible so bad road matching, wrong direction metadata, and old cached artifacts can be reviewed instead of hidden.

Drive recording remains local-first. Recording uses the shared GPS stream and persists active replay data locally as it goes, so route changes do not require a second GPS watch and network/cloud-sync failures do not stop local capture.

Overspeed and camera proximity audio alerts are also app-level. Once the browser audio path has been primed from a user gesture, the driving alert service keeps evaluating the shared GPS stream and cached/static camera artifacts even if the user switches to Library, Board, Accel, Replay, or Camera Map. Unknown camera speed limits stay unknown rather than becoming a zero-speed alert, and low-confidence road-speed enrichment follows the same alert rules used by Speed.

Offline behavior is local-first. If a camera refresh fails, the map keeps the last successful camera GeoJSON in memory and reports cached/offline status rather than clearing the markers. Basemap tile failures can make the visual map incomplete, but they do not remove the local camera layers or the user-position puck.

Basemap imagery and map tiles are loaded from third-party tile services and must keep visible attribution in the map. Included layers:

- CARTO Voyager, Light, and Dark: `© OpenStreetMap contributors © CARTO`
- OSM Standard: `© OpenStreetMap contributors`
- OpenTopoMap: `© OpenStreetMap contributors, SRTM | style © OpenTopoMap`
- Esri World Imagery: `Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community`

Public tile services have fair-use and attribution policies. OSM Standard should follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/), CARTO layers should follow [CARTO attribution](https://carto.com/attribution), OpenTopoMap should follow its [usage notes](https://opentopomap.org/about), and Esri imagery attribution should stay visible. Production or high-volume deployments should use an approved commercial/dedicated tile provider or self-hosted tiles.

Follow-up tickets:

- Add a daily GitHub Actions workflow that runs `npm run fetch:cameras`, opens a data refresh PR, and reports artifact counts.
- Add a Help link explaining that missing cameras can be added to OpenStreetMap and will appear after the next artifact refresh.
- Preserve optional source/debug tags in a separate diagnostics artifact without expanding the runtime payload.
- Add an optional voice announcement patterned after `src/speed/audio.js`: “speed camera ahead, limit X” in the selected speed unit, while preserving browser audio gesture requirements.
- Region-first preload: after a stable country is known and the device is idle on a good network, prefetch small neighboring countries.

## Project Layout

```txt
.
├─ index.html
├─ calculator.html            # Legacy standalone test/dev harness
├─ speed.html                 # Legacy standalone test/dev harness
├─ replay.html                # Legacy standalone test/dev harness
├─ gps-rate.html              # Legacy standalone test/dev harness
├─ accel.html                 # Legacy standalone test/dev harness
├─ login.html                 # Legacy standalone test/dev harness
├─ data-src/                 # Source/reference datasets
├─ public/
│  ├─ audio/                 # Alert and finish sounds
│  ├─ geo/                   # Generated speed-camera manifests, payloads, and KDBush indexes
│  └─ img/                   # Logos and social images
├─ scripts/
│  ├─ build-worldwide-cameras.mjs
│  ├─ fetch-worldwide-cameras.mjs
│  └─ build-speed-traps.mjs   # Compatibility wrapper
├─ src/
│  ├─ accel/
│  ├─ board/
│  ├─ calculator/
│  ├─ dock/
│  ├─ energy/
│  ├─ gps-rate/
│  ├─ replay/
│  ├─ shared/
│  ├─ speed/
│  ├─ styles/
│  ├─ i18n.js
│  └─ icons.js
├─ test/
│  ├─ helpers/
│  ├─ setup/
│  ├─ smoke/
│  └─ unit/
├─ vite.config.js
└─ vitest.config.js
```

## Getting Started

### Requirements

- Node.js `>=24`
- npm

### Install

```bash
npm install
```

### Start The Dev Server

```bash
npm run dev
```

Vite is configured with `strictPort: true`, so local development runs at:

- `http://localhost:5174/`

Production SPA routes during development:

- `http://localhost:5174/`
- `http://localhost:5174/#/speed`
- `http://localhost:5174/#/board`
- `http://localhost:5174/#/library`
- `http://localhost:5174/#/replay`
- `http://localhost:5174/#/accel`

Legacy standalone test/dev harnesses remain available at:

- `http://localhost:5174/calculator.html`
- `http://localhost:5174/speed.html`
- `http://localhost:5174/replay.html`
- `http://localhost:5174/gps-rate.html`
- `http://localhost:5174/accel.html`
- `http://localhost:5174/login.html`

## Scripts

- `npm run prepare:geo`: builds the speed-camera artifacts consumed by Vatio Speed from local data
- `npm run fetch:cameras`: resumes/fetches local Overpass camera and road-speed data, writes maxspeed enrichment, and rebuilds speed-camera artifacts
- `npm run analyze:cameras:maxspeed`: prints explicit/inferred/unknown speed coverage from the generated camera manifest
- `npm run dev`: runs Vite locally after the `predev` geo preparation step
- `npm run build`: creates a production build after the `prebuild` geo preparation step
- `npm run preview`: serves the built app locally
- `npm run lint`: runs ESLint
- `npm run lint:fix`: runs ESLint with autofix
- `npm run format`: formats the repo with Prettier
- `npm run format:check`: checks formatting without writing changes
- `npm test`: runs the full Vitest suite
- `npm run test:watch`: runs Vitest in watch mode
- `npm run test:unit`: runs unit tests under `test/unit`
- `npm run test:smoke`: runs smoke tests under `test/smoke`

## Generated Data

`npm run prepare:geo` reads `data-src/osm_speed_cameras_overpass.json` when present, applies `data-src/osm_speed_cameras_maxspeed_enrichment.json` when present, otherwise falls back to [`data-src/ansv_cameras_maplibre.geojson`](data-src/ansv_cameras_maplibre.geojson), and generates:

- `public/geo/cameras/manifest.json`
- `public/geo/cameras/countries/<country-code>.json`
- `public/geo/cameras/countries/<country-code>.kdbush`
- optional `public/geo/cameras/countries/<country-code>/tiles/*` files for large countries

Source/cache files have different repository roles:

- Commit `data-src/osm_speed_cameras_overpass.json`; it is the compact raw camera source used by offline builds.
- Commit `data-src/osm_speed_cameras_maxspeed_enrichment.json`; it is the compact inferred-speed sidecar used by offline builds and GitHub Pages.
- Do not commit `data-src/osm-road-speeds/`; it is a large restartable Overpass road tile cache used only by `npm run fetch:cameras`.
- Do not commit `logs/`; fetch logs are local diagnostics.
- Do not commit `public/geo/cameras/`; `predev`, `prebuild`, and the GitHub Pages workflow regenerate it.

The GitHub Pages workflow runs `npm run build`, and `prebuild` runs `npm run prepare:geo`. That means Pages deployment needs the checked-in source JSON files under `data-src`, not the 5 GB road cache or the generated `public/geo/cameras` directory.

`public/geo/` may be missing in a fresh checkout until you run `npm run prepare:geo`, `npm run dev`, or `npm run build`.

## Persistence Model

The app uses a mix of IndexedDB, `localStorage`, and `sessionStorage`.

- board drawings are stored in IndexedDB when available, with `localStorage` fallback/migration helpers
- speed replay sessions are stored in IndexedDB when available, with `localStorage` fallback/migration helpers
- accel settings and runs are stored in IndexedDB when available, with `localStorage` fallback/migration helpers
- calculator state/history/settings, energy widget state, GPS Rate Lab notes/settings, shared unit preferences, and UI preferences use `localStorage`
- replay sessions, accel runs, and GPS Rate saved summaries can include normalized place metadata
- shared Nominatim scheduling state uses `localStorage`, and response caching uses `sessionStorage`
- replay depends on sessions recorded by the speed page

## Backend Integration

Shared backend auth lives in [`src/shared/backend-auth.js`](src/shared/backend-auth.js).

Behavior:

- production hosts use `https://api.vatioboard.com`
- non-production hosts use `https://api.dev.vatioboard.com`
- board, speed, replay, and accel SPA routes mount shared auth controls where needed; GPS Rate Lab keeps its auth coverage in the standalone dev/test harness
- saving a board document to the backend depends on authenticated feature access and the `cloud_sync` capability
- uploading media assets depends on the `media_assets` capability
- the shared auth widget uses email/password login by default and does not expose first-time SSO as a normal login choice
- `login.html` is a standalone dev/test harness for backend session and CORS troubleshooting

### Cross-Domain SSO

VatioBoard only initiates SSO with a top-level redirect to Frappe. It does not
store OAuth client secrets, authorization codes, access tokens, or refresh
tokens in the static app.

The shared auth widget intentionally hides "Continue with VatioLibre" by
default. The authenticated "Open VatioLibre" and "Open VatioBoard" actions are
also hidden by default because they duplicate normal app navigation. The SSO
helpers remain available for contextual product links such as subscription
management, including `getSsoSubscribeUrl()` and `startSubscriptionSso()`.

Local debug builds can opt those controls back into the DOM without rewriting
the widget:

```js
initBackendAuthControllers({
  ssoUi: {
    showGuestSsoLogin: true,
    showAuthenticatedCrossOpenActions: true,
  },
});
```

API host mapping:

- production frontend hosts use `https://api.vatioboard.com`
- non-production frontend hosts use `https://api.dev.vatioboard.com`

Expected SSO start shape:

```txt
https://api.dev.vatioboard.com/api/method/vatiolibre.vatiolibre.sso.start?target=libre&redirect_to=https%3A%2F%2Fdev.vatiolibre.com%2Ffleet
```

`target=board` preserves the current VatioBoard hash route in `redirect_to`.
`target=libre`, used by contextual links and the hidden debug Open VatioLibre
action, sends
`redirect_to=https://dev.vatiolibre.com/fleet` in development and the matching
production VatioLibre fleet URL in production. Subscription links send the
matching `/subscribe` URL instead.

The VatioLibre README is the source of truth for Frappe OAuth Client and Social
Login Key rows, including exact redirect URIs for dev and production.

Logout from VatioBoard currently clears the active API host session only. It
does not guarantee logout from VatioLibre or another sibling domain unless a
global logout orchestration flow is added.

## Testing

The repo has both unit and smoke coverage.

- unit tests cover storage, calculations, formatting, i18n, replay logic, GPS helpers, and related modules
- product smoke tests boot `index.html`, navigate SPA hash routes, and assert route remount behavior with mocked browser APIs
- legacy standalone smoke tests use `dev-harness-*` filenames and cover harness-only behavior

## Automation

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm ci`, `npm run lint`, `npm test`, and `npm run build` on pushes and pull requests
- [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds `dist/` with Node 24 and deploys GitHub Pages on pushes to `main` or manual dispatch

## Runtime Notes

- language is shared through [`src/i18n.js`](src/i18n.js)
- geolocation permission is required for Vatio Speed, Vatio GPS Rate Lab, and Vatio Accel
- the first successful place lookup can initialize shared regional units unless the user already chose units manually
- reverse geocoding is intentionally lightweight, cached, and non-blocking for recording flows
- some audio paths require a user gesture before playback is allowed by the browser
- route controllers are expected to create DOM-owned listeners, timers, maps, charts, RAFs, and route async work during mount, then clean them during unmount
- new production route views should clone templates on each mount; do not add `preserveDom` routes or route-level raw sync loops
- Vatio GPS Rate Lab reports observed browser callback behavior, not guaranteed GPS hardware frequency
- Vatio Accel is an estimate-oriented browser timer, not a certified timing system

## Contributing

Contributions are welcome, especially around:

- browser compatibility
- mobile and in-car usability
- widget polish and accessibility
- data pipeline improvements for the speedometer

## Credits

- Oscar Perez
- VatioLibre community
- Mauricio Pradilla for logo and branding contributions: https://mauriciopradilla.com/
- Santiago Jimenez Moncada for contributions to `vatioboard.com` and `vatiolibre.com`: https://github.com/ssantss

## Demo Music Attribution

The demo songs in `public/audio/demo/` are royalty-free tracks used under
Creative Commons or similar permissive licenses. They ship with the
repository so visitors can try the player without signing in.

| Track | Artist | License | Source |
|---|---|---|---|
| On The Run | Tim Kulig | CC BY 4.0 | [timkulig.com](https://timkulig.com) |
| Rocker Chicks | Audionautix | CC BY 4.0 | [audionautix.com](https://audionautix.com) |
| Titan | Scott Buckley | CC BY 4.0 | [scottbuckley.com.au](https://www.scottbuckley.com.au/library) |
| Exit the Premises | Kevin MacLeod | CC BY 4.0 | [incompetech.com](https://incompetech.com) |
| Pascifica | Tim Kulig | CC BY 4.0 | [timkulig.com](https://timkulig.com) |
| Ryno's Theme | Kevin MacLeod | CC BY 4.0 | [incompetech.com](https://incompetech.com) |
| Legionnaire (2022 Remaster) | Scott Buckley | CC BY 4.0 | [scottbuckley.com.au](https://www.scottbuckley.com.au/library) |
| Timeless | Alex Productions | CC0 / Free | [chosic.com](https://www.chosic.com) |
| Neo Western | Kevin MacLeod | CC BY 4.0 | [incompetech.com](https://incompetech.com) |
| Beach Bum | Kevin MacLeod | CC BY 4.0 | [incompetech.com](https://incompetech.com) |
| The Climb | Scott Buckley | CC BY 4.0 | [scottbuckley.com.au](https://www.scottbuckley.com.au/library) |
| What You Want | Kevin MacLeod | CC BY 4.0 | [incompetech.com](https://incompetech.com) |
| Canon in D Major | Kevin MacLeod | CC BY 4.0 | [incompetech.com](https://incompetech.com) |
