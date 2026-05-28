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
- Automatic dependency injection into legacy shell-window UI modules

## Future Direction

- Move each core app gradually into `src/apps/<app-id>`.
- Replace global compatibility shims with runtime services.
- Add app install/enable/disable preferences.
- Add VatioLibre-backed app storage after the local contract is stable.
- Add permission prompts only when non-core apps exist.
- Add signed community bundles after internal architecture matures.
- Add app-to-app messaging later.
