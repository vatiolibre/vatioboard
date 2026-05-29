# VatioBoard OS

VatioBoard OS is the internal platform layer that lets VatioBoard apps run inside the browser shell through a stable app contract. It keeps the current Vite + TypeScript + vanilla module architecture, but moves route apps, shell-window tools, service access, storage, i18n, lifecycle, and launch behavior behind one manifest-driven model.

The first version is intentionally internal-only. It does not add external app installation, sandboxed iframes, signed bundles, or new cloud dependencies.

## Why It Exists

The old app shape worked, but every new feature had to wire itself into routes, tools, shell windows, translations, storage, and shared services separately. The OS layer makes app creation repeatable:

- Declare an app once in `src/app-platform/builtin-apps.ts`.
- Derive legacy route, tool, and shell-window registries through adapters.
- Receive an app-scoped runtime when route apps mount or shell-window apps open.
- Use app-private storage instead of direct localStorage keys.
- Ask for platform services through declared service IDs and permissions.

## App Manifests

Manifests use `VatioAppManifest` from `src/app-platform/types.ts`. Required fields include identity, title, kind, version, icon, route or window surface, permissions, services, local-first flags, status, and metadata.

Current built-in manifests cover:

- `vatio.speed`
- `vatio.board`
- `vatio.library`
- `vatio.replay`
- `vatio.accel`
- `vatio.appManager`
- `vatio.calculator`
- `vatio.energy`
- `vatio.cameraMap`
- `vatio.speedAlerts`
- `vatio.player`
- `vatio.milkdrop`

The manifest registry is now the authoritative inventory. Compatibility adapters produce the existing `routeRegistry`, `toolRegistry`, and `shellWindowRegistry` exports.

Manifest validation rejects unsupported app kinds, surfaces, permissions, and service IDs. The runtime registry also rejects duplicate app IDs, route paths, aliases, shell-window IDs, and legacy tool IDs so one manifest cannot accidentally shadow another.

## Services

`manifest.services` is enforced, not just descriptive metadata. Runtime service exposure requires both a declared service ID and the matching permission.

Examples:

- GPS requires `services: ["gps"]` and `gps.read`.
- App storage requires `services: ["storage"]` and `storage.app`.
- App i18n requires `services: ["i18n"]` and `i18n.read`.
- App settings require `services: ["settings"]` plus `settings.read` or `settings.write`.
- Auth and cloud sync require their service IDs plus their permissions.

If a manifest declares a permission but omits the service ID, the runtime returns the same safe denied values it uses for missing permissions and logs a scoped warning.

## Permissions

Permissions are declared in each manifest and checked by `createAppPermissionRuntime()`.

For v1, internal apps are auto-granted the permissions they declare. The runtime still denies undeclared permissions. A denied permission returns a safe value and logs a scoped warning instead of crashing the shell.

Examples:

- `gps.read` exposes the GPS service.
- `gps.highAccuracy` allows high-accuracy GPS requests.
- `storage.app` enables app-private storage.
- `i18n.read` enables localized string reads and DOM localization.
- `settings.read` and `settings.write` enable app-scoped settings.
- `shell.launchApp` allows runtime shell launching.
- `cloud.sync` exposes cloud sync helpers lazily.

## App Storage

`createAppStorage()` stores simple values and JSON under:

```text
vatioboard.app.<appId>.<key>
```

The v1 backend is localStorage. App-facing storage operations are gated by the `storage` service declaration and `storage.app`; denied reads return `null` or the provided fallback, and denied writes return `false`.

The API is intentionally small so it can later move to IndexedDB or VatioLibre cloud storage:

- `getItem()`
- `setItem()`
- `removeItem()`
- `getJson()`
- `setJson()`
- `listKeys()`
- `clearAppStorage()`
- `estimateUsage()`

JSON reads are safe: invalid JSON returns the caller-provided fallback.

## App Settings

`runtime.services.settings` is the v1 app-scoped settings service. It stores values in app-private storage under a reserved settings namespace:

```text
vatioboard.app.<appId>.settings.<key>
```

Settings exposure requires the `settings` service declaration. Reads require `settings.read`. Writes, removals, and JSON writes require `settings.write`. The current API is:

