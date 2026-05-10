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
- `countries/<code>.json` stores compact traps as `[lon, lat, speedKphOrNull, osmId?]`.
- `countries/<code>.kdbush` stores the matching KDBush index.
- Large countries can be split into `countries/<code>/manifest.json` plus `tiles/<tile-id>.json` and `tiles/<tile-id>.kdbush`.

`npm run prepare:geo` is offline-safe. It builds from `data-src/osm_speed_cameras_overpass.json` when that cached Overpass response exists, otherwise it uses the checked-in Colombia ANSV seed so dev/build never depend on live Overpass. `npm run fetch:cameras` explicitly refreshes `data-src/osm_speed_cameras_overpass.json` from Overpass with:

```txt
[out:json][timeout:1000];
node["highway"="speed_camera"];
out body;
```

At runtime, Speed does not upload live location to fetch camera alerts. GPS matching happens locally: the app loads the manifest, chooses the current country or nearby tile from the GPS fix, tries IndexedDB first, and revalidates in the background. If the network drops during an update, the last good cached country/tile stays intact. With no cache and no network, the speedometer still works and trap alerts show an unavailable/offline camera database status.

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
- `npm run fetch:cameras`: refreshes the local Overpass raw source and rebuilds speed-camera artifacts
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

`npm run prepare:geo` reads `data-src/osm_speed_cameras_overpass.json` when present, otherwise [`data-src/ansv_cameras_maplibre.geojson`](data-src/ansv_cameras_maplibre.geojson), and generates:

- `public/geo/cameras/manifest.json`
- `public/geo/cameras/countries/<country-code>.json`
- `public/geo/cameras/countries/<country-code>.kdbush`
- optional `public/geo/cameras/countries/<country-code>/tiles/*` files for large countries

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
