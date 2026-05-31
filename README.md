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

`gps-rate.html` is a legacy standalone test/dev harness for the diagnostics page in [`src/gps-rate/gps-rate.ts`](src/gps-rate/gps-rate.ts). It is not a production SPA route.

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

## VatioBoard OS App Platform

VatioBoard apps are created from manifests, entry modules, optional templates/styles, and tests. Start with the platform docs:

- [Overview](docs/app-platform/00-overview.md)
- [Create a route app](docs/app-platform/01-create-a-route-app.md)
- [Create a shell-window app](docs/app-platform/02-create-a-shell-window-app.md)
- [Create a background service](docs/app-platform/03-create-a-background-service.md)
- [Manifest reference](docs/app-platform/04-manifest-reference.md)
- [Runtime services](docs/app-platform/05-runtime-services.md)
- [Storage and settings](docs/app-platform/06-storage-and-settings.md)
- [Permissions](docs/app-platform/07-permissions.md)
- [Testing new apps](docs/app-platform/08-testing-new-apps.md)
- [Migration guide](docs/app-platform/09-migration-guide-existing-apps.md)

Use `pnpm run create:app -- route notes`, `pnpm run create:app -- window timer`, or `pnpm run create:app -- background offline-heartbeat` to scaffold new app-owned files.

## Speed Camera Data

Vatio Speed uses generated runtime artifacts in `public/geo/cameras`:

- `manifest.json` lists available countries, counts, hashes, bounding boxes, and country or tile artifact URLs.
- `countries/<code>.json` stores compact traps as `[lon, lat, speedKphOrNull, osmId?, speedMeta?]`.
- `countries/<code>.kdbush` stores the matching KDBush index.
- Large countries can be split into `countries/<code>/manifest.json` plus `tiles/<tile-id>.json` and `tiles/<tile-id>.kdbush`.

`speedMeta` is optional compact provenance for inferred limits and approach matching. Explicit camera maxspeed tags stay highest-confidence. Missing camera maxspeed can be enriched at fetch/build time from nearby OSM road ways with `maxspeed`, `maxspeed:forward`, or `maxspeed:backward`; unknown remains `null`, never `0`.

Approach metadata is stored inside `speedMeta.approach` when the build pipeline can match a camera to a nearby private-car-eligible road segment. Each compact approach entry can include a forward bearing, reverse bearing, allowed direction, road distance, confidence, and a clipped two-point segment. The enrichment filter excludes pedestrian and cycling ways, tracks, bus-only roads, private or access-restricted roads, emergency-only roads, and private service roads such as driveways or parking aisles. Public service roads are included only when the build explicitly opts in and the OSM access tags still allow private cars.

If a camera is near only restricted roads, the build leaves the approach corridor empty instead of using a misleading segment. Old artifacts without `approach` continue to load and alert through the fallback policy.

`pnpm run prepare:geo` is offline-safe. It first converts `data-src/ANSV.csv` to `data-src/ansv_cameras_maplibre.geojson` when the CSV is present, then builds from `data-src/osm_speed_cameras_overpass.json` and the optional `data-src/osm_speed_cameras_maxspeed_enrichment.json` sidecar when they exist. Without the cached OSM source, it falls back to the generated Colombia ANSV GeoJSON so dev/build never depend on live Overpass. Browser runtime does not query Overpass or parse road geometry while driving.

