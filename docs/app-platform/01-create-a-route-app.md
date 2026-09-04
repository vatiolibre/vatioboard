# Create A Route App

A route app is a full-page SPA app mounted into the route view area. It should export `mount(root, context)` from its entry path, usually by delegating to `createRouteView()`.

New route apps should:

- Use `createRouteView()` from `src/app/views/route-view.ts`.
- Export `mount()`.
- Receive `appRuntime` through the route context.
- Use `runtime.services`, `runtime.storage`, `runtime.i18n`, and `runtime.shell` instead of global fallbacks.
- Avoid new `window.__vatioboard...` dependencies. Those are only compatibility shims for legacy code.
- Register cleanup through `routeContext.cleanup` whenever possible.
- Use `routeSignal` or `routeContext.signal` for abortable async route work.

Start with:

```bash
pnpm run create:app -- route notes
```

Then import the generated manifest in `src/app-platform/builtin-apps.ts`.

## Minimal Files

`src/apps/notes/index.ts`

```ts
export {
  NOTES_APP_ID,
  mount,
} from "./notes-route-app.js";
```

`src/apps/notes/notes-route-app.ts`

```ts
import "./notes.less";

import { createRouteView } from "../../app/views/route-view.js";
import type { MountedView, RouteContext, RouteMountContext } from "../../types/route";
import type { VatioAppRuntime } from "../../app-platform/types";

export const NOTES_APP_ID = "vatio.notes";

const template = `
  <section class="notes-app" data-notes-app>
    <header class="notes-app__header">
      <h1>Notes</h1>
      <button type="button" data-note-save>Save</button>
    </header>
    <textarea data-note-body aria-label="Notes"></textarea>
  </section>
`;

function resolveNotesRuntime(routeContext: RouteMountContext): VatioAppRuntime | null {
  const runtime = routeContext.context.appRuntime || null;
  return runtime?.appId === NOTES_APP_ID ? runtime : null;
}

function mountNotes(routeContext: RouteMountContext): MountedView {
  const runtime = resolveNotesRuntime(routeContext);
  const root = routeContext.root.querySelector("[data-notes-app]");
  const body = root?.querySelector("[data-note-body]") as HTMLTextAreaElement | null;
  const save = root?.querySelector("[data-note-save]") as HTMLButtonElement | null;

  if (!runtime || !body || !save) {
    return { unmount() {} };
  }

  body.value = runtime.storage.getItem("body") || "";
  routeContext.cleanup.addEventListener(save, "click", () => {
    runtime.storage.setItem("body", body.value);
    runtime.logger.info("Saved notes locally.");
  });

  return { unmount() {} };
}

const view = createRouteView({
  pageName: "notes",
  template,
  meta: {
    title: "Notes - VatioBoard",
    description: "Local-first notes for VatioBoard.",
    canonicalPath: "/notes",
    bodyClass: "notes-page",
  },
  loadModule: () => Promise.resolve({}),
  mountController: (_module, routeContext) => mountNotes(routeContext),
});

export function mount(root: HTMLElement, context: Partial<RouteContext>): Promise<MountedView> {
  return view.mount(root, context);
}
```

`src/apps/notes/manifest.ts`

```ts
import { IconPages } from "../../icons.js";
import { defineAppManifest } from "../../app-platform/manifest.js";

export const notesAppManifest = defineAppManifest({
  id: "vatio.notes",
  title: "Notes",
  shortTitle: "Notes",
  description: "Local-first notes for VatioBoard.",
  kind: "core-app",
  version: "1.0.0",
  icon: IconPages,
  i18nKey: "notes",
  route: "/notes",
  entry: () => import("./index.js"),
  surfaces: ["main-route", "start-menu", "launcher"],
  order: 200,
  permissions: ["storage.app", "i18n.read", "settings.read", "shell.launchApp"],
  services: ["storage", "i18n", "settings", "shell"],
  tags: ["notes", "local-first"],
  localFirst: true,
  teslaOptimized: true,
  offlineCapable: true,
  status: "experimental",
  metadata: {},
});
```

The manifest must include the appropriate `kind`, `route`, `surfaces`, `entry`, `permissions`, `services`, `localFirst`, `teslaOptimized`, `offlineCapable`, `status`, and `metadata`.

## Cleanup Rules

Route apps are remounted during navigation. Cleanup is not optional.

- Use `routeContext.cleanup.addEventListener(...)` for DOM events.
- Use `routeContext.cleanup.setTimeout(...)`, `setInterval(...)`, and `requestAnimationFrame(...)` instead of raw timer APIs when available.
- Add explicit cleanup for maps, charts, media players, observers, RAF loops, web workers, and app-specific stores.
- Use `routeContext.signal` or `context.routeSignal` when fetching or doing async work tied to the current route.
- Return a `MountedView` with `unmount()` only when the app owns additional cleanup that does not fit the cleanup stack.

## Test Checklist

- Manifest validates with `validateAppManifest()`.
- Route appears in `getRouteRegistryFromApps()`.
- Route `mount()` renders expected DOM and receives `appRuntime`.
- Runtime services are gated by both `permissions` and `services`.
- App-private storage uses `runtime.storage` and stays under `vatioboard.app.<appId>.`.
- Unmount removes route DOM, listeners, timers, maps/charts, and async work.
- A smoke test covers direct loading and History API navigation for the clean path if the app is user-facing.
