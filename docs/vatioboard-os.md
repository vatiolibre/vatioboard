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

Runtime revocation is method-level for service gateways that can be held by running apps. `audio`, `drivingAlerts`, `auth`, `cloudSync`, `settings`, and `sharedSettings` keep their runtime object shape after creation, but every operation checks the current effective permission before doing work. Revoked operations return safe denied values such as `false`, `null`, `{}`, no-op unsubscribe functions, or a permission-denied snapshot, and they log scoped warnings through the app logger. This means App Manager permission changes affect already-created shell-window runtimes without requiring a window recreation.

## Permissions

Permissions are declared in each manifest and checked by `createAppPermissionRuntime()`.

For v1, declared built-in app permissions are auto-granted by default for compatibility, but the app control plane can revoke individual permissions. The effective permission set is:

```text
manifest.permissions ∩ app-control grants
```

with stable/internal/beta/experimental built-ins receiving their declared permissions unless a permission is explicitly revoked. The runtime still denies undeclared permissions, and App Manager refuses to grant a permission that the manifest did not declare. A denied permission returns a safe value and logs a scoped warning instead of crashing the shell.

Protected apps also have protected critical permissions that cannot be revoked. The initial v1 policy is:

- `vatio.speed`: `gps.read`, `gps.highAccuracy`, `storage.app`, `i18n.read`, `shell.launchApp`
- `vatio.appManager`: `storage.app`, `i18n.read`, `settings.read`, `shell.launchApp`
- `vatio.offlineReadiness`: `storage.app`, `i18n.read`, `settings.read`

`appControl.revokePermission()` returns `false` for those protected critical permissions. Older stored control records that deny a protected critical permission are normalized back to the protected default. Non-critical permissions on protected apps can still be revoked intentionally.

Examples:

- `gps.read` exposes the GPS service.
- `gps.highAccuracy` allows high-accuracy GPS requests.
- `storage.app` enables app-private storage.
- `i18n.read` enables localized string reads and DOM localization.
- `settings.read` and `settings.write` enable app-scoped settings.
- `shell.launchApp` allows runtime shell launching.
- `cloud.sync` exposes cloud sync helpers lazily.

## App Control State

App control state lives separately from manifests in:

```text
vatioboard.os.appControl.v1
```

The manifest registry remains the source of truth for available apps. The control plane stores user/system state such as enabled, pinned, favorite, hidden-from-start-menu, last opened time, launcher open count, permission grants/revocations, and storage policy.

Protected system apps cannot be disabled when that would make the shell unusable. In v1 this protects at least:

- `vatio.speed`
- `vatio.appManager`
- protected internal background diagnostics such as `vatio.offlineReadiness`

Launchers, runtime `shell.openApp()`, route adapters, App Manager, and Start Menu all consult app control state before launching. Disabling a shell-window app from App Manager closes its window if it is running. Disabled route apps are redirected back to Speed when reached through the app shell.

Pinned and favorite state are active: App Manager sorts pinned apps first, then favorites, and Start Menu puts pinned apps before unpinned apps. `hiddenFromStartMenu` is active for non-protected apps; it hides Start Menu entries while keeping the app visible in App Manager. Protected apps cannot be hidden. `storagePolicy` is reserved metadata in v1 and is not presented as an active behavior or enforcement control.

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

The storage module also exposes v1 diagnostics helpers for App Manager:

- `listAppPrivateStorageKeys(appId)`
- `estimateAppPrivateStorage(appId)`
- `clearAppPrivateStorage(appId)`
- `exportAppPrivateStorage(appId)`
- `importAppPrivateStorage(appId, json)`

These helpers only touch `vatioboard.app.<appId>.*` keys. App control state, shell layout, large legacy payloads, player queues, media cache, drawings, replay sessions, acceleration histories, and camera offline data are not erased by an app-private reset unless a future migration intentionally moves them behind an app-private adapter.

App Manager labels this surface as "App-private storage", requires confirmation before reset, and repeats that legacy app data such as drawings, replay sessions, media cache, player queues, and shell layout are not cleared there.

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

