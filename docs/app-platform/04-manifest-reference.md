# Manifest Reference

Every app has a `VatioAppManifest`. Use `defineAppManifest()` so TypeScript keeps the manifest aligned with the platform contract.

```ts
import { defineAppManifest } from "../../app-platform/manifest.js";

export const myAppManifest = defineAppManifest({
  // fields...
});
```

## Fields

- `id`: Stable app id. Built-ins use `vatio.<name>`, for example `vatio.speed`.
- `title`: Full display name.
- `shortTitle`: Compact display name for launchers or chips.
- `description`: One-sentence user/developer description.
- `kind`: App category. See valid values below.
- `version`: App contract version, usually `1.0.0` for built-in apps.
- `icon`: SVG markup string from `src/icons.ts`.
- `i18nKey`: Translation key for the app title.
- `route`: Main route path for route apps, such as `/notes`. Speed uses `/` with `/speed` as an alias.
- `aliases`: Optional alternate route paths.
- `entry`: Lazy module loader. Route entries export `mount()`. Shell-window entries export `createShellWindowApp()`. Background entries may export `createBackgroundServiceApp()`.
- `surfaces`: Where the app appears or runs.
- `order`: Sort order in registries and launchers.
- `permissions`: Permission claims the app may use.
- `services`: Runtime service ids the app asks the runtime to expose.
- `window`: Required for shell-window apps.
- `lifecycle`: Optional background/restore hints.
- `tags`: Search and grouping labels.
- `localFirst`: Whether the app keeps core state local-first.
- `teslaOptimized`: Whether the app is designed for Tesla-sized/touch screens.
- `offlineCapable`: Whether the app remains useful offline after local/static resources are available.
- `status`: Stability state.
- `metadata`: Compatibility and diagnostics metadata. Keep runtime behavior in typed fields, not here.

## Valid Values

`VatioAppKind`

```txt
core-app
tool-app
media-app
visualizer-app
background-service
system-app
```

`VatioAppSurface`

```txt
main-route
shell-window
start-menu
taskbar
launcher
background
app-manager
```

`VatioAppPermission`

```txt
gps.read
gps.highAccuracy
storage.app
storage.media
audio.playback
audio.background
cloud.sync
auth.session
alerts.speed
driveRecording.read
driveRecording.write
shell.window
shell.launchApp
network.backend
i18n.read
settings.read
settings.write
```

`VatioAppServiceId`

```txt
gps
audio
driveRecording
drivingAlerts
auth
cloudSync
shell
storage
i18n
settings
```

`settings` exposes both `runtime.services.settings` and `runtime.services.sharedSettings` when the matching permissions are granted.

`VatioAppStatus`

```txt
stable
beta
experimental
internal
```

`VatioAppWindowMode`

```txt
floating
fullscreen
panel
```

## Naming Conventions

- App id: `vatio.<name>`, usually camelCase after the dot for multi-word built-ins, for example `vatio.cameraMap`.
- Route: `/name`, kebab-case for new multi-word routes, for example `/offline-heartbeat`.
- Shell window id: kebab-case, for example `camera-map`.
- Folder: `src/apps/<kebab-name>/`.
- Storage keys: local to `runtime.storage`; do not prefix keys with app ids manually.
- Raw storage: document every raw `localStorage`, `sessionStorage`, or IndexedDB name in app docs.
- Metadata: compatibility shims only, such as `legacyToolId`, `legacyHref`, `legacyToolSurfaces`, `legacyShellKind`, or `protected`.

## Validation Rules

The registry calls `validateAppManifest()` before registration and rejects invalid manifests.

- Required string fields must be non-empty.
- `surfaces` must include at least one valid surface.
- `main-route` apps require `route`.
- `shell-window` apps require `window`.
- `window.shellWindowId`, `window.defaultBounds`, `window.capabilities`, `window.restoreOnBoot`, and `window.lazy` are required for shell-window apps.
- Duplicate app ids are rejected.
- Duplicate routes and aliases are rejected.
- Duplicate shell window ids are rejected.
- Duplicate legacy tool ids are rejected.
- Unknown permissions are rejected.
- Unknown services are rejected.
- `localFirst`, `teslaOptimized`, and `offlineCapable` must be booleans.
- `metadata` is required.
- `gps.highAccuracy` should also declare `gps.read`.
- `driveRecording.write` should also declare `driveRecording.read`.
- `auth` service access requires both `auth.session` and `network.backend`.
- `cloudSync` service access requires both `cloud.sync` and `network.backend`.
- `runtime.shell.openApp()`, `openAppAsync()`, `closeApp()`, and `focusApp()` require `services: ["shell"]` as well as `shell.launchApp`.

Warnings still allow registration today, but new apps should treat warnings as defects.