- `get(key, fallback?)`
- `set(key, value)`
- `remove(key)`
- `getJson(key, fallback)`
- `setJson(key, value)`
- `subscribe(listener)`

The service is deliberately app-scoped. It does not expose raw shared settings or global localStorage.

## App I18n

`runtime.i18n` wraps the existing global i18n helper. `getLanguage()`, `t()`, `apply()`, `subscribe()`, and `toggleLanguage()` require the `i18n` service declaration and `i18n.read` in the app manifest. Denied reads return the fallback or the key, and denied subscriptions return a no-op unsubscribe function.

## App Runtime

Routes now receive:

```ts
routeContext.context.appManifest
routeContext.context.appRuntime
```

The old route fields still exist:

- `gpsService`
- `drivingAlertService`
- `driveRecordingService`
- `audioRuntime`
- `route`
- `routeSignal`
- `navigate`
- `emitRouteVisible`

The new runtime exposes:

- `runtime.appId`
- `runtime.manifest`
- `runtime.permissions`
- `runtime.services`
- `runtime.shell`
- `runtime.storage`
- `runtime.i18n`
- `runtime.lifecycle`
- `runtime.logger`

Shell-window apps receive the same runtime shape. The app shell owns `shellAppRuntimeManager`, which creates and caches runtimes by app ID when shell-window apps are opened, restored, focused, or launched. It also maps practical window state changes to lifecycle calls.

For the next migration pass, a shell-window module can retrieve its runtime from the injected route context:

```ts
const runtime =
  routeContext.context.shellAppRuntimeManager?.getRuntime("vatio.calculator") ??
  routeContext.context.shellAppRuntimeManager?.ensureRuntime("vatio.calculator");
```

Launchers also expose `getAppRuntime(appId)` for code that already has a `VatioAppShellRuntime`.

## Migrated Shell Apps

Calculator and Energy were the first migrated shell-window app modules. Their manifests remain `vatio.calculator` and `vatio.energy`; their shell window IDs remain `calculator` and `energy`; their legacy tool IDs remain `calculator` and `energy`.

The first-class app wrapper lives in `src/apps/calculator/` and adapts the existing `src/calculator/calculator-widget.ts` implementation instead of duplicating the UI. The wrapper resolves the scoped runtime through `shellAppRuntimeManager`, then supplies the widget with:

- `runtime.services.settings` for Calculator preferences under the app setting key `preferences`.
- `runtime.i18n.t()` for Calculator labels where the wrapper can provide translation.
- `runtime.logger` for settings fallback warnings.

For compatibility, Calculator preference writes are mirrored to the legacy `embeddable_calc_settings_v1` key so Energy and direct legacy consumers keep seeing the same formatter settings. Calculator expression state, history, position, visibility, shell layout, and taskbar behavior still use their existing legacy storage and shell-window paths.

The first-class Energy wrapper lives in `src/apps/energy/` and adapts the existing `src/energy/energy-calculator-widget.ts` implementation. The wrapper resolves the scoped `vatio.energy` runtime, then supplies Energy with:

- `runtime.services.settings` for trip preferences under `tripCostSettings`.
- `runtime.services.settings` for Energy number-format preferences under `numberFormat`.
- `runtime.i18n.t()` for top-level Energy panel labels where the wrapper can provide translation.
- `runtime.logger` for settings fallback warnings.

Energy runtime settings are stored under:

```text
vatioboard.app.vatio.energy.settings.tripCostSettings
vatioboard.app.vatio.energy.settings.numberFormat
```

For compatibility, Energy mirrors trip preferences to `energy_trip_cost_settings_v1` and mirrors number-format preferences to the shared legacy `embeddable_calc_settings_v1` key. Energy trip values, multi-trip data, position, visibility, shell layout, and taskbar behavior still use their existing legacy storage and shell-window paths.

## Shared Number Formatting

Calculator and Energy intentionally share decimal and thousands-separator settings in v1. The canonical source remains the legacy shared key:

```text
embeddable_calc_settings_v1
```