The service is deliberately app-scoped. It does not expose raw global localStorage.

## Shared Settings

Cross-app settings that are intentionally shared now live behind `runtime.services.sharedSettings` and the singleton shared-settings service. The v1 storage key is:

```text
vatioboard.os.sharedSettings.v1
```

Shared settings are distinct from app-private settings. They cover small OS-wide preferences such as speed unit, distance unit, trip distance unit, number-format defaults, language, UI density, in-vehicle mode, audio defaults, and camera alert defaults.

Compatibility rule for migrated settings:

1. Existing legacy value wins.
2. The shared setting is mirrored from legacy.
3. If no legacy value exists but an explicit shared setting exists, the legacy key is seeded so direct/dev callers continue to work.

"Explicit shared setting" means a key present in `vatioboard.os.sharedSettings.v1`. Default-filled reads from `sharedSettings.get()` are not used for legacy seeding, so a default speed or distance unit cannot create legacy keys before the user or bootstrap flow has stored a real shared value.

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

Shell-window app entries now use a stable v1 cold-launch contract. A shell-window app entry module should export:

```ts
export function createShellWindowApp(options) {
  return createSpecificApp(options);
}
```

`createAppLauncher().openApp(appId)` can use that entry when the shell window is not registered yet. The launcher ensures the scoped runtime, dynamically imports `manifest.entry`, calls `createShellWindowApp({ mount, shellManager, shellAppRuntimeManager, runtime })`, and then opens or focuses the registered shell window. In-flight lazy loads are cached per shell manager and app ID, so repeated cold launch calls before the import settles create only one panel.

Existing app-specific exports such as `createPlayerApp()` and `createMilkdropApp()` remain supported for direct callers. `createShellWindowApp()` is the generic manifest entry contract.

A shell-window module can retrieve its runtime from the injected shell runtime manager:

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

## Milkdrop Migration

Milkdrop is now wrapped as a first-class shell-window app module in `src/apps/milkdrop/`. The wrapper adapts the existing `src/player/milkdrop-panel.ts` panel instead of rewriting the visualizer, WebGL canvas, preset loading, or shared audio graph behavior.

The manifest remains `vatio.milkdrop`; the shell window ID remains `milkdrop`; the legacy tool ID remains `milkdrop`. The manifest entry is:

```ts
entry: () => import("../apps/milkdrop/index.js")
```

Player's Milkdrop button now lazy-loads the Milkdrop app wrapper instead of importing the raw panel directly. This keeps the Butterchurn visualizer path lazy while allowing the wrapper to resolve the scoped `vatio.milkdrop` runtime through `shellAppRuntimeManager`.

The wrapper uses:

- `runtime.services.audio` at the app boundary to acknowledge the shared audio runtime without replacing the existing `audio-runtime` singleton or audio graph.
- `runtime.services.settings` for safe visibility mirroring under `visible`.
- `runtime.i18n.t()` for panel labels where the wrapper can provide translation.
- `runtime.logger` for settings/audio fallback warnings.

Milkdrop visibility mirrors under:

```text
vatioboard.app.vatio.milkdrop.settings.visible
```

The legacy visibility key remains canonical for v1:

```text
milkdrop_panel_visible_v1
```

If both the legacy key and app-private runtime mirror exist, the legacy key wins so stale runtime settings cannot shadow direct `createMilkdropPanel()` callers. If no legacy key exists but a runtime mirror does, the wrapper seeds the legacy key. Milkdrop position, size, preset name, canvas/WebGL lifecycle, and shared audio graph behavior intentionally remain on the existing legacy paths:

```text
milkdrop_panel_pos_v1
milkdrop_panel_size_v1
milkdrop_preset_name_v1
```

Direct `createMilkdropPanel()` callers still work without a runtime.

## Speed Route Migration

Speed is now the first route app moved behind a first-class app wrapper. The manifest `vatio.speed` still owns the `/` route and `/speed` alias, but its entry now points at:

