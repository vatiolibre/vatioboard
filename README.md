# VatioBoard

VatioBoard is a multi-page Vite app of touch-first browser tools built for Tesla-sized screens and regular mobile/desktop browsers. The repo is mostly local-first: drawings, calculator state, trip estimates, replay sessions, and acceleration runs are stored in the browser, while some account-aware actions are optionally wired to the VatioLibre backend.

The project is part of the VatioLibre community and is published for educational use.

- Production site: https://www.vatioboard.com
- Repository: https://github.com/vatiolibre/vatioboard
- Community: https://vatiolibre.com
- Creator: Oscar Perez

## Pages

### Board

`index.html` loads the main board from [`src/board/board.js`](src/board/board.js).

What it does:

- full-screen drawing canvas with pen and eraser tools
- brush size control, preset swatches, and an `iro` color picker
- undo, redo, clear, and PNG export
- local autosave of drawing history
- embedded calculator widget and EV trip cost widget
- shared English/Spanish toggle
- optional VatioLibre login and save-to-backend flow for eligible accounts

### Calculator Demo

`calculator.html` loads the standalone calculator demo from [`src/calculator/calculator-demo.js`](src/calculator/calculator-demo.js).

What it does:

- opens the same calculator widget used by the board
- evaluates expressions with `mathjs`
- stores history, expression state, and formatting settings locally
- supports decimal precision and thousands separator settings

### Vatio Speed

`speed.html` loads the live speedometer from [`src/speed/speed.js`](src/speed/speed.js).

What it does:

- reads live browser geolocation data
- renders an analog speedometer plus trip stats
- supports `km/h` or `mph`, and metric or imperial distance units
- offers manual overspeed alerts and nearby speed-trap alerts
- supports quick audio mute and optional background-audio mode
- switches between gauge and Waze-style primary views
- records replay sessions for the replay page

### Drive Replay

`replay.html` loads the replay experience from [`src/replay/replay.js`](src/replay/replay.js).

What it does:

- loads the active and saved replay sessions recorded by Vatio Speed
- replays a route on a MapLibre globe/map
- shows speed, altitude, and heading charts
- supports time-based or distance-based playback
- offers playback-rate controls and session selection
- lets users remove saved recordings locally

### Vatio GPS Rate Lab

`gps-rate.html` loads the diagnostics page from [`src/gps-rate/gps-rate.js`](src/gps-rate/gps-rate.js).

What it does:

- measures observed `navigator.geolocation.watchPosition()` callback timing
- shows summary stats, live values, warnings, and an event log
- exports captured samples and summaries to JSON or CSV
- stores notes, wake-lock preference, and the latest saved summary locally
- includes a Nominatim test panel with cached response reuse

### Vatio Accel

`accel.html` loads the browser-based acceleration timer from [`src/accel/accel.js`](src/accel/accel.js).

What it does:

- times standing-start, rolling-start, distance, and custom speed-range runs
- uses browser geolocation updates only
- stores run history and settings locally
- shows quality grades, warning badges, and diagnostic stats
- includes result graphs plus replay map/chart views for completed runs

### Backend Login Test

`login.html` is a simple manual integration page for backend auth checks.

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
- handles `km` and `mi` ranges and formatting
- reuses calculator number-format settings where appropriate

## Stack

- Vite 7 multi-page build
- Vanilla JavaScript ES modules
- LESS for styling
- `mathjs` for calculator evaluation
- `@jaames/iro` for the board color picker
- `maplibre-gl` for speed and replay maps
- `chart.js` for replay and acceleration charts
- `@stanko/dual-range-input` for replay and acceleration range controls
- `kdbush` and `geokdbush` for speed-trap lookup
- Vitest + jsdom for unit and smoke tests
- ESLint + Prettier for code quality

## Project Layout

```txt
.
├─ index.html
├─ calculator.html
├─ speed.html
├─ replay.html
├─ gps-rate.html
├─ accel.html
├─ login.html
├─ data-src/                 # Source/reference datasets
├─ public/
│  ├─ audio/                 # Alert and finish sounds
│  ├─ geo/                   # Generated speed-trap payloads and KDBush index
│  └─ img/                   # Logos and social images
├─ scripts/
│  └─ build-speed-traps.mjs
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

Entry pages during development:

- `http://localhost:5174/`
- `http://localhost:5174/calculator.html`
- `http://localhost:5174/speed.html`
- `http://localhost:5174/replay.html`
- `http://localhost:5174/gps-rate.html`
- `http://localhost:5174/accel.html`
- `http://localhost:5174/login.html`

## Scripts

- `npm run prepare:geo`: builds the speed-trap artifacts consumed by Vatio Speed
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

`npm run prepare:geo` reads [`data-src/ansv_cameras_maplibre.geojson`](data-src/ansv_cameras_maplibre.geojson) and generates:

- `public/geo/ansv_cameras_compact.min.json`
- `public/geo/ansv_cameras_compact.kdbush`

`public/geo/` may be missing in a fresh checkout until you run `npm run prepare:geo`, `npm run dev`, or `npm run build`.

## Persistence Model

The app uses a mix of IndexedDB and `localStorage`.

- board drawings are stored in IndexedDB when available, with `localStorage` fallback/migration helpers
- speed replay sessions are stored in IndexedDB when available, with `localStorage` fallback/migration helpers
- accel settings and runs are stored in IndexedDB when available, with `localStorage` fallback/migration helpers
- calculator state/history/settings, energy widget state, GPS Rate Lab notes/settings, and shared UI preferences use `localStorage`
- replay depends on sessions recorded by the speed page

## Backend Integration

Shared backend auth lives in [`src/shared/backend-auth.js`](src/shared/backend-auth.js).

Behavior:

- production hosts use `https://api.vatioboard.com`
- non-production hosts use `https://api.dev.vatioboard.com`
- board, speed, replay, GPS Rate Lab, and accel surfaces all mount the shared auth controls
- saving a board drawing to the backend depends on authenticated feature access and the `saved_drawings` capability
- `login.html` is a plain manual test page for backend session and CORS troubleshooting

## Testing

The repo has both unit and smoke coverage.

- unit tests cover storage, calculations, formatting, i18n, replay logic, GPS helpers, and related modules
- smoke tests boot the real HTML entry pages in jsdom and assert SEO metadata, control wiring, and key flows with mocked browser APIs

## Automation

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `npm ci`, `npm run lint`, `npm test`, and `npm run build` on pushes and pull requests
- [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds `dist/` with Node 24 and deploys GitHub Pages on pushes to `main` or manual dispatch

## Runtime Notes

- language is shared through [`src/i18n.js`](src/i18n.js)
- geolocation permission is required for Vatio Speed, Vatio GPS Rate Lab, and Vatio Accel
- some audio paths require a user gesture before playback is allowed by the browser
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
