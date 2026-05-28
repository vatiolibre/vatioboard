# Next Agent Handoff

## Completed

- Added the first functional VatioBoard OS platform under `src/app-platform/`.
- Added built-in app manifests for current route apps and shell-window tools.
- Made app manifests the source for route, tool, and shell-window compatibility registries.
- Added app-scoped runtime creation and passed `appManifest` / `appRuntime` to route contexts.
- Added app-private localStorage-backed storage.
- Added permission runtime and service gateway with lazy auth/cloud sync wrappers.
- Added shell app launcher APIs.
- Added internal App Manager at `#/apps`.
- Added platform unit tests and Apps route smoke test.
- Added `docs/vatioboard-os.md` and this handoff.
- Hardened shell-window app runtime support through `shellAppRuntimeManager`.
- Added route mount failure lifecycle cleanup.
- Enforced `storage.app`, `i18n.read`, `settings.read`, and `settings.write` at the runtime boundary.
- Added app-scoped settings service backed by app-private storage.
- Added manifest validation for service IDs and duplicate route, alias, shell-window, and legacy tool IDs.
- Updated start menu and App Manager launcher paths to prefer manifest-backed app launching while keeping compatibility fallbacks.
- Tightened `manifest.services` so runtime service exposure requires both a declared service ID and the matching permission.
- Fixed the Speed full-suite module-initialization edge by making `mountSpeedRoute()` / `unmountSpeedRoute()` safe if a cyclic import touches `speedRouteLifecycle` before assignment.
- Confirmed the heavy mocks in `test/unit/app-shell-runtime-lifecycle.test.js` are explicitly unmocked after each test.
- Migrated Calculator into the first first-class shell-window app module under `src/apps/calculator/`.
- Calculator now resolves `vatio.calculator` through `shellAppRuntimeManager`, uses `runtime.services.settings` for preferences, uses runtime i18n for widget labels where practical, and logs runtime settings fallback warnings.
- Calculator compatibility is preserved: shell window ID `calculator`, legacy tool ID `calculator`, floating-tool toggles, start-menu launch, taskbar, position, visibility, and direct `createCalculatorWidget()` callers still work.
- Migrated Energy into the next first-class shell-window app module under `src/apps/energy/`.
- Energy now resolves `vatio.energy` through `shellAppRuntimeManager`, uses `runtime.services.settings` for trip preferences (`tripCostSettings`) and number-format preferences (`numberFormat`), uses runtime i18n for top-level panel labels where practical, and logs runtime settings fallback warnings.
- Energy compatibility is preserved: shell window ID `energy`, legacy tool ID `energy`, floating-tool toggles, start-menu launch, Calculator-to-Energy launch, taskbar, position, visibility, and direct `createEnergyCalculatorWidget()` callers still work.
- Fixed Calculator/Energy shared number-format compatibility before starting Camera Map. `embeddable_calc_settings_v1` is canonical for v1; Calculator and Energy app-private settings are mirrors so stale runtime settings cannot split decimal/thousands behavior.
- Cleaned up Calculator and Energy `i18n:change` listeners during widget destroy.

## Important Files Changed

- `src/app-platform/types.ts`
- `src/app-platform/builtin-apps.ts`
- `src/app-platform/app-registry.ts`
- `src/app-platform/runtime.ts`
- `src/app-platform/launcher.ts`
- `src/app-platform/storage.ts`
- `src/app-platform/services.ts`
- `src/app-platform/settings.ts`
- `src/app-platform/shell-app-runtime-manager.ts`
- `src/apps/calculator/calculator-app.ts`
- `src/apps/calculator/calculator-app.less`
- `src/apps/calculator/index.ts`
- `src/apps/energy/energy-app.ts`
- `src/apps/energy/energy-app.less`
- `src/apps/energy/index.ts`
- `src/apps/shared/number-format-settings.ts`
- `src/app-platform/adapters/route-registry-adapter.ts`
- `src/app-platform/adapters/tool-registry-adapter.ts`
- `src/app-platform/adapters/shell-window-registry-adapter.ts`
- `src/app/app-shell.ts`
- `src/app/router.ts`
- `src/app/route-registry.ts`
- `src/shared/tool-registry.ts`
- `src/shared/shell-window-registry.ts`
- `src/shared/start-menu.ts`
- `src/speed/speed.ts`
- `src/calculator/calculator-widget.ts`
- `src/calculator/storage.ts`
- `src/energy/energy-calculator-widget.ts`
- `src/energy/trip-cost-storage.ts`
- `src/energy/widget/panel.ts`
- `src/energy/widget/settings-sheet.ts`
- `src/types/route.ts`
- `src/app/views/AppsView.ts`
- `src/app/views/templates/apps-template.ts`
- `src/apps/app-manager/app-manager.ts`
- `src/apps/app-manager/app-manager.less`
- `src/i18n.ts`
- `test/unit/app-platform.test.js`
- `test/unit/app-shell-runtime-lifecycle.test.js`
- `test/unit/calculator-app.test.js`
- `test/unit/energy-app.test.js`
- `test/smoke/spa-apps-route.test.js`
- `test/helpers/real-spa-route-smoke.js`
- `docs/vatioboard-os.md`
- `docs/vatioboard-os-implementation-log.md`