`pnpm run fetch:cameras` is the network/update command. By default it reuses the cached global camera source if `data-src/osm_speed_cameras_overpass.json` already exists, resumes cached road-speed tiles from `data-src/osm-road-speeds/`, fetches only missing road-speed tiles, writes `data-src/osm_speed_cameras_maxspeed_enrichment.json`, and rebuilds `public/geo/cameras`. Set `CAMERA_REFRESH_CACHE=1` only when you intentionally want to refresh the global camera Overpass source.

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
pnpm run fetch:cameras 2>&1 | tee "logs/fetch-cameras-first-pass-$(date +%Y%m%d-%H%M%S).log"
```

After the first pass, most local work should avoid Overpass entirely:

```bash
CAMERA_ROAD_FETCH_MISSING=0 pnpm run fetch:cameras
pnpm run prepare:geo
pnpm run analyze:cameras:maxspeed
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
pnpm run fetch:cameras
pnpm run prepare:geo
pnpm run analyze:cameras:maxspeed
pnpm run test:unit
pnpm run test:smoke
pnpm run lint
pnpm run build
```

### Speed Alerts Shell Window

Speed alert settings live in a reusable shell window with the window id `speed-alerts`. It can be opened from the Speed page, Camera Map/floating tools/start menu, and any SPA route that has access to `window.__vatioboardFloatingTools.openSpeedAlerts()` or `toggleSpeedAlerts()`.

The window behaves like the other VatioBoard tools: it is draggable, resizable, snappable, minimizable/restorable/closable, and participates in shell layout persistence and named layouts. It is not owned by the Speed route, so switching to Board, Library, Replay, Accel, or Camera Map does not destroy the panel or create a duplicate settings surface.

Speed Alerts is only a settings and status shell. It binds to the shared app-level driving alert service, shared GPS service, existing speed preferences, and generated/cached camera artifacts. Opening the window does not start a second GPS watch, create a second camera database, query Overpass, or fetch a live road network. If GPS permission is denied or camera artifacts are unavailable, the panel still opens and reports the local/offline state.

Audio still follows browser gesture rules. Sound toggles change the existing alert preferences, and priming/testing alert audio must happen from a user gesture. Once audio is primed and alerts are enabled, overspeed and camera proximity evaluation continues through the app-level service across route changes.

### Contributing Speed Cameras To OpenStreetMap

The best way to improve VatioBoard's camera coverage is to improve OpenStreetMap itself. VatioBoard's generated camera artifacts are derived from OSM `highway=speed_camera` nodes plus local/official sources, so upstream fixes benefit this app and every other OSM consumer after the next data refresh.

Before editing, read the OSM wiki pages for [`highway=speed_camera`](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dspeed_camera), [speed limits](https://wiki.openstreetmap.org/wiki/Speed_limit), [`maxspeed=*`](https://wiki.openstreetmap.org/wiki/Key:maxspeed), [verifiability](https://wiki.openstreetmap.org/wiki/Verifiability), and [good practice](https://wiki.openstreetmap.org/wiki/Good_practice). Do not copy camera locations or speed limits from Google Maps, Waze, TomTom, Apple Maps, commercial camera databases, or any other source that is not explicitly compatible with OSM. If you want to use a government or open-data camera list, follow the OSM [Import Guidelines](https://wiki.openstreetmap.org/wiki/Import/Guidelines) and [Automated Edits code of conduct](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct), discuss the plan with the local OSM community first, and keep the import reviewable.

For one-off manual fixes:

1. Create or log in to an OpenStreetMap account at [openstreetmap.org](https://www.openstreetmap.org/).
2. Use the built-in iD editor for small edits, or JOSM for careful road/camera cleanup.
3. Confirm the camera from ground survey, your own geotagged imagery, street-level imagery allowed for OSM editing, or another OSM-compatible source. Map only real, current, verifiable fixed cameras. Do not add temporary police traps or rumors as permanent `highway=speed_camera` objects.
4. Place a node for the fixed camera. If the camera is represented directly on the roadway, put the node on the affected road way near the camera. If the physical camera is beside or above the road, place it at the real camera position and consider adding an enforcement relation for the affected road section.
5. Add `highway=speed_camera`. Add `maxspeed=*` when the enforced limit is known and verifiable. Use plain numeric values for km/h, for example `maxspeed=50`, and include a spaced unit for mph, for example `maxspeed=30 mph`.
6. Add `direction=*` when the monitored direction is known. Use degrees when possible; make sure the value describes the useful enforcement/traffic direction rather than a confusing decorative camera-lens direction. For complex setups, use an OSM `type=enforcement` relation with the camera device and the affected road section.
7. Add helpful provenance and maintenance tags when known, such as `operator=*`, `ref=*`, `source=*`, `check_date=*`, or `survey:date=*`. Keep names and notes factual; avoid adding warnings or app-specific text to OSM.
8. Save with a clear changeset comment, for example `Add fixed speed camera and signed maxspeed on Main St`, and include the source you used.

Good camera alerts also depend on nearby road tagging. If a camera already exists but VatioBoard picks the wrong corridor, improve the road data rather than adding duplicate cameras:

- Add or correct `maxspeed=*`, `maxspeed:forward=*`, and `maxspeed:backward=*` on the road ways where the limit is actually posted. Split the OSM way at the sign or intersection when the limit changes for only part of the road.
- Check the road direction before using `*:forward` or `*:backward`; forward means the direction of the OSM way geometry.
- Add `oneway=*`, `junction=roundabout`, turn restrictions, or separate carriageways where the real road layout requires them.
- Add access tags such as `access=*`, `vehicle=*`, `motor_vehicle=*`, `motorcar=*`, `busway=*`, `service=*`, and lane access tags when they are signed or otherwise verifiable. These tags help VatioBoard ignore footways, cycleways, private roads, bus-only lanes, driveways, parking aisles, and emergency-only service roads when building approach corridors.
- Remove stale or duplicate camera nodes only when you have verified the physical camera is gone or the duplicate truly refers to the same object. Preserve useful existing tags and OSM object history whenever possible.

After an upstream OSM edit is saved, wait for Overpass and downstream OSM mirrors to catch up, then regenerate the local artifacts:

```bash
pnpm run fetch:cameras
pnpm run analyze:cameras:maxspeed
```

For routine local verification without fetching missing road tiles, use:

```bash
CAMERA_ROAD_FETCH_MISSING=0 pnpm run fetch:cameras
```

Individual camera fixes should normally go to OSM first, not directly into this repository. A VatioBoard data PR is most useful when it adds or updates an OSM-compatible official source, documents a repeatable import/reconciliation process, or improves the build pipeline that consumes upstream data.

### Camera Map

The Camera Map points come from the same local/static camera artifacts described above. The browser does not call Overpass or any camera API from the map panel.

The panel is designed as an in-car navigation display: the map takes nearly the whole window, controls are compact touch targets, and the live position is shown as a bright green vehicle puck. Native MapLibre zoom controls stay in the top-right, while Camera Map follow/orientation/layer controls are compact and offset so they remain usable on touch screens and fullscreen displays.

Heading comes from browser GPS `coords.heading` when available and is exposed through the app GPS service as `headingDeg`; when GPS heading is missing, Camera Map can derive a bearing from meaningful recent movement. Follow mode keeps the vehicle visible and can frame a nearby relevant camera from the currently loaded camera features. The orientation control cycles between north-up and heading-up; heading-up falls back gracefully to north-up behavior when heading is unavailable or stale. Camera-aware framing uses only loaded local/static artifacts and does not fetch live camera APIs.

Camera Map includes an Approach overlay in the normal layer menu. Enable **Approach** to show matched camera road segments, allowed detection directions, confidence styling, fallback halos for cameras without road corridors, and a compact legend for all visible cameras. Solid approach roads indicate higher-confidence matches; softer/dashed lines indicate low-confidence or ambiguous matches; direction rays show which traffic direction is believed to trigger the camera. Multiple corridors can be shown for one camera, such as a primary road plus an intersection candidate. The overlay reads only generated camera artifacts and cached map state, so it does not make live Overpass, Nominatim, or road-network requests while driving.

The global Approach overlay is optional, but focused camera explanations are always available. Tapping any camera draws that selected camera’s road corridor, detection direction, or no-corridor fallback area even when the global overlay is off. While driving, the current approaching or active matched camera is highlighted automatically with the matched corridor, detection ray, user-to-camera bearing line, or fallback halo. If the global overlay is on, these selected/current visuals sit above the wider overlay so the active rule is easy to distinguish from neighboring cameras.

Tapping a camera opens a Camera approach section that summarizes confidence, direction, matched-road distance, bearing, source context, and the current match decision when live position is available. The popup resolves full corridor details on demand from already-loaded local camera artifacts, so normal marker features can stay lightweight until a single camera is inspected. The details list each corridor, including its role, allowed direction, bearing pair, confidence, road match distance, and way id. If no road corridor is available, the popup explains that alerts may use heading/radius fallback and that the camera needs road-direction data for more precise filtering. The popup explains outcomes such as “Would alert now,” “Near but not approaching,” “Heading unavailable,” or “Using fallback,” and includes a **Copy camera review info** action with a local JSON payload for filing data fixes. Cameras with missing, low-confidence, or ambiguous approach data remain visible so bad road matching, wrong direction metadata, and old cached artifacts can be reviewed instead of hidden.

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

- Add a daily GitHub Actions workflow that runs `pnpm run fetch:cameras`, opens a data refresh PR, and reports artifact counts.
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
- pnpm via Corepack

### Install

```bash
corepack enable
pnpm install
```

### Start The Dev Server

```bash
pnpm run dev
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

