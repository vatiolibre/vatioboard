# VatioBoard

VatioBoard is a multi-page Vite app for touch-first browser tools. The repo currently ships four user-facing surfaces:

- `Vatio Board`: a full-screen drawing board with color controls, PNG export, and quick access to utility widgets
- `Calculator`: a draggable calculator widget with history and formatting settings
- `Vatio Speed`: a live GPS speedometer with trip stats, globe view, and speed-trap alerts
- `Vatio GPS Rate Lab`: a front-end geolocation diagnostics page for measuring observed browser callback rate and field availability

The project is part of the VatioLibre community and is published for educational use.

- Production site: https://www.vatioboard.com
- Repository: https://github.com/vatiolibre/vatioboard
- Community: https://vatiolibre.com
- Creator: Oscar Perez

## App Surfaces

### Board

`index.html` loads the main drawing board from [`src/board/board.js`](src/board/board.js).

Key behavior:

- Pen and eraser tools on a full-screen canvas
- Brush size control
- Preset swatches plus an `iro`-powered custom color picker
- PNG export
- Theme-aware default ink color
- Shared language toggle (`en` / `es`)
- Embedded calculator and EV trip cost widgets
- Link out to the standalone speedometer page

### Calculator Widget

The calculator lives under `src/calculator/` and is used in two places:

- embedded in the board UI
- standalone demo page at `calculator.html`

Key behavior:

- `mathjs`-powered expression evaluation
- calculator history stored in `localStorage`
- draggable panel
- configurable decimal precision and thousands separator
- touch-friendly keypad and sheets for history/settings

### EV Trip Cost Widget

The energy widget lives under `src/energy/` and is mounted from the board.

Key behavior:

- simple mode for one-trip energy and cost estimates
- multi-trip mode for up to 5 trips
- km/mi-aware ranges and formatting
- persisted trip settings and values in `localStorage`
- shared number-formatting rules with the calculator widget

### Speedometer

`speed.html` loads the standalone speedometer from [`src/speed/speed.js`](src/speed/speed.js).

Key behavior:

- live speed from browser geolocation
- analog dial plus max speed, average speed, distance, duration, and altitude
- km/h or mph display, with metric/imperial distance units
- manual speed alerts and nearby speed-trap alerts
- optional background-audio mode to keep alerts ready when the page is hidden
- MapLibre globe that follows the current location
- bilingual UI via the shared i18n module

### GPS Rate Lab

`gps-rate.html` loads the standalone diagnostics page from [`src/gps-rate/gps-rate.js`](src/gps-rate/gps-rate.js).

Key behavior:

- uses browser `navigator.geolocation.watchPosition()` only
- measures observed callback intervals with both `position.timestamp` and `performance.now()`
- shows summary stats, warning badges, raw latest sample values, and a live event log
- exports captured samples plus summary stats to JSON or CSV
- stores session notes and the last saved summary in `localStorage`
- optimized for Tesla-sized touch screens, while still working on normal mobile and desktop browsers

## Stack

- Vite 7 multi-page build
- Vanilla JavaScript ES modules
- LESS for styling
- `mathjs` for calculator evaluation
- `@jaames/iro` for the board color picker
- `maplibre-gl` for the speedometer globe
- `kdbush` and `geokdbush` for fast speed-trap lookup

## Project Structure

```txt
.
├─ index.html                # Board page
├─ calculator.html           # Standalone calculator demo
├─ speed.html                # Standalone GPS speedometer
├─ gps-rate.html             # Standalone browser geolocation diagnostics page
├─ data-src/                 # Source datasets used to build speed-trap artifacts
├─ public/
│  ├─ audio/                 # Alert sounds
│  ├─ geo/                   # Generated compact trap payload + spatial index
│  └─ img/                   # Logos and social images
├─ scripts/
│  └─ build-speed-traps.mjs  # Generates public/geo artifacts from GeoJSON
├─ src/
│  ├─ board/                 # Drawing board entry module
│  ├─ calculator/            # Calculator widget/core/storage
│  ├─ dock/                  # Floating dock used on the board
│  ├─ energy/                # EV trip cost widget/core/storage
│  ├─ gps-rate/              # GPS rate diagnostics entry module
│  ├─ speed/                 # Speedometer entry module
│  ├─ styles/                # LESS bundles for each surface
│  ├─ i18n.js                # Shared English/Spanish translations
│  └─ icons.js               # Shared SVG icon markup
└─ vite.config.js            # Multi-page Vite configuration
```

## Development

### Requirements

- Node.js `>=24`
- npm

### Install

```bash
npm install
```

### Available Scripts

```bash
npm run prepare:geo
npm run dev
npm run build
npm run preview
```

What they do:

- `npm run prepare:geo`: reads `data-src/ansv_cameras_maplibre.geojson` and generates:
  - `public/geo/ansv_cameras_compact.min.json`
  - `public/geo/ansv_cameras_compact.kdbush`
- `npm run dev`: runs `prepare:geo` first, then starts the Vite dev server
- `npm run build`: runs `prepare:geo` first, then builds `dist/`
- `npm run preview`: serves the production build locally

### Entry Pages During Development

Vite is configured as a multi-page app through `vite.config.js`.

- `index.html`
- `calculator.html`
- `speed.html`
- `gps-rate.html`

## Runtime Notes

- UI language is shared across pages through `src/i18n.js`
- Most widget state is stored in `localStorage`:
  - calculator history, expression state, and formatting settings
  - board ink color and draggable panel positions
  - energy widget settings and trip data
  - speedometer units, alerts, and audio preferences
- The speedometer requires geolocation support and user permission
- Some audio features on the speedometer depend on a user gesture, which is why the page includes explicit audio toggles
- The GPS Rate Lab is also browser-only and requires geolocation support plus user permission
- GPS Rate Lab results are observed callback rates from the browser, not guaranteed GPS hardware sampling frequency

## GPS Rate Lab Note

What it does:

- runs a front-end-only browser geolocation sampling test
- reports observed callback interval timing, field availability, and warning conditions like sparse updates or hidden-tab throttling

How to run it:

- `npm install`
- `npm run dev`
- open `http://localhost:5173/gps-rate.html`

Known limitations:

- browser geolocation callback rate is not the same thing as GPS hardware frequency
- callbacks can be throttled by the browser, OS, permissions, battery policy, or hidden/background tab behavior
- fields like `speed`, `heading`, `altitude`, and `altitudeAccuracy` may be null or unsupported depending on the browser and motion state
- the page is intended for honest diagnostics, not Dragy-like claims or guaranteed telemetry precision

## Deployment

GitHub Actions deploys the production build to GitHub Pages on pushes to `main`.

The workflow in `.github/workflows/deploy.yml`:

- installs dependencies with `npm ci`
- builds the site with Node 24
- uploads `dist/`
- publishes via GitHub Pages

## Contributing

Contributions are welcome, especially around:

- browser compatibility
- mobile and in-car usability
- widget polish and accessibility
- data pipeline improvements for the speedometer

## License

MIT

## Credits

- Oscar Perez
- VatioLibre community
- Mauricio Pradilla for logo and branding contributions: https://mauriciopradilla.com/
- Santiago Jimenez Moncada for contributions to `vatioboard.com` and `vatiolibre.com`: https://github.com/ssantss