```ts
entry: () => import("../apps/speed/index.js")
```

The compatibility view `src/app/views/SpeedView.ts` remains as a re-export for older direct imports. The app wrapper in `src/apps/speed/` keeps the existing `src/speed/speed.ts` controller and `speed-template` UI intact.

The wrapper adapts the normal route mount context before calling `mountSpeedRoute()`:

- `runtime.storage` is exposed as `routeContext.appStorage` for future app-private seams.
- `runtime.services.gps` is provided as `routeContext.gpsService` when available.
- `runtime.services.driveRecording` is provided as `routeContext.driveRecordingService` for future recording seams.
- `runtime.services.drivingAlerts` is provided as `routeContext.drivingAlertService`.
- `runtime.services.settings` is exposed as `routeContext.settingsService` as a read-capable future seam. Speed does not request `settings.write` because it does not write a runtime settings mirror today.
- `runtime.services.cloudSync` is exposed as `routeContext.cloudSyncService` for future safe seams.
- `runtime.i18n.t()` is exposed as a translation helper for future safe label seams.
- `runtime.logger` is exposed for non-fatal diagnostics.
- Legacy globals such as `window.__vatioboardGpsStore`, `window.__vatioboardDriveRecording`, and `window.__vatioboardDrivingAlerts` remain fallback sources for direct/dev harness callers.

Speed still uses its existing geolocation subscription path internally. In the SPA, that path is already routed through the installed GPS service shim, and keeping it there preserves the known coexistence behavior where Speed recording and Accel can hold concurrent route subscriptions without starving each other. Drive recording, replay persistence, acceleration interop, Speed Alerts, Camera Map, offline/local storage, and public Speed globals remain on the established legacy paths in this pass.

## Board Route Migration

Board is now wrapped as a first-class route app module. The manifest `vatio.board` still owns `#/board`, but its entry now points at:

```ts
entry: () => import("../apps/board/index.js")
```

The compatibility view `src/app/views/BoardView.ts` remains as a re-export for older direct imports. The app wrapper in `src/apps/board/` keeps the existing `src/board/board.ts` controller and `board-template` UI intact.

The wrapper adapts the normal route mount context before calling `mountBoardRoute()`:

- `runtime.storage` is exposed as `routeContext.appStorage` for future app-private seams.
- `runtime.services.settings` is exposed as `routeContext.settingsService`.
- `runtime.services.auth` is exposed as `routeContext.authService`.
- `runtime.services.cloudSync` is exposed as `routeContext.cloudSyncService`.
- `runtime.i18n.t()` is exposed as a translation helper for future safe label seams.
- `runtime.logger` is exposed for non-fatal diagnostics.

Board's local draft/canvas persistence, IndexedDB/localStorage drawing storage, cloud sync helpers, auth helpers, drawing controls, export/import behavior, and direct/dev route usage intentionally remain on the existing legacy paths in this pass.

One low-risk preference is mirrored through the runtime settings service: the ink color. The legacy key remains canonical for v1:

```text
vatio_board_ink_raw
```

The runtime mirror lives at:

```text
vatioboard.app.vatio.board.settings.inkRaw
```

If both keys exist, the legacy key wins so stale app-private runtime settings cannot shadow direct Board callers. If no legacy key exists but a runtime mirror does, Board seeds the legacy key for compatibility.

## Library Route Migration

Library is now wrapped as a first-class route app module. The manifest `vatio.library` still owns `#/library`, but its entry now points at:

```ts
entry: () => import("../apps/library/index.js")
```

The compatibility view `src/app/views/LibraryView.ts` remains as a re-export for older direct imports. The app wrapper in `src/apps/library/` keeps the existing `src/library/library.ts` controller and `library-template` UI intact.

The wrapper adapts the normal route mount context before calling `mountLibraryRoute()`:

- `runtime.storage` is exposed as `routeContext.appStorage` for future app-private seams.
- `runtime.services.settings` is exposed as `routeContext.settingsService`.
- `runtime.services.auth` is exposed as `routeContext.authService`.
- `runtime.services.cloudSync` is exposed as `routeContext.cloudSyncService`.
- `runtime.i18n.t()` is exposed as a translation helper for future safe label seams.
- `runtime.logger` is exposed for non-fatal diagnostics.

Library's local/offline media cache, pinned media, downloads, playlist/media loading, backend auth, cloud sync, import/export actions, and direct/dev route usage intentionally remain on the existing legacy paths in this pass.

One low-risk preference is mirrored through the runtime settings service: the active Library tab. The route query remains canonical for v1:

```text
#/library?tab=media
```

The runtime mirror lives at:

```text
vatioboard.app.vatio.library.settings.activeTab
```

If a `tab` query parameter is present, it wins over any stale runtime mirror and updates the mirror. If no `tab` query exists but a runtime mirror does, Library uses the mirrored tab. Direct callers without an app runtime still follow the existing route-query/default behavior.

## Replay Route Migration

Replay is now wrapped as a first-class route app module. The manifest `vatio.replay` still owns `#/replay`, but its entry now points at:

```ts
entry: () => import("../apps/replay/index.js")
```

The compatibility view `src/app/views/ReplayView.ts` remains as a re-export for older direct imports. The app wrapper in `src/apps/replay/` keeps the existing `src/replay/replay.ts` controller and `replay-template` UI intact.

The wrapper adapts the normal route mount context before calling `mountReplayRoute()`:

- `runtime.storage` is exposed as `routeContext.appStorage` for future app-private seams.
- `runtime.services.settings` is exposed as `routeContext.settingsService`.
- `runtime.services.auth` is exposed as `routeContext.authService`.
- `runtime.services.cloudSync` is exposed as `routeContext.cloudSyncService`.
- `runtime.services.driveRecording` is exposed as `routeContext.driveRecordingService`.
- `runtime.i18n.t()` is exposed as a translation helper for future safe label seams.
- `runtime.logger` is exposed for non-fatal diagnostics.

Replay's local replay/session history, cloud replay loaders, backend auth, cloud sync, map lifecycle, chart lifecycle, playback controls, and direct/dev route usage intentionally remain on the existing legacy paths in this pass.

One low-risk preference is mirrored through the runtime settings service: replay playback rate. The legacy key remains canonical for v1:

```text
vatio_replay_playback_rate_v1
```

The runtime mirror lives at:

```text
vatioboard.app.vatio.replay.settings.playbackRate
```

If both keys exist, the legacy key wins so stale app-private runtime settings cannot shadow direct Replay callers. If no legacy key exists but a runtime mirror does, Replay seeds the legacy key for compatibility. Large replay/session payloads remain on the existing replay storage keys and IndexedDB paths.

## Accel Route Migration

Accel is now wrapped as a first-class route app module. The manifest `vatio.accel` still owns `#/accel`, but its entry now points at:

```ts
entry: () => import("../apps/accel/index.js")
```

The compatibility view `src/app/views/AccelView.ts` remains as a re-export for older direct imports. The app wrapper in `src/apps/accel/` keeps the existing `src/accel/accel.ts` controller and `accel-template` UI intact.

The wrapper adapts the normal route mount context before calling `mountAccelRoute()`:

- `runtime.storage` is exposed as `routeContext.appStorage` for future app-private seams.
- `runtime.services.gps` is exposed as `routeContext.gpsService` when available.
- `runtime.services.settings` is exposed as `routeContext.settingsService`.
- `runtime.services.auth` is exposed as `routeContext.authService`.
- `runtime.services.cloudSync` is exposed as `routeContext.cloudSyncService`.
- `runtime.i18n.t()` is exposed as a translation helper for future safe label seams.
- `runtime.logger` is exposed for non-fatal diagnostics.

Accel's acceleration run lifecycle, GPS subscription behavior, local run history, replay/export behavior, cloud sync, backend auth, map lifecycle, chart lifecycle, and direct/dev route usage intentionally remain on the existing legacy paths in this pass.

