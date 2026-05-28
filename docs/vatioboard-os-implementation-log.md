# VatioBoard OS Implementation Log

## Work Session

- Date/time: 2026-05-28 00:21:06 EDT
- Agent: Codex 5.5
- Repository: `/home/oscar/vatioboard`
- Backend/BFF: `/home/oscar/frappe-bench/apps/vatiolibre` was not changed.

## Baseline Understanding

VatioBoard is a Vite + TypeScript SPA booted by `index.html` through `src/app/main.ts`. The shell starts in `src/app/app-shell.ts`, creates shared runtime services, mounts persistent shell UI, then delegates hash routing to `src/app/router.ts`.

The existing production routes are declared in `src/app/route-registry.ts` and re-exported by `src/app/routes.ts`. The start menu, floating tools, and taskbar consume typed tool and shell-window definitions from `src/shared/tool-registry.ts` and `src/shared/shell-window-registry.ts`. `src/shared/shell-window-manager.ts` already provides the durable window runtime used by Calculator, Energy, Camera Map, Speed Alerts, Player, and Milkdrop.

## Files Inspected

- `package.json`
- `src/app/main.ts`
- `src/app/app-shell.ts`
- `src/app/route-registry.ts`
- `src/app/router.ts`
- `src/app/routes.ts`
- `src/app/runtime-context.ts`
- `src/app/views/AccelView.ts`
- `src/app/views/BoardView.ts`
- `src/app/views/LibraryView.ts`
- `src/app/views/PlayerDebugView.ts`
- `src/app/views/ReplayView.ts`
- `src/app/views/SpeedView.ts`
- `src/app/views/route-view.ts`
- `src/shared/tool-registry.ts`
- `src/shared/shell-window-registry.ts`
- `src/shared/shell-window-manager.ts`
- `src/shared/shell-taskbar.ts`
- `src/shared/start-menu.ts`
- `src/shared/floating-tools.ts`
- `src/shared/floating-layer-manager.ts`
- `src/shared/backend-auth.ts`
- `src/shared/cloud-sync.ts`
- `src/i18n.ts`
- `src/types/route.ts`
- `src/types/shell.ts`
- `src/types/services.ts`
- `src/types/ui.ts`
- `src/types/storage.ts`
- Representative unit and smoke tests under `test/unit/*` and `test/smoke/*`

## Current Architecture Summary

- The app shell owns all long-lived surfaces: persistent layer, player widget, floating tools, start menu, activity indicator, taskbar, shell keyboard shortcuts, and shared runtime context.
- Route modules receive a `RouteMountContext` through `createRouteView`; legacy route code reads `root`, `cleanup`, `signal`, and injected shared services.
- The router normalizes hash routes and falls back to `/` when a route is unknown.
- Tools and shell windows are already typed but currently duplicated across route, tool, and shell-window registries.
- Shared services still expose some global compatibility shims on `window`, which must remain for existing internals.

## Implementation Plan

1. Add `src/app-platform/` with app manifest, registry, permissions, services, storage, i18n, lifecycle, logger, runtime, and launcher modules.
2. Define built-in manifests for existing route apps and shell/window tools.
3. Add adapters that derive old route/tool/shell-window registries from the app manifest registry.
4. Update existing registries to delegate to the adapters while preserving old exported names.
5. Inject `appRuntime` and `appManifest` into route contexts from `app-shell.ts`.
6. Add a `#/apps` App Manager route and manifest.
7. Add focused unit/smoke tests and documentation.
8. Run `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm run build` when practical.

## Decisions Made

- Keep Vite + TypeScript + vanilla modules; no new frontend framework.
- Make manifests authoritative, but leave compatibility exports in place.
- Keep route/view modules unchanged unless they need the new runtime contract.
- Use localStorage for v1 app-private storage with `vatioboard.app.<appId>.<key>` namespacing.
- Enforce permissions at the runtime boundary by exposing missing services as `null` and logging safe warnings.
- Use lazy auth/cloud-sync service wrappers so narrow Vitest mocks and offline shells do not fail during runtime creation.
- Keep `VatioAppWindowManifest.defaultBounds` in manifests, but do not pass those bounds into the legacy shell-window registry adapter. Existing shell tools have their own first-open placement behavior, and forwarding default bounds changed Milkdrop placement.