The helper in `src/apps/shared/number-format-settings.ts` loads that key first and treats app-private runtime settings as mirrors/diagnostics. Calculator still mirrors to `vatioboard.app.vatio.calculator.settings.preferences`; Energy still mirrors to `vatioboard.app.vatio.energy.settings.numberFormat`. If both app-private runtime settings and the legacy shared key exist, the legacy shared key wins so stale app-private mirrors cannot make Calculator and Energy diverge. If the legacy key is missing but a runtime mirror exists, the helper can seed the legacy key so direct widget callers continue to work.

## Camera Map Migration

Camera Map is now wrapped as a first-class shell-window app module in `src/apps/camera-map/`. The wrapper adapts the existing `src/speed/camera-map-widget.ts` implementation instead of duplicating the map UI or changing the shell-window contract.

The manifest remains `vatio.cameraMap`; the shell window ID remains `camera-map`; the legacy tool ID remains `camera-map`. The manifest entry is:

```ts
entry: () => import("../apps/camera-map/index.js")
```

The wrapper resolves the scoped runtime through `shellAppRuntimeManager`, then supplies the widget with:

- `runtime.services.gps` when the runtime has declared GPS service access.
- The legacy injected `gpsService` or global GPS readers when runtime GPS is unavailable.
- `runtime.services.settings` for Camera Map preferences while preserving legacy localStorage keys.
- `runtime.logger` for settings fallback warnings.

Camera Map requests high-accuracy GPS while open, so its manifest includes both `gps.read` and `gps.highAccuracy`. If runtime GPS is missing, the widget still falls back to the existing `gpsService`, `window.__vatioboardGpsGetCurrentPosition`, and `window.__vatioboardSpeedGetCurrentPosition` paths used by standalone/dev harnesses and older integrations.

Camera Map settings are mirrored under:

```text
vatioboard.app.vatio.cameraMap.settings.<key>
```

The v1 wrapper preserves these legacy preference keys for compatibility:

```text
vatioboard:camera-map:basemap
vatioboard.cameraMap.follow.v1
vatioboard.cameraMap.orientation.v1
vatioboard.cameraMap.projection.v1
vatioboard.cameraMap.approachLayer.v1
vatioboard.cameraMap.approachFilter.v1
```

Legacy values win when both legacy and app-private runtime settings exist, so stale app-private mirrors cannot permanently shadow a user's existing Camera Map preferences. If a legacy value is missing but a runtime mirror exists, the wrapper seeds the legacy key so direct `createCameraMapWidget()` callers continue to behave as before.

## Speed Alerts Migration

Speed Alerts is now wrapped as a first-class shell-window app module in `src/apps/speed-alerts/`. The wrapper adapts the existing `src/speed/speed-alert-panel.ts` panel and driving-alert service contract instead of duplicating the alert UI or rewriting audio/GPS behavior.

The manifest remains `vatio.speedAlerts`; the shell window ID remains `speed-alerts`; the legacy tool ID remains `speed-alerts`. The manifest entry is:

```ts
entry: () => import("../apps/speed-alerts/index.js")
```

The wrapper resolves the scoped runtime through `shellAppRuntimeManager`, then supplies the panel with:

- `runtime.services.gps` when the runtime has declared GPS service access.
- `runtime.services.drivingAlerts` when available, preserving the existing app-level driving-alert service.
- The injected `gpsService` / `drivingAlertService` or legacy globals when runtime services are unavailable.
- `runtime.services.settings` for Speed Alerts preferences while preserving legacy localStorage keys.
- `runtime.logger` for settings fallback warnings.

Speed Alerts keeps the existing audio controller and audio priming path inside `createDrivingAlertService()`. The wrapper exposes `runtime.services.audio` through the manifest contract but does not reroute alert sounds directly through the app runtime in v1, which avoids changing background audio lease behavior.

Speed Alerts settings mirror under:

```text
vatioboard.app.vatio.speedAlerts.settings.preferences
```

The v1 wrapper preserves these legacy preference keys for compatibility:

```text
vatio_speed_unit
vatio_speed_distance_unit
vatio_speed_alert_enabled
vatio_speed_alert_limit_ms
vatio_speed_alert_sound_enabled
vatio_speed_audio_muted
vatio_speed_trap_alert_enabled
vatio_speed_trap_alert_distance_m
vatio_speed_trap_sound_enabled
```

