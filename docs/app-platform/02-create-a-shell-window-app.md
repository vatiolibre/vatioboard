# Create A Shell-Window App

Shell-window apps are floating tools managed by the VatioBoard shell. They should register one shell window and export `createShellWindowApp()` from the app entry module.

The launcher lazy-loads shell-window entries. When an app is opened, the launcher:

1. Finds the manifest by app id.
2. Ensures a runtime through `createShellAppRuntimeManager()`.
3. Imports `manifest.entry`.
4. Calls `createShellWindowApp({ mount, shellManager, shellAppRuntimeManager, runtime })`.
5. Opens, restores, or focuses the registered window.

Launching the same app twice should focus or restore the existing window, not create duplicates. The manifest `window.shellWindowId` must match the actual registered shell window id.

Start with:

```bash
pnpm run create:app -- window timer
```

## Minimal Files

`src/apps/timer/index.ts`

```ts
export {
  TIMER_APP_ID,
  createTimerWindowApp,
  createShellWindowApp,
} from "./timer-window-app.js";
```

`src/apps/timer/timer-window-app.ts`

```ts
import "./timer.less";

import type { ShellRuntime } from "../../types/shell";
import type { ShellAppRuntimeManager, VatioAppRuntime } from "../../app-platform/types";

export const TIMER_APP_ID = "vatio.timer";
export const TIMER_WINDOW_ID = "timer";

interface TimerWindowOptions {
  mount?: HTMLElement | null;
  shellManager?: ShellRuntime | null;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
  runtime?: VatioAppRuntime | null;
}

function resolveRuntime(options: TimerWindowOptions) {
  if (options.runtime?.appId === TIMER_APP_ID) return options.runtime;
  return options.shellAppRuntimeManager?.getRuntime(TIMER_APP_ID)
    || options.shellAppRuntimeManager?.ensureRuntime(TIMER_APP_ID)
    || null;
}

export function createTimerWindowApp(options: TimerWindowOptions = {}) {
  const runtime = resolveRuntime(options);
  const shellManager = options.shellManager;
  const mount = options.mount || document.body;

  if (!shellManager?.registerWindow) {
    runtime?.logger.warn("Timer requires a shell window manager.");
    return { runtime };
  }

  const element = document.createElement("section");
  element.className = "timer-window";
  element.innerHTML = `
    <h2>Timer</h2>
    <output data-timer-output>00:00</output>
  `;
  mount.append(element);

  shellManager.registerWindow({
    id: TIMER_WINDOW_ID,
    title: "Timer",
    element,
    lifecycle: {
      destroy() {
        element.remove();
      },
    },
  });

  runtime?.storage.setItem("lastOpenedAt", new Date().toISOString());
  return { runtime, element };
}

export const createShellWindowApp = createTimerWindowApp;
```

`src/apps/timer/manifest.ts`

```ts
import { IconTime } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const timerAppManifest = defineAppManifest({
  id: "vatio.timer",
  title: "Timer",
  shortTitle: "Timer",
  description: "Floating local-first timer.",
  kind: "tool-app",
  version: "1.0.0",
  icon: IconTime,
  i18nKey: "timer",
  entry: () => import("./index.js"),
  surfaces: ["shell-window", "start-menu", "taskbar", "launcher"],
  order: 200,
  permissions: ["storage.app", "i18n.read", "settings.read", "shell.window"],
  services: ["storage", "i18n", "settings", "shell"],
  window: {
    shellWindowId: "timer",
    mode: "floating",
    defaultBounds: { left: 48, top: 96, width: 320, height: 240 },
    capabilities: {
      draggable: true,
      resizable: true,
      minimizable: true,
      closable: true,
      restorable: true,
    },
    restoreOnBoot: true,
    lazy: true,
  },
  tags: ["tool", "timer"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "experimental",
  metadata: {},
});
```

## Storage And Settings

Use `runtime.storage` for simple app-private state. Use `runtime.services.settings` for app preferences that should live inside the app settings namespace. Use `runtime.services.sharedSettings` only for shared OS preferences such as units, language, density, or audio defaults.

Do not add new raw `localStorage` keys unless the app is preserving or migrating legacy data and the keys are documented.

## Window Capabilities

Declare capabilities in `manifest.window.capabilities`. Common fields include:

- `draggable`
- `resizable`
- `minimizable`
- `closable`
- `restorable`
- `fullscreen`
- `maximizable`
- `snap`
- size hints such as `maxWidth`

The shell runtime owns the behavior. The app should not create a second floating system inside the window.

## Test Checklist

- Manifest validates and includes `surfaces: ["shell-window", ...]`.
- `window.shellWindowId` matches the registered shell window id.
- `createShellWindowApp()` is exported by the entry module.
- Launcher lazy-loads the app and opens/restores/focuses one window.
- Repeated launches do not create duplicate windows.
- Storage uses `runtime.storage` or runtime settings.
- Closing/minimizing updates runtime lifecycle through `createShellAppRuntimeManager()`.