- `pnpm run prepare:ansv`: converts `data-src/ANSV.csv` to `data-src/ansv_cameras_maplibre.geojson`
- `pnpm run prepare:geo`: builds the speed-camera artifacts consumed by Vatio Speed from local data, including the ANSV CSV conversion step
- `pnpm run fetch:cameras`: resumes/fetches local Overpass camera and road-speed data, writes maxspeed enrichment, and rebuilds speed-camera artifacts
- `pnpm run analyze:cameras:maxspeed`: prints explicit/inferred/unknown speed coverage from the generated camera manifest
- `pnpm run create:app -- <route|window|background> <kebab-name>`: scaffolds a VatioBoard OS app folder
- `pnpm run dev`: runs Vite locally after the `predev` geo preparation step
- `pnpm run build`: creates a production build after the `prebuild` geo preparation step
- `pnpm run preview`: serves the built app locally
- `pnpm run lint`: runs ESLint
- `pnpm run lint:fix`: runs ESLint with autofix
- `pnpm run format`: formats root JSON/YAML/Markdown config/docs, lockfile/workspace files, and workflow YAML with Prettier
- `pnpm run format:check`: checks the same maintained-file set without writing changes
- `pnpm test`: runs the full Vitest suite
- `pnpm run test:watch`: runs Vitest in watch mode
- `pnpm run test:unit`: runs unit tests under `test/unit`
- `pnpm run test:smoke`: runs smoke tests under `test/smoke`

