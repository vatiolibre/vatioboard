# VatioBoard OS

VatioBoard OS is the internal architecture layer that lets VatioBoard apps run inside the browser shell through a stable manifest and runtime contract. This is reference documentation for how the platform fits together; app-creation tutorials live in [`docs/app-platform/`](app-platform/).

The current platform is internal-only. It does not implement external app installation, signed bundles, sandboxed iframe apps, or a plugin marketplace.

## Source Of Truth

- App contract and runtime types: `src/app-platform/types.ts`
- Manifest helpers and validation: `src/app-platform/manifest.ts`
- Built-in inventory: `src/app-platform/builtin-apps.ts`
- Runtime construction: `src/app-platform/runtime.ts`
- Runtime service gateways: `src/app-platform/services.ts`
- App-private storage: `src/app-platform/storage.ts`
- App settings and shared settings: `src/app-platform/settings.ts`, `src/app-platform/shared-settings.ts`
- Background lifecycle: `src/app-platform/background-services.ts`
- Launcher and shell-window runtimes: `src/app-platform/launcher.ts`, `src/app-platform/shell-app-runtime-manager.ts`
- Production route compatibility: `src/app/route-registry.ts`

`src/app-platform/builtin-apps.ts` is the authoritative built-in app inventory. It includes route apps, shell-window apps, App Manager, and protected internal background services such as `vatio.offlineReadiness`.

## App Contract

```txt
App = Manifest + Entry Module + Optional Template + Optional Styles + Tests
```

App types:

- Route app: a full-page SPA surface mounted in the route view area.
- Shell-window app: a floating or panel-style tool managed by the shell.
- Background service: a lifecycle-managed app with no visible UI.

For creation steps, use [`docs/app-platform/00-overview.md`](app-platform/00-overview.md), not this file.

## Manifests And Registries

Built-ins register `VatioAppManifest` objects. The registry validates manifests and rejects duplicate app IDs, routes, aliases, shell window IDs, and legacy tool IDs.

Valid manifest values are defined in `src/app-platform/types.ts` and enforced in `src/app-platform/manifest.ts`. Keep docs aligned with those files before adding or changing:

- `kind`
- `surfaces`
- `permissions`
- `services`
- `status`
- `window.mode`

Compatibility adapters derive the older route, tool, and shell-window registries from manifests so normal production routes do not need manual route-registry edits.

## Runtime Shape

Every app receives a scoped `VatioAppRuntime`:

- `runtime.appId`
- `runtime.manifest`
- `runtime.permissions`
- `runtime.services`
- `runtime.shell`
- `runtime.storage`
- `runtime.i18n`
- `runtime.lifecycle`
- `runtime.logger`
- `runtime.route`
- `runtime.routeSignal`

Routes receive the runtime through `routeContext.context.appRuntime`. Shell-window apps receive it through `createShellWindowApp({ runtime, shellManager, shellAppRuntimeManager, ... })`. Background services receive it from `createBackgroundServiceManager()`.

## Services And Permissions

Runtime exposure requires both a service declaration and matching permission. Declaring one without the other should be treated as a defect for new apps.

```ts
permissions: ["gps.read"],
services: ["gps"],
```

`runtime.services` currently exposes these service objects:

- `gps`
- `audio`
- `driveRecording`
- `drivingAlerts`
- `auth`
- `cloudSync`
- `settings`
- `sharedSettings`

`storage`, `i18n`, and `shell` are valid manifest service IDs, but their app APIs are top-level runtime fields:

- Declare `services: ["storage"]` with `storage.app`, then use `runtime.storage`.
- Declare `services: ["i18n"]` with `i18n.read`, then use `runtime.i18n`.
- Declare `services: ["shell"]` with `shell.launchApp` and/or `shell.window`, then use gated capabilities on `runtime.shell`.

`settings` exposes both `runtime.services.settings` and `runtime.services.sharedSettings` when the matching settings permissions are granted.

## App Control

App control state is separate from manifests and stored under:

```txt
vatioboard.os.appControl.v1
```

The control plane tracks enabled state, pin/favorite/hidden state, launch metadata, permission grants/revocations, and storage policy metadata. Protected apps and protected critical permissions cannot be disabled or revoked when doing so would break the shell.

App Manager is available at `/apps`. It lists manifests, runtime state, background service state, permission controls, app-private storage usage, and launch/open/close actions.

Permission revocation is a runtime boundary, not an automatic kill switch. For example, revoking audio permission blocks future calls through `runtime.services.audio`, but it does not necessarily stop an already-running shared audio flow unless the app explicitly stops it.

## Storage And Settings

`runtime.storage` stores simple app-private values under:

```txt
vatioboard.app.<appId>.<key>
```

Use it for small local-first state, drafts, flags, and small JSON. Use app-owned IndexedDB wrappers for large records, media metadata, recordings, offline datasets, and query-heavy data.

`runtime.services.settings` stores app-scoped preferences under the same app namespace. `runtime.services.sharedSettings` stores small OS-wide preferences such as units, language, UI density, in-vehicle state, and shared audio defaults.

Raw `localStorage`, `sessionStorage`, and IndexedDB names should be kept for legacy compatibility, migrations, or large app-owned data. New or migrated raw keys/databases must be documented.

## Route Apps

Route app entries export `mount(root, runtimeOrContext)` through the route app wrapper pattern used under `src/apps/<app>/`. The compatibility route views in `src/app/views/*View.ts` remain only as older import shims for migrated routes.

Route apps should:

- Use `createRouteView()` for normal route wrapping.
- Use `routeContext.cleanup` and abort signals for route-owned work.
- Prefer runtime services over `window.__vatioboard...` globals.
- Preserve legacy fallbacks when standalone harnesses still need them.

## Shell-Window Apps

Shell-window entries export `createShellWindowApp(options)`. The launcher ensures one scoped runtime per app/window, lazy-loads the entry when needed, and focuses or restores existing windows instead of duplicating them.

The manifest `window.shellWindowId` must match the registered shell window ID. Shell-window apps should let the shell runtime own dragging, resizing, snap, minimize, restore, close, and taskbar behavior.

## Background Services

Background services are lifecycle-managed apps with `background` and/or `app-manager` surfaces. `createBackgroundServiceManager()` starts autostart services, creates scoped runtimes, and handles start/suspend/resume/stop/destroy.

`vatio.offlineReadiness` is the protected internal offline-readiness diagnostic service. It is intentionally lightweight and does not add GPS watches, heavy loops, external loading, or new cloud protocols.

## Migration Rules

- Preserve existing app IDs, route paths, aliases, shell window IDs, storage keys, permissions, and service names.
- Move one app boundary at a time.
- Keep compatibility fallbacks until standalone harnesses and old callers no longer need them.
- Prefer preference-sized migrations before moving large local records.
- Add tests for manifest validation, runtime service/permission gates, launch behavior, storage compatibility, and cleanup.

Long historical migration details are archived in [`docs/archive/`](archive/).

## Not Implemented Yet

- External/community app installation
- Permission prompts for third-party apps
- Signed app bundles
- Sandboxed iframe apps
- Cloud-backed app-private storage
- App-to-app messaging
- Service worker or background resilience changes
- Heavy background-service scheduling

## Validation

For platform or app work, run the narrow relevant tests first and the full gate before handoff when feasible:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
pnpm run verify
```
