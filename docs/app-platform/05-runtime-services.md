# Runtime Services

`VatioAppRuntime` is the scoped API an app receives from the platform.

Important rule: an app must declare both the permission and the service.

```ts
permissions: ["gps.read"],
services: ["gps"],
```

If permission exists but the service is missing, `runtime.services.gps` is `null`. If the service exists but permission is missing or revoked in App Manager, access is denied.

## Runtime Shape

- `runtime.appId`: Current app id.
- `runtime.manifest`: Current app manifest.
- `runtime.permissions`: Permission helper with `has()`, `require()`, and `list()`.
- `runtime.services`: Gated shared services.
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

### Cloud Sync

Manifest:

```ts
permissions: ["cloud.sync", "network.backend"],
services: ["cloudSync"],
```

`runtime.services.cloudSync` exposes status and request helpers for account-aware sync.

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

Use `runtime.shell.openApp()`, `openAppAsync()`, `closeApp()`, and `focusApp()` to work with other apps. `shell.window` is for shell-window ownership; `shell.launchApp` is for launching/focusing apps.

### Storage

Manifest:

```ts
permissions: ["storage.app"],
services: ["storage"],
```

Use `runtime.storage` for simple app-private state. It is local-first and namespaced automatically.

### i18n

Manifest:

```ts
permissions: ["i18n.read"],
services: ["i18n"],
```

Use `runtime.i18n.t()`, `apply()`, `getLanguage()`, and `subscribe()` for app-visible copy.

## Storage Choices

- Use `runtime.storage` for simple private state.
- Use `runtime.services.settings` for app preferences.
- Use `runtime.services.sharedSettings` for shared OS preferences.
- Use IndexedDB through an app-owned wrapper for large structured records, media metadata, or query-heavy data.
- Use direct `localStorage` only for legacy compatibility or migrations, and document the keys.