Application source/tests/scripts, legacy standalone harness HTML, and generated/reference geo datasets are excluded from routine Prettier checks during this migration to avoid unrelated churn and Node heap pressure.

## Generated Data

`pnpm run prepare:geo` first regenerates [`data-src/ansv_cameras_maplibre.geojson`](data-src/ansv_cameras_maplibre.geojson) from `data-src/ANSV.csv` when the CSV exists. It then reads `data-src/osm_speed_cameras_overpass.json` when present, applies `data-src/osm_speed_cameras_maxspeed_enrichment.json` when present, otherwise falls back to the ANSV GeoJSON, and generates:

- `public/geo/cameras/manifest.json`
- `public/geo/cameras/countries/<country-code>.json`
- `public/geo/cameras/countries/<country-code>.kdbush`
- optional `public/geo/cameras/countries/<country-code>/tiles/*` files for large countries

Source/cache files have different repository roles:

- Commit `data-src/ANSV.csv`; it is the editable ANSV source of truth for Colombia official cameras.
- `data-src/ansv_cameras_maplibre.geojson` is regenerated from `data-src/ANSV.csv` by `pnpm run prepare:ansv` and by the default geo build.
- Commit `data-src/osm_speed_cameras_overpass.json`; it is the compact raw camera source used by offline builds.
- Commit `data-src/osm_speed_cameras_maxspeed_enrichment.json`; it is the compact inferred-speed sidecar used by offline builds and GitHub Pages.
- Do not commit `data-src/osm-road-speeds/`; it is a large restartable Overpass road tile cache used only by `pnpm run fetch:cameras`.
- Do not commit `logs/`; fetch logs are local diagnostics.
- Do not commit `public/geo/cameras/`; `predev`, `prebuild`, and the GitHub Pages workflow regenerate it.

The GitHub Pages workflow runs `pnpm run build`, and `prebuild` runs `pnpm run prepare:geo`. That means Pages deployment needs the checked-in source files under `data-src`, not the 5 GB road cache or the generated `public/geo/cameras` directory.

`public/geo/` may be missing in a fresh checkout until you run `pnpm run prepare:geo`, `pnpm run dev`, or `pnpm run build`.

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

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm test`, and `pnpm run build` on pushes and pull requests
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

| Track                       | Artist           | License    | Source                                                         |
| --------------------------- | ---------------- | ---------- | -------------------------------------------------------------- |
| On The Run                  | Tim Kulig        | CC BY 4.0  | [timkulig.com](https://timkulig.com)                           |
| Rocker Chicks               | Audionautix      | CC BY 4.0  | [audionautix.com](https://audionautix.com)                     |
| Titan                       | Scott Buckley    | CC BY 4.0  | [scottbuckley.com.au](https://www.scottbuckley.com.au/library) |
| Exit the Premises           | Kevin MacLeod    | CC BY 4.0  | [incompetech.com](https://incompetech.com)                     |
| Pascifica                   | Tim Kulig        | CC BY 4.0  | [timkulig.com](https://timkulig.com)                           |
| Ryno's Theme                | Kevin MacLeod    | CC BY 4.0  | [incompetech.com](https://incompetech.com)                     |
| Legionnaire (2022 Remaster) | Scott Buckley    | CC BY 4.0  | [scottbuckley.com.au](https://www.scottbuckley.com.au/library) |
| Timeless                    | Alex Productions | CC0 / Free | [chosic.com](https://www.chosic.com)                           |
| Neo Western                 | Kevin MacLeod    | CC BY 4.0  | [incompetech.com](https://incompetech.com)                     |
| Beach Bum                   | Kevin MacLeod    | CC BY 4.0  | [incompetech.com](https://incompetech.com)                     |
| The Climb                   | Scott Buckley    | CC BY 4.0  | [scottbuckley.com.au](https://www.scottbuckley.com.au/library) |
| What You Want               | Kevin MacLeod    | CC BY 4.0  | [incompetech.com](https://incompetech.com)                     |
| Canon in D Major            | Kevin MacLeod    | CC BY 4.0  | [incompetech.com](https://incompetech.com)                     |
