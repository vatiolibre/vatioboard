# Runtime Services

`VatioAppRuntime` is the scoped API an app receives from the platform.

Important rule: an app must declare both the permission and the service.

```ts
permissions: ["gps.read"],
services: ["gps"],
```

If permission exists but the service is missing, `runtime.services.gps` is `null`. If the service exists but permission is missing or revoked in App Manager, access is denied. Shell APIs follow the same rule: declare `services: ["shell"]`, then request the specific shell permission the app needs.

## Top-Level APIs Vs `runtime.services`

Manifest service IDs include `shell`, `storage`, and `i18n`, but those APIs are exposed as top-level runtime fields:

- Declare `services: ["shell"]`, then use gated capabilities on `runtime.shell`.
- Declare `services: ["storage"]`, then use `runtime.storage`.
- Declare `services: ["i18n"]`, then use `runtime.i18n`.

Do not use `runtime.services.shell`, `runtime.services.storage`, or `runtime.services.i18n`. They are not runtime service objects.

`runtime.services` currently contains shared service gateways for `gps`, `audio`, `driveRecording`, `drivingAlerts`, `auth`, `cloudSync`, `settings`, and `sharedSettings`.

## Runtime Shape

- `runtime.appId`: Current app id.
- `runtime.manifest`: Current app manifest.
- `runtime.permissions`: Permission helper with `has()`, `require()`, and `list()`.
- `runtime.services`: Gated shared service gateways.
- `runtime.shell`: App launcher and shell window access.
- `runtime.storage`: App-private storage under `vatioboard.app.<appId>.`.
- `runtime.i18n`: Translation and language helpers.
- `runtime.lifecycle`: Mounted/active/suspended/unmounted diagnostics.
- `runtime.logger`: App-scoped logger.
- `runtime.route`: Current route for route apps.
- `runtime.routeSignal`: Abort signal for current route work.

## Service Details

### GPS

Manifest:

```ts
permissions: ["gps.read", "gps.highAccuracy"],
services: ["gps"],
```

`runtime.services.gps` exposes the shared browser geolocation stream. High accuracy requests are downgraded when `gps.highAccuracy` is not granted.

### Audio

Manifest:

```ts
permissions: ["audio.playback", "audio.background"],
services: ["audio"],
```

`runtime.services.audio` exposes shared playback state and controls. Browser audio gesture rules still apply.

### Drive Recording

Manifest:

```ts
permissions: ["driveRecording.read", "driveRecording.write"],
services: ["driveRecording"],
```

Read permission allows snapshots/subscriptions/session reads. Write permission allows start, pause, resume, stop, and persistence calls.

### Driving Alerts

Manifest:

```ts
permissions: ["alerts.speed", "audio.playback"],
services: ["drivingAlerts", "audio"],
```

`runtime.services.drivingAlerts` controls overspeed and camera alert state through the app-level service.

### Auth

Manifest:

```ts
permissions: ["auth.session", "network.backend"],
services: ["auth"],
```

`runtime.services.auth` exposes backend session and feature access checks.

Both permissions are required. If `auth.session` is declared without `network.backend`, `runtime.services.auth` is `null`.

### Cloud Sync

Manifest:

```ts
permissions: ["cloud.sync", "network.backend"],
services: ["cloudSync"],
```

`runtime.services.cloudSync` exposes status and request helpers for account-aware sync.

Both permissions are required. If `cloud.sync` is declared without `network.backend`, `runtime.services.cloudSync` is `null`.

### Settings

Manifest:

```ts
permissions: ["settings.read", "settings.write"],
services: ["settings"],
```

`runtime.services.settings` is app-scoped settings storage. It is useful for preferences, not large records.

### Shared Settings

Manifest:

```ts
permissions: ["settings.read", "settings.write"],
services: ["settings"],
```

`runtime.services.sharedSettings` is exposed through the `settings` service declaration. Use it only for OS-wide preferences such as units, language, density, and shared audio defaults.

### Shell

Manifest:

```ts
permissions: ["shell.launchApp", "shell.window"],
services: ["shell"],
```

Use `runtime.shell.openApp()`, `openAppAsync()`, `closeApp()`, and `focusApp()` to work with other apps. `shell.window` is for shell-window ownership; `shell.launchApp` is for launching/focusing apps. There is no `runtime.services.shell`.

The shell object is always present for diagnostics such as `getRunningApps()`, but mutating shell capabilities are gated:

- `runtime.shell.openApp()`, `openAppAsync()`, `closeApp()`, and `focusApp()` return `false` unless the app declares `services: ["shell"]` and has `shell.launchApp`.
- `runtime.shell.shellManager` is `null` unless the app declares `services: ["shell"]` and has `shell.window`.
- Shell-window apps should declare `shell.window`; launcher/controller apps should declare `shell.launchApp`; apps that need both direct window ownership and app launching may declare both.

### Storage

Manifest:

```ts
permissions: ["storage.app"],
services: ["storage"],
```

Use `runtime.storage` for simple app-private state. It is local-first and namespaced automatically. There is no `runtime.services.storage`; the manifest service declaration gates the top-level storage API.

### i18n

Manifest:

```ts
permissions: ["i18n.read"],
services: ["i18n"],
```

Use `runtime.i18n.t()`, `apply()`, `getLanguage()`, and `subscribe()` for app-visible copy. There is no `runtime.services.i18n`; the manifest service declaration gates the top-level i18n API.

## Storage Choices

- Use `runtime.storage` for simple private state.
- Use `runtime.services.settings` for app preferences.
- Use `runtime.services.sharedSettings` for shared OS preferences.
- Use IndexedDB through an app-owned wrapper for large structured records, media metadata, or query-heavy data.
- Use direct `localStorage` only for legacy compatibility or migrations, and document the keys.
