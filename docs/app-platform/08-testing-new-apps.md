# Testing New Apps

Every app needs tests for its platform contract. Keep tests focused; avoid snapshots unless the output is intentionally stable and small.

## Required Coverage

- Manifest validation.
- Route registration if it is a route app.
- Shell-window launch if it is a shell-window app.
- Background service lifecycle if it is a background app.
- Storage namespacing.
- Permission gating.
- Service declaration gating.
- Shell launch gating when the app uses `runtime.shell`.
- `network.backend` gating when the app uses `auth` or `cloudSync`.
- Mount/unmount cleanup.
- Duplicate route/window id protection.
- Smoke route coverage for user-facing routes.

## Manifest Example

```js
import { describe, expect, it } from "vitest";
import { validateAppManifest } from "../../src/app-platform/manifest.js";
import { notesAppManifest } from "../../src/apps/notes/manifest.js";

describe("notes manifest", () => {
  it("validates", () => {
    expect(validateAppManifest(notesAppManifest)).toMatchObject({ ok: true });
  });
});
```

## Route Registration Example

```js
import { describe, expect, it } from "vitest";
import { createAppRegistry } from "../../src/app-platform/index.js";
import { getRouteRegistryFromApps } from "../../src/app-platform/adapters/route-registry-adapter.js";
import { notesAppManifest } from "../../src/apps/notes/manifest.js";

describe("notes route registration", () => {
  it("uses manifest-owned route data", () => {
    const registry = createAppRegistry({ logger: { warn() {} } });
    expect(registry.registerApp(notesAppManifest)).toBe(true);
    expect(notesAppManifest.route).toBe("/notes");
  });
});
```

For global built-ins, assert against `getRouteRegistryFromApps()` so the test covers the app registry and adapter together.

## Runtime Gating Example

```js
import { describe, expect, it } from "vitest";
import { createAppRuntime } from "../../src/app-platform/index.js";

describe("permission and service gates", () => {
  it("requires both permission and service declaration", () => {
    const runtime = createAppRuntime({
      manifest: {
        id: "test.gps",
        title: "GPS Test",
        shortTitle: "GPS",
        description: "Test",
        kind: "core-app",
        version: "1.0.0",
        icon: "<svg></svg>",
        i18nKey: "gpsTest",
        route: "/gps-test",
        surfaces: ["main-route"],
        order: 1,
        permissions: ["gps.read"],
        services: [],
        localFirst: true,
        teslaOptimized: true,
        offlineCapable: true,
        status: "experimental",
        metadata: {},
      },
      baseContext: { gpsService: { watchPosition() {}, clearWatch() {} } },
    });

    expect(runtime.permissions.has("gps.read")).toBe(true);
    expect(runtime.services.gps).toBeNull();
  });
});
```

## Cleanup Example

```js
import { describe, expect, it, vi } from "vitest";

describe("route cleanup", () => {
  it("removes listeners on unmount", () => {
    const button = document.createElement("button");
    const cleanup = [];
    const listener = vi.fn();

    button.addEventListener("click", listener);
    cleanup.push(() => button.removeEventListener("click", listener));
    cleanup.forEach((fn) => fn());

    button.click();
    expect(listener).not.toHaveBeenCalled();
  });
});
```

Prefer using the real `createCleanupStack()` or route test helpers when testing a route module.

## Background Service Example

For background services with entries, test both successful and failed lifecycle paths:

```js
import { describe, expect, it, vi } from "vitest";
import { createBackgroundServiceManager, createAppControlService, createAppRegistry } from "../../src/app-platform/index.js";

describe("background service lifecycle", () => {
  it("does not cache a failed start", async () => {
    const registry = createAppRegistry({ logger: { warn() {} } });
    registry.registerApp({
      id: "test.background",
      title: "Test Background",
      shortTitle: "Background",
      description: "Test",
      kind: "background-service",
      version: "1.0.0",
      icon: "<svg></svg>",
      i18nKey: "testBackground",
      entry: async () => ({
        createBackgroundServiceApp: () => ({
          start() {
            throw new Error("failed");
          },
          destroy: vi.fn(),
        }),
      }),
      surfaces: ["background", "app-manager"],
      order: 1,
      permissions: ["storage.app"],
      services: ["storage"],
      localFirst: true,
      teslaOptimized: true,
      offlineCapable: true,
      status: "experimental",
      metadata: {},
    });
    const manager = createBackgroundServiceManager({
      registry,
      control: createAppControlService({ registry }),
    });

    await expect(manager.startAsync("test.background")).resolves.toBe(false);
    expect(manager.getRuntime("test.background")).toBeNull();
    expect(manager.listServices()).toEqual([]);
  });
});
```

Also test `stopAsync()` when `stop()` or `destroy()` returns a promise. `stopAsync()` should await `stop()` before calling `destroy()`, then remove the runtime.

## Generator Tests

The app generator is dependency-free and can be tested by running it against a temporary app root:

- Reject invalid names.
- Reject existing folders without `--force`.
- Generate route/window/background file sets.
- Transpile or parse generated TypeScript files enough to catch syntax errors.
- Assert generated manifests import existing icon exports and `defineAppManifest`.
- Preserve existing files during dry runs.
- Print next steps.
