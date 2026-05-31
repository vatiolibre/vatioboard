# Create A Background Service

Background services are lifecycle-managed apps without visible UI. They are useful for local diagnostics, preload coordination, offline readiness checks, or other work that should belong to an app runtime but should not render a route or shell window.

Background services are managed by `createBackgroundServiceManager()` in `src/app-platform/background-services.ts`.

Start with:

```bash
pnpm run create:app -- background offline-heartbeat
```

## Entry Contract

A background service may have no `entry`, in which case the manager preserves the existing lifecycle-only behavior: create runtime, mount, activate, suspend/resume/stop lifecycle.

When a manifest has `entry`, that module may export `createBackgroundServiceApp()`:

```ts
import type { VatioAppRuntime } from "../../app-platform/types";

export interface VatioBackgroundServiceApp {
  start?(): void | Promise<void>;
  suspend?(): void | Promise<void>;
  resume?(): void | Promise<void>;
  stop?(): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

export interface VatioBackgroundServiceAppModule {
  createBackgroundServiceApp?: (options: {
    runtime: VatioAppRuntime;
    signal?: AbortSignal;
  }) => VatioBackgroundServiceApp | Promise<VatioBackgroundServiceApp>;
}
```

The manager exposes `startAsync(appId)` for tests and callers that need to wait for entry loading. The existing `start(appId)` remains synchronous for App Manager and shell code; it starts lifecycle-only services immediately and kicks off entry loading for services with async entries.

The manager also exposes `stopAsync(appId)` for services that need async cleanup. The existing `stop(appId)` remains synchronous and starts the async stop path in the background. Use `stopAsync(appId)` when callers must know cleanup has finished.

## Lifecycle

- `start` or `startAsync`: ensure runtime, import `manifest.entry` when present, call `createBackgroundServiceApp()`, call `service.start()` when available, then cache the service, mount, and activate the runtime.
- `startAsync`: resolves `false` when entry import, factory creation, or `service.start()` fails. Failed starts clean up the controller, service instance, and runtime so a later start can retry.
- `start` or `startAsync` during an in-progress stop never reuses the stopping service instance. `startAsync` waits for the stop/destroy cleanup to finish, then starts a fresh instance.
- `suspend`: call `service.suspend()` when available, then `runtime.lifecycle.suspend()`.
- `resume`: call `service.resume()` when available, then `runtime.lifecycle.resume()`.
- `stopAsync`: await `service.stop()`, await `service.destroy()`, abort the service signal, deactivate/unmount the runtime, and remove the runtime/service instance.
- `stop`: initiate `stopAsync()` and return whether a stop was started.
- `destroy`: unsubscribe from App Manager control events, initiate cleanup for all services, abort remaining controllers, and clear manager records.

Duplicate starts reuse the existing runtime and service instance.

`destroy()` is best-effort and fire-and-forget: it starts async cleanup, clears manager records synchronously, and does not return a promise. If a caller needs awaited service cleanup, call `stopAsync(appId)` before `destroy()`.

## Minimal Files

`src/apps/offline-heartbeat/index.ts`

```ts
export {
  OFFLINE_HEARTBEAT_APP_ID,
  createBackgroundServiceApp,
} from "./offline-heartbeat-service.js";
```

`src/apps/offline-heartbeat/offline-heartbeat-service.ts`

```ts
import type { VatioAppRuntime } from "../../app-platform/types";

export const OFFLINE_HEARTBEAT_APP_ID = "vatio.offlineHeartbeat";

export function createBackgroundServiceApp({
  runtime,
  signal,
}: {
  runtime: VatioAppRuntime;
  signal?: AbortSignal;
}) {
  let timer = 0;

  function writeHeartbeat() {
    runtime.storage.setItem("lastHeartbeatAt", new Date().toISOString());
  }

  function clear() {
    if (timer) window.clearInterval(timer);
    timer = 0;
  }

  signal?.addEventListener("abort", clear, { once: true });

  return {
    start() {
      writeHeartbeat();
      clear();
      timer = window.setInterval(writeHeartbeat, 60_000);
    },
    suspend() {
      clear();
    },
    resume() {
      this.start?.();
    },
    stop() {
      clear();
    },
    destroy() {
      clear();
    },
  };
}
```

`src/apps/offline-heartbeat/manifest.ts`

```ts
import { IconPages } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const offlineHeartbeatAppManifest = defineAppManifest({
  id: "vatio.offlineHeartbeat",
  title: "Offline Heartbeat",
  shortTitle: "Heartbeat",
  description: "Internal background heartbeat for local offline diagnostics.",
  kind: "background-service",
  version: "1.0.0",
  icon: IconPages,
  i18nKey: "offlineHeartbeat",
  entry: () => import("./index.js"),
  surfaces: ["background", "app-manager"],
  order: 220,
  permissions: ["storage.app", "i18n.read", "settings.read"],
  services: ["storage", "i18n", "settings"],
  lifecycle: {
    autostart: false,
    keepAlive: false,
    restoreOnBoot: false,
  },
  tags: ["system", "offline"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "internal",
  metadata: {},
});
```

## Cleanup Rules

Background services must clean up everything they start: timers, listeners, observers, streams, wake locks, network retry loops, and async work. Use the provided `signal` for service-owned abortable work.

If disabling an app in App Manager stops the service, the service must not leave work running after `stop()` or `destroy()`.

If `start()` allocates resources before it can fail, implement `destroy()` so the manager can clean up the partial service before retrying.
