# VatioBoard OS Implementation Log

## Calculator Migration Session

- Date/time: 2026-05-28 06:53:11 EDT
- Agent: Codex 5.5
- Repository: `/home/oscar/vatioboard`
- Backend/BFF: `/home/oscar/frappe-bench/apps/vatiolibre` was not changed.

## Calculator Migration Baseline Understanding

Calculator was still implemented as a legacy shell-window widget in `src/calculator/calculator-widget.ts`, with state/history/settings helpers in `src/calculator/storage.ts`, styles in `src/styles/calculator.less`, and launch wiring through `src/shared/floating-tools.ts`, the start menu, and the shell-window manager. The OS manifest `vatio.calculator` already existed with shell window ID `calculator` and legacy tool ID `calculator`, and `shellAppRuntimeManager` could create a scoped runtime for that app.

## Calculator Files Inspected

- `src/calculator/calculator-widget.ts`
- `src/calculator/storage.ts`
- `src/calculator/calc-core.ts`
- `src/calculator/calculator-demo.ts`
- `src/calculator/widget/settings-sheet.ts`
- `src/calculator/widget/history-sheet.ts`
- `src/calculator/widget/panel.ts`
- `src/shared/floating-tools.ts`
- `src/shared/start-menu.ts`
- `src/shared/shell-window-manager.ts`
- `src/shared/shell-window-registry.ts`
- `src/app-platform/builtin-apps.ts`
- `src/app-platform/shell-app-runtime-manager.ts`
- `test/unit/shell-window-integration.test.js`
- `test/smoke/index-page.test.js`
- `test/smoke/dev-harness-calculator-page.test.js`
- `test/unit/calc-core.test.js`

## Calculator Migration Plan

1. Add a first-class wrapper under `src/apps/calculator/` without duplicating Calculator UI.
2. Keep direct `createCalculatorWidget()` compatibility for standalone/dev harnesses.
3. Let the wrapper resolve `vatio.calculator` through `shellAppRuntimeManager`.
4. Move Calculator preferences to `runtime.services.settings` while mirroring legacy settings for compatibility.
5. Keep shell window ID, legacy tool ID, taskbar, visibility, position, and floating-tool behavior unchanged.
6. Add focused tests for manifest launch, runtime creation, legacy launch paths, and runtime-backed settings.

## Calculator Migration Decisions Made

- Added `src/apps/calculator/calculator-app.ts` as an adapter over the existing widget. It resolves the scoped `vatio.calculator` runtime and returns the existing widget API plus the runtime.
- Updated the Calculator manifest with an `entry` loader and `settings.read` / `settings.write` plus the `settings` service.
- Updated `src/shared/floating-tools.ts` to create Calculator through `createCalculatorApp()` while leaving Energy, Camera Map, Speed Alerts, Player, and Milkdrop on their existing paths.
- Passed `shellAppRuntimeManager` from `src/app/app-shell.ts` into floating tools so Calculator can retrieve its scoped runtime at shell boot.
- Added optional `settingsStore` and `translate` hooks to `createCalculatorWidget()`. Existing direct widget callers still use legacy storage and global i18n by default.
- Added `normalizeSettings()` to `src/calculator/storage.ts` so runtime settings and legacy settings share the same safe normalization.
- Runtime Calculator preferences are saved at `vatioboard.app.vatio.calculator.settings.preferences`; writes are also mirrored to `embeddable_calc_settings_v1` so unmigrated Energy formatting still sees Calculator preferences.
- Calculator expression state, history, panel position, panel visibility, and shell layout are intentionally left on legacy storage for this pass.

## Calculator Migration Files Changed

- `src/app-platform/builtin-apps.ts`
- `src/app/app-shell.ts`
- `src/apps/calculator/calculator-app.less`
- `src/apps/calculator/calculator-app.ts`
- `src/apps/calculator/index.ts`
- `src/calculator/calculator-widget.ts`
- `src/calculator/storage.ts`
- `src/shared/floating-tools.ts`
- `test/unit/calculator-app.test.js`
- `docs/vatioboard-os.md`
- `docs/next-agent-handoff.md`
- `docs/vatioboard-os-implementation-log.md`

## Calculator Migration Tests Run

- `pnpm run typecheck` - passed during implementation.
- `pnpm vitest run test/unit/calculator-app.test.js test/unit/app-platform.test.js test/unit/shell-window-integration.test.js test/unit/calc-core.test.js test/smoke/dev-harness-calculator-page.test.js` - passed, 5 files and 36 tests.

Final Calculator migration verification in requested order:

- `pnpm run typecheck` - passed.
- `pnpm run lint` - passed with 63 warning-level findings and 0 errors. Warnings are in existing scripts/app/tests areas plus the existing Calculator widget unused `force` parameter warning, and were not blocking.
- `pnpm vitest run test/unit/app-platform.test.js` - passed, 1 file and 15 tests.
- `pnpm vitest run test/unit/calculator-app.test.js test/unit/shell-window-integration.test.js test/unit/calc-core.test.js test/smoke/dev-harness-calculator-page.test.js` - passed, 4 files and 21 tests.
- `pnpm test` - passed, 126 files and 1621 tests.
- `pnpm run build` - passed. The build prepared 1291 ANSV camera features and 73930 speed cameras, then Vite built successfully. Vite emitted the existing dynamic-import chunk warnings for `backend-auth.ts` and `cloud-sync.ts`, plus a Calculator app warning because `src/apps/calculator/index.ts` is dynamically referenced by the manifest entry and statically imported by floating tools for compatibility.

## Calculator Migration Known Limitations

- Calculator state and history still use the legacy `embeddable_calc_state_v1` and `embeddable_calc_history_v1` keys.
- Calculator panel position and visibility still use legacy shell/layout storage so existing restore/minimize/close behavior is unchanged.
- Runtime settings are mirrored to legacy settings for compatibility until Energy is migrated.
- Calculator is still an internal shell-window app, not an iframe or sandboxed external app.

## Hardening Session

- Date/time: 2026-05-28 01:15:43 EDT
- Final verification update: 2026-05-28 06:30-06:33 EDT
- Agent: Codex 5.5
- Repository: `/home/oscar/vatioboard`
- Backend/BFF: `/home/oscar/frappe-bench/apps/vatiolibre` was not changed.

## Hardening Baseline Understanding

The first VatioBoard OS v1 pass had already introduced manifests, adapters, app runtime injection for route views, local app storage, i18n wrapping, a launcher, App Manager, docs, and tests. This hardening pass kept that architecture intact and focused on making the platform safe for the next phase: migrating shell-window tools such as Calculator and Energy into first-class app modules.

## Additional Files Inspected

- `src/app-platform/types.ts`
- `src/app-platform/runtime.ts`
- `src/app-platform/app-registry.ts`
- `src/app-platform/manifest.ts`
- `src/app-platform/storage.ts`
- `src/app-platform/services.ts`
- `src/app-platform/launcher.ts`
- `src/app-platform/i18n.ts`
- `src/app-platform/builtin-apps.ts`
- `src/app/app-shell.ts`
- `src/apps/app-manager/app-manager.ts`
- `src/shared/start-menu.ts`
- `src/speed/speed.ts`
- `test/unit/app-platform.test.js`
- `test/unit/app-shell-runtime-lifecycle.test.js`
- `test/smoke/spa-apps-route.test.js`
- `test/smoke/index-page.test.js`
- `test/smoke/spa-gps-background.test.js`
- `test/smoke/dev-harness-speed-page.test.js`

## Hardening Plan

1. Add shell-window app runtime creation and caching without migrating the existing shell-window UIs yet.
2. Clean up route app lifecycle if route mounting throws.
3. Enforce storage and i18n permissions at the app-facing boundary.
4. Add a minimal app-scoped settings service.
5. Strengthen manifest and app registry validation.
6. Prefer manifest-backed app launching from the start menu and App Manager while preserving legacy toggles.
7. Expand tests and update docs for the next agent.

## Hardening Decisions Made

- Added `shellAppRuntimeManager` as a small app-platform module owned by the app shell. It creates and caches shell-window app runtimes by app ID and maps practical shell-window state changes to runtime lifecycle calls.
- Kept Calculator, Energy, Camera Map, Speed Alerts, Player, and Milkdrop UI code on their legacy paths for now. The next agent can retrieve shell-window runtimes through `routeContext.context.shellAppRuntimeManager`.
- Wrapped route view mounting so a thrown app mount calls `appRuntime.lifecycle.deactivate()` and `appRuntime.lifecycle.unmount()` before preserving the existing error behavior.
- Enforced `storage.app` for app storage and `i18n.read` for app i18n. Denied operations return safe values and log warnings rather than crashing.
- Added app-scoped settings through `runtime.services.settings`, backed by app-private storage under `settings.<key>`. Reads require `settings.read`; writes require `settings.write`.
- Tightened `manifest.services` semantics so runtime service exposure now requires both a declared service ID and the matching permission. This applies to GPS, audio, drive recording, driving alerts, auth, cloud sync, settings, app storage, and app i18n.
- Added supported service ID validation through `VALID_SERVICES`.
- Added duplicate detection for route paths, aliases, shell-window IDs, and `metadata.legacyToolId`.
- Updated the launcher so shell-window apps create runtimes and restore/focus minimized windows before falling back to opening them.
- Updated the start menu to prefer the manifest-backed launcher for known legacy tool IDs while leaving old floating-tool toggles as compatibility fallback.
- Made `mountSpeedRoute()` and `unmountSpeedRoute()` TDZ-safe by deferring to `speedRouteLifecycle` after module initialization if a cyclic import touches the exports early. This addressed the full-suite unhandled rejection `Cannot access 'speedRouteLifecycle' before initialization`.
- Confirmed the new app-shell lifecycle unit test explicitly un-mocks its heavy `vi.doMock()` module graph after each run, so those mocks do not leak into later files.

