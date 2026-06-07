# VatioBoard OS App Platform Overview

VatioBoard OS is the application platform inside the Vite SPA. It lets the shell discover apps from manifests, create scoped runtimes, launch routes and shell windows, manage permissions, expose shared services, and keep app-private storage local-first.

An app is not just a folder. The platform contract is:

```txt
App = Manifest + Entry Module + Optional Template + Optional Styles + Tests
```

The manifest tells the OS what exists. The entry module gives the OS code to load. Templates and styles make the app visible when it has UI. Tests prove the app follows the platform contract.

## For Coding Agents

For the shortest safe path, read [`../agent-quickstart.md`](../agent-quickstart.md) first. The main source-of-truth files are:

- `src/app-platform/types.ts`
- `src/app-platform/manifest.ts`
- `src/app-platform/builtin-apps.ts`
- `src/app-platform/runtime.ts`
- `scripts/create-app.mjs`

Use the generator first, import the manifest in `src/app-platform/builtin-apps.ts`, avoid manual normal production route edits in `src/app/route-registry.ts`, add tests, and run `pnpm run verify` when feasible.

## App Types

- Route app: a full-page SPA surface mounted inside the route view area. Examples: Speed, Board, Replay, Accel, Library, App Manager.
- Shell-window app: a floating or panel-style tool registered with the shell window manager. Examples: Calculator, Energy, Camera Map, Speed Alerts, Player, Milkdrop.
- Background service: a lifecycle-managed app with no visible UI. Example: Offline Readiness.

Use the generator for the first draft:

```bash
pnpm run create:app -- route notes
pnpm run create:app -- window timer
pnpm run create:app -- background offline-heartbeat
```

The generator writes a folder under `src/apps/<name>/` and prints the remaining manual registration and test steps.

## How The Pieces Work Together

- `src/app-platform/builtin-apps.ts` registers built-in app manifests with `appRegistry`.
- `appRegistry` validates app manifests, rejects duplicate ids/routes/window ids, and supplies route, tool, and shell-window adapters.
- The route registry in `src/app/route-registry.ts` is generated from app manifests. Normal app creation should not add routes by hand.
- `createAppRuntime()` creates the scoped runtime for one app. The runtime includes permissions, top-level storage/i18n/shell helpers, lifecycle, logger, and gated services.
- `createAppLauncher()` opens route apps, lazy-loads shell-window entries, focuses existing shell windows, and records launches.
- `createShellAppRuntimeManager()` keeps shell-window runtimes aligned with shell window open/minimize/close state.
- `createBackgroundServiceManager()` starts, suspends, resumes, stops, and destroys background service runtimes.
- `appControl` stores enabled/hidden/pinned/favorite state and App Manager permission grants/revocations.
- App Manager reads manifests, app control state, runtimes, permissions, storage usage, and background service state.

## Platform Flags

- `localFirst`: the app should keep primary user state in the browser and work without a backend for core behavior.
- `teslaOptimized`: the app is expected to work on Tesla-sized/touch-first screens as well as desktop and mobile browsers.
- `offlineCapable`: the app should remain useful offline after its local/static resources are available. It may still degrade gracefully if a network-backed feature is unavailable.

These flags are product commitments. Do not set them casually to make a manifest look complete.

## Recommended App Workflow

1. Pick the app type: route, shell-window, or background.
2. Generate a skeleton with `pnpm run create:app -- <type> <kebab-name>`.
3. Edit the app-owned `manifest.ts`.
4. Import the manifest from `src/app-platform/builtin-apps.ts`.
5. Implement the entry module using runtime services instead of global fallbacks.
6. Document any raw storage keys or IndexedDB databases owned by the app.
7. Add focused tests for manifest validation, launch/registration, permission/service gating, storage, and cleanup.
8. Run the validation commands.

## Validation Commands

Run these before handing off a platform or app change:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
pnpm run verify
```

`pnpm run verify` repeats the full local quality gate: typecheck, lint, tests, and build.