## Files Changed

- `src/app-platform/types.ts`
- `src/app-platform/manifest.ts`
- `src/app-platform/app-registry.ts`
- `src/app-platform/builtin-apps.ts`
- `src/app-platform/permissions.ts`
- `src/app-platform/runtime.ts`
- `src/app-platform/services.ts`
- `src/app-platform/storage.ts`
- `src/app-platform/i18n.ts`
- `src/app-platform/launcher.ts`
- `src/app-platform/lifecycle.ts`
- `src/app-platform/logger.ts`
- `src/app-platform/index.ts`
- `src/app-platform/adapters/route-registry-adapter.ts`
- `src/app-platform/adapters/tool-registry-adapter.ts`
- `src/app-platform/adapters/shell-window-registry-adapter.ts`
- `src/app/app-shell.ts`
- `src/app/route-registry.ts`
- `src/app/router.ts`
- `src/app/views/AppsView.ts`
- `src/app/views/templates/apps-template.ts`
- `src/apps/app-manager/app-manager.ts`
- `src/apps/app-manager/app-manager.less`
- `src/shared/tool-registry.ts`
- `src/shared/shell-window-registry.ts`
- `src/shared/start-menu.ts`
- `src/i18n.ts`
- `src/types/route.ts`
- `test/unit/app-platform.test.js`
- `test/smoke/spa-apps-route.test.js`
- `test/helpers/real-spa-route-smoke.js`
- `docs/vatioboard-os.md`
- `docs/next-agent-handoff.md`
- `docs/vatioboard-os-implementation-log.md`

## Tests Run

- `pnpm run typecheck` - passed.
- `pnpm vitest run test/unit/app-platform.test.js` - passed, 8 tests.
- `pnpm vitest run test/smoke/spa-apps-route.test.js` - passed, 1 test.
- `pnpm run lint` - passed with 63 warning-level findings already present in the repo areas; no blocking lint errors.
- `pnpm vitest run test/smoke/index-page.test.js` - initially failed because app runtime service creation touched mocked auth/cloud-sync exports. Fixed by making auth/cloud wrappers lazy. Passed after fix, 8 tests.
- `pnpm test` - first run failed with Milkdrop placement and one GPS-background timeout. Fixed Milkdrop by preserving legacy no-bounds shell adapter behavior. The GPS-background test passed when run directly and the full suite passed on rerun.
- `pnpm vitest run test/unit/milkdrop-panel.test.js` - passed after shell adapter fix, 15 tests.
- `pnpm vitest run test/smoke/spa-gps-background.test.js -t "keeps speed recording and an accel run subscribed across route changes"` - passed.
- `pnpm test` - passed on rerun, 124 files and 1609 tests.
- `pnpm run build` - passed. Build emitted Vite warnings that dynamic imports of `backend-auth.ts` and `cloud-sync.ts` cannot split those modules because they are also statically imported elsewhere.
- Final `pnpm run typecheck` - passed.

## Known Limitations

- Permission declarations are enforced inside the runtime boundary, but there are no user-facing permission prompts yet.
- App-private storage is localStorage-backed only.
- Existing apps still import global helpers directly; migration to runtime services is intentionally gradual.
- Global compatibility shims remain for GPS, drive recording, driving alerts, player widget, router, and SPA detection.
- Background-service lifecycle is only represented in the type system and launcher behavior; it is not a full background runtime.
- Community/external app loading, sandboxed iframes, signed app bundles, app enable/disable settings, and cloud-backed app storage are not implemented in v1.
- The legacy shell-window registry adapter does not emit manifest `defaultBounds` to avoid changing current first-open placement behavior.

## Next Recommended Steps

- Move one small shell-window tool, likely Calculator or Energy, into `src/apps/<app-id>` as a first-class app module.
- Start replacing direct localStorage usage in one app with `appRuntime.storage`.
- Add app enable/disable preferences once app manifests are stable.
- Add permission prompts only when non-core or community apps become real.
- Add VatioLibre-backed app storage after the local storage contract is exercised by at least one migrated app.
- Gradually remove global shims only after each internal consumer has a runtime-service replacement.