## Hardening Files Changed

- `src/app-platform/app-registry.ts`
- `src/app-platform/i18n.ts`
- `src/app-platform/index.ts`
- `src/app-platform/launcher.ts`
- `src/app-platform/manifest.ts`
- `src/app-platform/runtime.ts`
- `src/app-platform/services.ts`
- `src/app-platform/settings.ts`
- `src/app-platform/shell-app-runtime-manager.ts`
- `src/app-platform/storage.ts`
- `src/app-platform/types.ts`
- `src/app/app-shell.ts`
- `src/apps/app-manager/app-manager.ts`
- `src/shared/start-menu.ts`
- `src/speed/speed.ts`
- `src/types/route.ts`
- `test/unit/app-platform.test.js`
- `test/unit/app-shell-runtime-lifecycle.test.js`
- `docs/vatioboard-os.md`
- `docs/next-agent-handoff.md`
- `docs/vatioboard-os-implementation-log.md`

## Hardening Tests Run

Focused verification during the hardening pass:

- `pnpm run typecheck` - passed during implementation.
- `pnpm vitest run test/unit/app-platform.test.js test/unit/app-shell-runtime-lifecycle.test.js` - passed after service-contract test updates, 2 files and 16 tests.
- `pnpm vitest run test/smoke/spa-apps-route.test.js test/smoke/index-page.test.js` - passed, 2 files and 9 tests.
- `pnpm vitest run test/smoke/spa-gps-background.test.js -t "keeps speed recording and an accel run subscribed across route changes"` - passed, 1 file and 1 test, 13 skipped.
- `pnpm vitest run test/smoke/dev-harness-speed-page.test.js -t "coalesces replay persistence under high-frequency recording bursts"` - passed, 1 file and 1 test, 13 skipped.

Full-suite investigation before the final Speed fix:

- `pnpm test` - failed once in `test/smoke/spa-gps-background.test.js` on `keeps speed recording and an accel run subscribed across route changes` after a 40000ms timeout. The same run reported an unhandled rejection from `src/speed/speed.ts`: `Cannot access 'speedRouteLifecycle' before initialization`.
- `pnpm vitest run test/smoke/spa-gps-background.test.js -t "keeps speed recording and an accel run subscribed across route changes"` - passed when isolated, showing the scenario itself still worked.
- `pnpm test` - failed once in `test/smoke/dev-harness-speed-page.test.js` on `coalesces replay persistence under high-frequency recording bursts` after a 20000ms timeout.
- `pnpm vitest run test/smoke/dev-harness-speed-page.test.js -t "coalesces replay persistence under high-frequency recording bursts"` - passed when isolated.

Speed investigation conclusion:

- The focused Speed smoke tests passed in isolation, which showed the tested user flows still worked.
- The full-suite unhandled rejection showed a real module-initialization edge: `mountSpeedRoute()` could read the `let speedRouteLifecycle` binding before it had been initialized under a cyclic/full-suite import timing pattern.
- The fix in `src/speed/speed.ts` makes that binding TDZ-safe and defers mount/unmount calls by one microtask if they are touched before lifecycle assignment.
- After that fix and explicit cleanup in the heavily mocked app-shell lifecycle test, the full `pnpm test` run passed.

Final hardening-pass verification in requested order:

- `pnpm run typecheck` - passed.
- `pnpm run lint` - passed with 63 warning-level findings and 0 errors. Warnings are in existing scripts/app/tests areas and were not blocking.
- `pnpm vitest run test/unit/app-platform.test.js test/unit/app-shell-runtime-lifecycle.test.js` - passed, 2 files and 16 tests.
- `pnpm vitest run test/smoke/spa-apps-route.test.js test/smoke/index-page.test.js` - passed, 2 files and 9 tests.
- `pnpm test` - passed, 125 files and 1617 tests.
- `pnpm run build` - passed. The build prepared 1291 ANSV camera features and 73930 speed cameras, then Vite built successfully. Vite emitted existing warnings that dynamic imports of `backend-auth.ts` and `cloud-sync.ts` from `src/app-platform/services.ts` cannot split those modules because they are also statically imported elsewhere.

## Hardening Known Limitations

- Shell-window app runtimes now exist, but legacy shell-window UI modules do not yet receive the runtime as a constructor argument. The migration path is documented and ready for Calculator or Energy.
- Permission and service declaration enforcement is runtime-boundary enforcement only. There are still no user-facing prompts because v1 remains internal-only.
- Settings are app-scoped and localStorage-backed through app storage. They do not yet sync to VatioLibre.
- Background-service manifests can exist, but full background runtime scheduling is still future work.
- Existing global compatibility shims remain.

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

## Original OS V1 Tests Run

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

## Original OS V1 Known Limitations

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