One low-risk preference is mirrored through the runtime settings service: the selected acceleration preset. The existing Accel settings record remains canonical for v1:

```text
vatioboard.accel.settings
```

The runtime mirror lives at:

```text
vatioboard.app.vatio.accel.settings.selectedPresetId
```

If existing Accel settings are present in localStorage or IndexedDB, their `selectedPresetId` wins and updates the runtime mirror. If no legacy Accel settings exist but a runtime mirror does, Accel can seed the selected preset from that mirror and persist it back through the existing settings storage path. Acceleration run history, GPS sample arrays, replay payloads, cloud records, map state, and chart state remain on existing storage/controllers.

The Speed/Accel GPS coexistence smoke coverage now waits for the lazy Accel route wrapper to complete its geolocation subscription, yielding both microtasks and a normal timer task before emitting the first Accel sample. This matches the route-app timing model without changing the production GPS path.

## Route App Wrapper Contract

Core route apps use a consistent adapter contract:

- Each app has `src/apps/<app>/index.ts` and `src/apps/<app>/<app>-route-app.ts`.
- Each wrapper exports an app ID constant, `create<Route>RouteMountContext()`, `mount()`, and a route mount context type.
- The manifest `entry` points at the wrapper module.
- The legacy compatibility view in `src/app/views/*View.ts` re-exports `mount` from the wrapper.
- The wrapper only accepts `context.appRuntime` when `runtime.appId` matches the expected app ID.
- Direct/dev callers with no runtime still work and receive `null` app-runtime seams plus existing global/service fallbacks.
- Shared seam names are stable: `appRuntime`, `appManifest`, `appStorage`, `gpsService`, `driveRecordingService`, `drivingAlertService`, `settingsService`, `authService`, `cloudSyncService`, `translate`, and `logger`.
- Legacy controllers remain authoritative for UI and large persistence in v1.

### Route Runtime Seam Audit

| App | Runtime seams passed | Actively used today | Canonical legacy/fallback behavior |
| --- | --- | --- | --- |
| Speed | `appStorage`, `gpsService`, `driveRecordingService`, `drivingAlertService`, read-capable `settingsService`, `cloudSyncService`, `translate`, `logger` | `gpsService` and `drivingAlertService` are consumed by `src/speed/speed.ts`; other seams are future-safe. | GPS still flows through the existing navigator/geolocation shim and Speed globals. Recording/replay persistence and Speed preferences remain legacy. |
| Board | `appStorage`, `settingsService`, `authService`, `cloudSyncService`, `translate`, `logger` | `settingsService` and `logger` mirror ink color. | `vatio_board_ink_raw` remains canonical. Draft/canvas storage, IndexedDB chunks, cloud sync, auth, import/export, and offline mutations remain legacy. |
| Library | `appStorage`, `settingsService`, `authService`, `cloudSyncService`, `translate`, `logger` | `settingsService` and `logger` mirror active tab. | Route query `#/library?tab=...` remains canonical when present. Media cache, pinned media, downloads, playlists, auth, cloud sync, and import/export remain legacy. |
| Replay | `appStorage`, `settingsService`, `authService`, `cloudSyncService`, `driveRecordingService`, `translate`, `logger` | `settingsService` and `logger` mirror playback rate. | `vatio_replay_playback_rate_v1` remains canonical. Session history, cloud replay loading, map/chart lifecycle, and playback internals remain legacy. |
| Accel | `appStorage`, `gpsService`, `settingsService`, `authService`, `cloudSyncService`, `translate`, `logger` | `settingsService` and `logger` mirror selected preset. | `vatioboard.accel.settings` remains canonical. GPS watch internals, run history, replay/export payloads, map/chart lifecycle, auth, and cloud sync remain legacy. |

### Next Safe Seams

The next low-risk migrations should remain preference-sized:

- Speed: last selected speed/distance unit mirror, after validating shared unit behavior with Accel and Speed Alerts.
- Board: toolbar panel or grid/snap visibility, keeping drawing data untouched.
- Library: sort/filter/view mode preference, keeping media cache and pinned media untouched.
- Replay: dashboard axis or chart visibility, keeping replay/session payloads untouched.
- Accel: chart visibility or last selected result panel, keeping GPS samples and run history untouched.

## Launching Apps

`createAppLauncher()` implements v1 shell launching:

- Disabled apps return `false` and do not navigate/open.
- Route apps navigate to their manifest route.
- Shell-window apps create an app runtime, restore if minimized, then focus or open their shell window.
- If a shell-window app is not registered yet and has a lazy manifest entry, the launcher cold-loads the entry and calls `createShellWindowApp()` before opening it.
- Concurrent cold launches for the same app share the same in-flight load to avoid duplicate panels.
- If a window was already registered by a legacy/floating-tools path, the launcher reuses and focuses that existing window without loading another entry.
- Launcher attempts update app control `lastOpenedAt` and `openCount`.
- `openAppAsync(appId)` is available for callers that want to wait for lazy shell-window registration.
- `getRunningApps()` includes active route apps, open shell-window apps, and shell-window apps currently cold-launching.

The start menu now receives `shellAppRuntimeManager` from the app shell and uses the same manifest-backed launcher path as App Manager. It still supports legacy floating-tool fallbacks for compatibility, but disabled manifest apps are blocked before the fallback path can open them.

`openCount` is intentionally labeled as "Launcher opens" in App Manager. Direct initial route loads and browser refreshes do not increment it in v1, which avoids double-counting launcher navigation plus route mount.

## Background Services

Background-service manifests are supported conservatively in v1. `createBackgroundServiceManager()` scans internal background-service manifests, creates normal app runtimes, and starts only services with `lifecycle.autostart: true`.

Current behavior:

- No external app loading.
- No signed bundles or iframes.
- No new GPS watch, heavy loop, or cloud protocol.
- Lifecycle supports start, suspend, resume, stop, and destroy.
- Runtime diagnostics and lifecycle controls are visible in App Manager.
- Disabled non-protected background services do not autostart, and disabling a running background service stops it.

The first internal service is `vatio.offlineReadiness`, an autostart diagnostic runtime for local-first/offline readiness. It does not keep GPS active and does not change Speed/Accel GPS behavior.

## Creating A New Internal App

1. Add a manifest to `src/app-platform/builtin-apps.ts`.
2. Choose surfaces such as `main-route`, `shell-window`, `start-menu`, `taskbar`, or `launcher`.
3. Declare permissions and services.
4. For route apps, add an `entry` lazy loader and route view.
5. For shell-window apps, declare `window.shellWindowId`, default bounds, capabilities, and restore behavior.
6. Prefer `routeContext.context.appRuntime` for route app platform APIs.
7. For shell-window apps, export `createShellWindowApp(options)` from the manifest entry module and keep any app-specific direct export for compatibility.
8. Use `runtime.storage` for app data and `runtime.services.settings` for user preferences.
9. Add focused tests for registry, runtime, lifecycle, and UI behavior.

## App Manager

The internal App Manager is available at:

```text
#/apps
```

It is now the internal OS control panel. It lists installed apps, running count, kind, status, surfaces, permissions, local-first/offline/Tesla flags, launch/open/close actions, background-service controls, enable/disable state, pin/favorite/hidden state, permission grant toggles, app-private storage usage, app-private storage keys, confirmed app-private storage reset, storage JSON export/import, runtime lifecycle state, exposed runtime services, and protected-app explanations. Protected critical permission controls are disabled and marked as protected.

### Migrated Settings Table

