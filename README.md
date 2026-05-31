# VatioBoard

VatioBoard is a local-first Vite 7 SPA of touch-first browser tools for Tesla-sized screens, mobile, and desktop. The production app runs through `index.html` and hash routes, while built-in apps are moving to a manifest-driven internal VatioBoard OS platform with route apps, shell-window apps, background services, scoped runtime services, permissions, and app-private storage.

- Production site: https://www.vatioboard.com
- Repository: https://github.com/vatiolibre/vatioboard
- Community: https://vatiolibre.com
- Creator: Oscar Perez

## Quick Start

Requirements:

- Node.js `>=24`
- pnpm `11.x` through Corepack or a matching local install

Commands:

```bash
pnpm install
pnpm run dev
pnpm run verify
```

`pnpm run dev` starts Vite after rebuilding local speed-camera artifacts. Local development uses `http://localhost:5174/` when the configured port is free.

## App Routes

| Route       | App           | Purpose                                                                                 |
| ----------- | ------------- | --------------------------------------------------------------------------------------- |
| `#/speed`   | Vatio Speed   | GPS speedometer, drive recording, overspeed alerts, and local/static speed-camera data. |
| `#/board`   | Board         | Drawing canvas with calculator and EV trip cost widgets.                                |
| `#/library` | Cloud Library | Local/cloud media, records, and VatioLibre account-aware library tools.                 |
| `#/replay`  | Drive Replay  | Local and synced route/session replay with map and charts.                              |
| `#/accel`   | Vatio Accel   | GPS acceleration runs, run history, and replay views.                                   |
| `#/apps`    | App Manager   | Internal VatioBoard OS app inventory, diagnostics, permissions, and controls.           |

`#/` currently opens the Speed app, and `#/speed` is its explicit route alias.

## Legacy Harnesses

Standalone files such as `speed.html`, `replay.html`, `accel.html`, `gps-rate.html`, `calculator.html`, and `login.html` are legacy standalone dev/test harnesses. They are useful for isolated smoke coverage and debugging, but they are not the primary production routes.

Other harness-style files, including `library.html` and `player.html`, follow the same rule: production navigation should go through the SPA shell and manifest-backed routes/windows.

## Stack

- Vite 7 SPA with `index.html` as the production HTML entry
- Framework-free TypeScript/JavaScript ES modules
- LESS for styling
- `mathjs` for calculator evaluation
- `@jaames/iro` for the board color picker
- `maplibre-gl` for maps and route replay
- `chart.js` for replay and acceleration charts
- `@stanko/dual-range-input` for range controls
- `kdbush` and `geokdbush` for speed-camera lookup
- Vitest + jsdom for unit and smoke tests
- ESLint + Prettier for code quality

## Creating Apps

VatioBoard OS is an internal app platform today, not a plugin marketplace. External/community app installation is not implemented yet.

The app contract is:

```txt
App = Manifest + Entry Module + Optional Template + Optional Styles + Tests
```

Start with the generator:

```bash
pnpm run create:app -- route notes
pnpm run create:app -- window timer
pnpm run create:app -- background offline-heartbeat
```

Generated app folders live under `src/apps/<kebab-name>/`. Normal production routes should come from manifests registered in `src/app-platform/builtin-apps.ts`, not manual edits to `src/app/route-registry.ts`.

Use [`docs/app-platform/00-overview.md`](docs/app-platform/00-overview.md) as the source of truth for creating apps.

## Docs Map

- Coding-agent quick path: [`docs/agent-quickstart.md`](docs/agent-quickstart.md)
- App creation and platform contracts: [`docs/app-platform/`](docs/app-platform/)
- Architecture/reference: [`docs/vatioboard-os.md`](docs/vatioboard-os.md)
- Speed-camera data and Camera Map details: [`docs/speed-camera-data.md`](docs/speed-camera-data.md)
- Historical handoff and implementation notes: [`docs/archive/`](docs/archive/)
- TypeScript migration notes: [`docs/typescript-migration-notes.md`](docs/typescript-migration-notes.md)

## Development Commands

- `pnpm run create:app -- <route|window|background> <kebab-name>`: scaffold a VatioBoard OS app.
- `pnpm run dev`: rebuild local geo artifacts, then run Vite.
- `pnpm run typecheck`: run TypeScript without emitting files.
- `pnpm run lint`: run ESLint.
- `pnpm test`: run unit, architecture, and smoke tests.
- `pnpm run build`: create a production build.
- `pnpm run verify`: run typecheck, lint, tests, and build.
- `pnpm run format` / `pnpm run format:check`: format or check maintained root Markdown/JSON/YAML and workflow YAML.

## Speed Camera Data

Vatio Speed and Camera Map use generated local/static artifacts under `public/geo/cameras`. Browser runtime does not query Overpass or parse live road geometry while driving. GPS matching happens locally, cached artifacts survive offline refresh failures, and unknown camera speed limits stay unknown rather than becoming zero-speed alerts.

Common commands:

```bash
pnpm run prepare:geo
pnpm run fetch:cameras
pnpm run analyze:cameras:maxspeed
```

See [`docs/speed-camera-data.md`](docs/speed-camera-data.md) for artifact roles, Overpass/cache behavior, approach-aware camera matching, Camera Map notes, and OpenStreetMap contribution guidance.

## Backend Integration

VatioBoard is mostly local-first. Drawings, calculator state, trip estimates, replay sessions, acceleration runs, media cache state, and app-private settings are stored in the browser. Some account-aware actions use the VatioLibre backend when available, such as cloud sync, auth/session checks, feature access, and media/library flows.

Shared backend auth lives in `src/shared/backend-auth.ts`. Production frontend hosts use `https://api.vatioboard.com`; non-production frontend hosts use `https://api.dev.vatioboard.com`.

## Testing

The repo has unit, frontend-architecture, and smoke coverage. Product smoke tests boot `index.html` and navigate SPA hash routes with mocked browser APIs. Legacy standalone smoke tests use `dev-harness-*` filenames and cover harness-only behavior.

CI runs Node 24 with pnpm 11.3.0, then typecheck, lint, tests, and build through `.github/workflows/ci.yml`.

## Credits

- Oscar Perez
- VatioLibre community
- Mauricio Pradilla for logo and branding contributions: https://mauriciopradilla.com/
- Santiago Jimenez Moncada for contributions to `vatioboard.com` and `vatiolibre.com`: https://github.com/ssantss

## Demo Music Attribution

The demo songs in `public/audio/demo/` are royalty-free tracks used under Creative Commons or similar permissive licenses. They ship with the repository so visitors can try the player without signing in.

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

## License

No open-source license has been declared yet. Ask the project owner before copying, redistributing, or using the code outside this repository.