## Commands Run

Original OS v1 verification from the previous implementation session:

- `pnpm run typecheck` - passed after type fixes.
- `pnpm vitest run test/unit/app-platform.test.js` - passed.
- `pnpm vitest run test/smoke/spa-apps-route.test.js` - passed.
- `pnpm run lint` - passed with existing warning-level lint output.
- `pnpm vitest run test/smoke/index-page.test.js` - initially failed because mocked auth/cloud-sync exports were touched during runtime creation; passed after making those service wrappers lazy.
- `pnpm vitest run test/unit/milkdrop-panel.test.js` - passed after preserving legacy shell-window no-bounds behavior.
- `pnpm vitest run test/smoke/spa-gps-background.test.js -t "keeps speed recording and an accel run subscribed across route changes"` - passed.
- `pnpm test` - first run exposed the Milkdrop placement issue and a transient GPS-background timeout; rerun passed with 124 files and 1609 tests.
- `pnpm run build` - passed. Vite warned that dynamic auth/cloud-sync imports stay in existing chunks because those modules are also statically imported elsewhere.
- Final `pnpm run typecheck` - passed.

Hardening-pass investigation before the final Speed fix:

- `pnpm test` - failed once in `test/smoke/spa-gps-background.test.js` on `keeps speed recording and an accel run subscribed across route changes`, with an unhandled rejection from `src/speed/speed.ts`: `Cannot access 'speedRouteLifecycle' before initialization`.
- `pnpm vitest run test/smoke/spa-gps-background.test.js -t "keeps speed recording and an accel run subscribed across route changes"` - passed when isolated.
- `pnpm test` - failed once in `test/smoke/dev-harness-speed-page.test.js` on `coalesces replay persistence under high-frequency recording bursts`.
- `pnpm vitest run test/smoke/dev-harness-speed-page.test.js -t "coalesces replay persistence under high-frequency recording bursts"` - passed when isolated.

Final hardening-pass verification in requested order:

- `pnpm run typecheck` - passed.
- `pnpm run lint` - passed with 63 warning-level findings and 0 errors.
- `pnpm vitest run test/unit/app-platform.test.js test/unit/app-shell-runtime-lifecycle.test.js` - passed, 2 files and 16 tests.
- `pnpm vitest run test/smoke/spa-apps-route.test.js test/smoke/index-page.test.js` - passed, 2 files and 9 tests.
- `pnpm test` - passed, 125 files and 1617 tests.
- `pnpm run build` - passed. Vite still warns that dynamic imports of `backend-auth.ts` and `cloud-sync.ts` stay in existing chunks because those modules are also statically imported elsewhere.

Calculator migration focused verification:

- `pnpm run typecheck` - passed during implementation.
- `pnpm vitest run test/unit/calculator-app.test.js test/unit/app-platform.test.js test/unit/shell-window-integration.test.js test/unit/calc-core.test.js test/smoke/dev-harness-calculator-page.test.js` - passed, 5 files and 36 tests.

Final Calculator migration verification:

- `pnpm run typecheck` - passed.
- `pnpm run lint` - passed with 63 warning-level findings and 0 errors.
- `pnpm vitest run test/unit/app-platform.test.js` - passed, 1 file and 15 tests.
- `pnpm vitest run test/unit/calculator-app.test.js test/unit/shell-window-integration.test.js test/unit/calc-core.test.js test/smoke/dev-harness-calculator-page.test.js` - passed, 4 files and 21 tests.
- `pnpm test` - passed, 126 files and 1621 tests.
- `pnpm run build` - passed. Vite still warns for dynamic/static auth and cloud-sync imports, and now also warns that `src/apps/calculator/index.ts` is both the manifest entry dynamic import and a static floating-tools import for compatibility.

Energy migration focused and final verification:

- `pnpm run typecheck` - passed.
- `pnpm vitest run test/unit/energy-app.test.js test/unit/calculator-app.test.js test/unit/app-platform.test.js test/unit/shell-window-integration.test.js test/unit/floating-panel-z-order.test.js test/unit/trip-cost-storage.test.js` - passed, 6 files and 48 tests.
- `pnpm vitest run test/unit/energy-app.test.js` - passed after lint cleanup, 1 file and 6 tests.
- `pnpm test` - passed, 127 files and 1627 tests.
- `pnpm run lint` - passed with 60 warning-level findings and 0 errors. Warnings are existing repository warnings in scripts/app/tests areas.
- `pnpm run build` - passed. Vite still warns for dynamic/static auth and cloud-sync imports, and now also warns that `src/apps/calculator/index.ts` and `src/apps/energy/index.ts` are both manifest entry dynamic imports and static floating-tools imports for compatibility.

Shared Calculator/Energy number-format compatibility verification:

- `pnpm run typecheck` - passed.
- `pnpm vitest run test/unit/calculator-app.test.js test/unit/energy-app.test.js test/unit/app-platform.test.js` - passed, 3 files and 30 tests.
- `pnpm run lint` - passed with 60 warning-level findings and 0 errors.
- `pnpm test` - first run failed in `test/smoke/spa-gps-background.test.js` on `keeps speed recording and an accel run subscribed across route changes` after a 40000ms timeout.
- `pnpm vitest run test/smoke/spa-gps-background.test.js -t "keeps speed recording and an accel run subscribed across route changes"` - passed, 1 file and 1 test with 13 skipped.
- `pnpm test` - rerun passed, 127 files and 1632 tests.
- `pnpm run build` - passed. Vite still warns for dynamic/static auth and cloud-sync imports, and for Calculator/Energy app entries because they are manifest dynamic imports and static floating-tools imports for compatibility.

Final full-suite commands are also recorded in `docs/vatioboard-os-implementation-log.md`.

## Known Limitations

- App permissions are declared and enforced at the runtime boundary, but there are no user prompts yet.
- App service declarations are now enforced with permissions, but this is still an internal runtime boundary rather than a sandbox.
- App-private storage is localStorage-backed only.
- Existing apps still import many global helpers directly; migration to `appRuntime` should be gradual. Calculator and Energy are partially migrated through app wrappers, but Calculator expression state/history, Energy trip values/multi-trip records, and both apps' shell layout storage remain legacy for compatibility.
- Calculator and Energy intentionally share number-format settings through `embeddable_calc_settings_v1` in v1. Their app-private runtime settings are mirrors until a true platform shared-settings service exists.
- Existing global compatibility shims remain in place.
- Background-service lifecycle is registered in types but not heavily implemented.
- Shell-window runtimes are created and cached. Calculator and Energy now consume their runtimes through app wrappers; Camera Map, Speed Alerts, Player, and Milkdrop still need migration.
- App settings are local-only through app-private storage and do not sync yet.
- Community/external app loading is intentionally not implemented.

## Suggested Next Prompt

Continue the VatioBoard OS migration by moving Camera Map behind a first-class shell-window app module in `src/apps/camera-map`. Resolve `vatio.cameraMap` through `shellAppRuntimeManager`, use runtime GPS service access instead of direct globals where practical, move Camera Map preferences to `runtime.services.settings` while preserving existing legacy keys as mirrors/fallbacks, keep shell window ID `camera-map`, legacy tool ID `camera-map`, floating-tool toggles, start-menu launch, taskbar behavior, and Speed Alerts-to-Camera Map launch behavior, then add tests proving manifest-backed launch, legacy launch, runtime creation, GPS permission/service behavior, and direct widget compatibility.

## Manual QA

- Desktop browser: load `/`, open the start menu, confirm Speed/Board/Library/Replay/Accel/Apps appear and launch.
- Desktop browser: visit `#/apps`, search/filter apps, and launch a route app and a shell-window app.
- Mobile browser: verify `#/apps` cards, filter, and buttons fit without horizontal scrolling.
- Tesla browser: verify `#/speed`, `#/board`, `#/library`, `#/replay`, `#/accel`, and `#/apps` load; open Calculator, Energy, Camera Map, Speed Alerts, Player, and Milkdrop from their existing surfaces; use Calculator's Energy button and confirm Energy opens/focuses.
- Offline/glitch QA: load once, go offline, refresh `#/apps` and core local-first routes, and confirm the shell does not crash.