Direct `createSpeedAlertPanel()` callers still work without a runtime. The Speed Alerts Camera Map button still opens/focuses Camera Map through the existing callback path; when no callback is supplied, the wrapper prefers `runtime.shell.openApp("vatio.cameraMap")` and then falls back to the shell window manager/global floating tools path.

## Player Migration

Player is now wrapped as a first-class shell-window app module in `src/apps/player/`. The wrapper adapts the existing persistent `src/player/player-widget.ts` implementation instead of duplicating playback UI or changing the shared audio runtime.

The manifest remains `vatio.player`; the shell window ID remains `player`; the legacy tool ID remains `player`. The manifest entry is:

```ts
entry: () => import("../apps/player/index.js")
```

The app shell now creates the persistent player through `createPlayerApp()`, passing the shell app runtime manager so the wrapper can resolve the scoped `vatio.player` runtime. The existing widget still owns:

- Queue and session restore through `vatioboard_player_session_v2`.
- The shared `audio-runtime` singleton.
- Media Session metadata/action behavior.
- Background audio keepalive behavior.
- Local/offline pinned media resolution.
- Shell window registration, taskbar state, position, visibility, minimize, restore, and close behavior.

The wrapper uses `runtime.services.audio` at the app boundary to keep Media Session enabled when the runtime exposes the audio service. The widget itself continues to import the same shared audio runtime singleton, so there is no second audio engine and no queue/session split.

Player visualizer settings are the only Player preferences mirrored through runtime settings in this pass:

```text
vatioboard.app.vatio.player.settings.visualizerVisible
vatioboard.app.vatio.player.settings.visualizerMode
```

The legacy visualizer keys remain canonical for v1:

```text
vatio_board_player_widget_visualizer_visible
vatio_board_player_widget_visualizer_mode
```

If both legacy values and app-private runtime mirrors exist, legacy values win so direct `createPlayerWidget()` callers and older sessions cannot be shadowed by stale runtime mirrors. If no legacy value exists but a runtime mirror does, the wrapper seeds the legacy key.

Player position, visibility, queue/session restore, pinned media, local media cache, and playlist/cache state intentionally remain on existing legacy storage paths for compatibility.

## Launching Apps

`createAppLauncher()` implements v1 shell launching:

- Route apps navigate to their manifest route.
- Shell-window apps create an app runtime, restore if minimized, then focus or open their shell window.
- Background apps can be registered but have no heavy lifecycle yet.

The start menu still supports the legacy toggles for existing floating tools, but it now prefers the manifest-backed launcher when an app can be resolved from a legacy tool ID.

## Creating A New Internal App

1. Add a manifest to `src/app-platform/builtin-apps.ts`.
2. Choose surfaces such as `main-route`, `shell-window`, `start-menu`, `taskbar`, or `launcher`.
3. Declare permissions and services.
4. For route apps, add an `entry` lazy loader and route view.
5. For shell-window apps, declare `window.shellWindowId`, default bounds, capabilities, and restore behavior.
6. Prefer `routeContext.context.appRuntime` for route app platform APIs.
7. For shell-window apps, retrieve the runtime from `routeContext.context.shellAppRuntimeManager` while the legacy shell-window UI is being migrated.
8. Use `runtime.storage` for app data and `runtime.services.settings` for user preferences.
9. Add focused tests for registry, runtime, lifecycle, and UI behavior.

## App Manager

The internal App Manager is available at:

```text
#/apps
```

It lists installed apps, kind, status, surfaces, permissions, local-first/offline/Tesla flags, and launch/open actions.

## Not Implemented Yet

- External/community app installation
- Permission prompts for non-core apps
- Signed app bundles
- Sandboxed iframe apps
- Cloud-backed app-private storage
- App enable/disable preferences
- App-to-app messaging
- Service worker or background resilience changes
- Full background-service runtime scheduling
- Automatic dependency injection into every legacy shell-window UI module

## Future Direction

- Move each core app gradually into `src/apps/<app-id>`.
- Replace global compatibility shims with runtime services.
- Add app install/enable/disable preferences.
- Add VatioLibre-backed app storage after the local contract is stable.
- Add permission prompts only when non-core apps exist.
- Add signed community bundles after internal architecture matures.
- Add app-to-app messaging later.