| Area | Shared/runtime mirror | Canonical v1 source |
| --- | --- | --- |
| Speed unit | `vatioboard.os.sharedSettings.v1.speedUnit` | `vatio_speed_unit` |
| Speed distance unit | `vatioboard.os.sharedSettings.v1.distanceUnit` | `vatio_speed_distance_unit` |
| Calculator number format | `vatioboard.app.vatio.calculator.settings.preferences` | `embeddable_calc_settings_v1` |
| Energy number format | `vatioboard.app.vatio.energy.settings.numberFormat` | `embeddable_calc_settings_v1` |
| Energy trip settings | `vatioboard.app.vatio.energy.settings.tripCostSettings` | `energy_trip_cost_settings_v1` |
| Camera Map preferences | `vatioboard.app.vatio.cameraMap.settings.preferences` | existing Camera Map localStorage keys |
| Speed Alerts preferences | `vatioboard.app.vatio.speedAlerts.settings.preferences` | existing Speed Alerts/Speed preference keys |
| Player visualizer state | `vatioboard.app.vatio.player.settings.visualizer` | existing Player session/visibility keys |
| Milkdrop visibility | `vatioboard.app.vatio.milkdrop.settings.visibility` | existing Milkdrop preset/position/size keys |
| Board ink color | `vatioboard.app.vatio.board.settings.inkRaw` | `vatio_board_ink_raw` |
| Library active tab | `vatioboard.app.vatio.library.settings.activeTab` | route query `#/library?tab=...` |
| Replay playback rate | `vatioboard.app.vatio.replay.settings.playbackRate` | `vatio_replay_playback_rate_v1` |
| Accel selected preset | `vatioboard.app.vatio.accel.settings.selectedPresetId` | `vatioboard.accel.settings` |

### Manual QA Checklist

- Desktop: load `/`, open Start Menu, launch every route app.
- Desktop: open `#/apps`, search/filter apps, disable a non-protected app, confirm it cannot launch, re-enable it, launch it.
- Desktop: from `#/apps`, launch a route app and a shell-window app.
- Desktop: from Start Menu, launch the same shell-window app and confirm no duplicate panel/runtime is created.
- Desktop: reset app-private storage for a safe app and confirm global shell still works.
- Desktop: revoke one non-critical permission from a running shell-window app and confirm denied services fail safely without recreating the runtime.
- Mobile/Tesla: confirm `#/speed`, `#/board`, `#/library`, `#/replay`, `#/accel`, and `#/apps` fit without horizontal scrolling.
- Tesla: confirm Player keeps audio behavior across close/reopen and route changes, and Milkdrop still opens from Player.
- Offline: refresh `#/apps` and core local-first routes after first load.
- GPS coexistence: start Speed recording, navigate to Accel, confirm Accel receives GPS fixes while Speed recording stays active, then return to Speed and stop recording.

### Commands Run

- `pnpm run typecheck` passed.
- `pnpm run lint` passed with the existing 60 warning-level findings and 0 errors.
- `pnpm vitest run test/unit/app-control-platform.test.js test/unit/app-platform.test.js test/unit/app-shell-runtime-lifecycle.test.js test/unit/route-app-contract.test.js` passed, 4 files and 44 tests.
- `pnpm test` passed, 141 files and 1726 tests.
- `pnpm run build` passed. The build prepared 1291 ANSV camera features and 73930 speed cameras, then Vite built successfully with 1312 transformed modules. Vite still reports the existing dynamic/static import chunking warnings for backend auth, cloud sync, Player, Calculator, Camera Map, Energy, and Speed Alerts entries.

## Not Implemented Yet

- External/community app installation
- Permission prompts for non-core apps; grant/revoke is App Manager based in v1
- Signed app bundles
- Sandboxed iframe apps
- Cloud-backed app-private storage
- App-to-app messaging
- Service worker or background resilience changes
- Heavy background-service scheduling
- Automatic dependency injection into every legacy shell-window UI module

## Future Direction

- All current core route apps are now wrapped under `src/apps/<app-id>`: Speed, Board, Library, Replay, and Accel.
- Deepen route-app migrations gradually by replacing direct global/localStorage seams with runtime services behind compatibility adapters.
- Replace global compatibility shims with runtime services.
- Add VatioLibre-backed app storage after the local contract is stable.
- Add permission prompts only when non-core apps exist.
- Add signed community bundles after internal architecture matures.
- Add app-to-app messaging later.
