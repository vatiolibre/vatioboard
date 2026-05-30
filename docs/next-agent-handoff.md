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
- Migrated Camera Map into a first-class shell-window app module under `src/apps/camera-map/`.
- Camera Map now resolves `vatio.cameraMap` through `shellAppRuntimeManager`, prefers `runtime.services.gps`, mirrors preferences through `runtime.services.settings`, and logs runtime settings fallback warnings.
- Camera Map compatibility is preserved: shell window ID `camera-map`, legacy tool ID `camera-map`, floating-tool toggles, start-menu launch, Speed Alerts-to-Camera Map launch, taskbar behavior, position/visibility, local/offline camera data, global GPS fallbacks, and direct `createCameraMapWidget()` callers still work.
- Migrated Speed Alerts into a first-class shell-window app module under `src/apps/speed-alerts/`.
- Speed Alerts now resolves `vatio.speedAlerts` through `shellAppRuntimeManager`, prefers runtime GPS and driving-alert services where available, mirrors preferences through `runtime.services.settings`, and logs runtime settings fallback warnings.
- Speed Alerts compatibility is preserved: shell window ID `speed-alerts`, legacy tool ID `speed-alerts`, floating-tool toggles, start-menu launch, Camera Map button behavior, taskbar behavior, position/visibility, alert audio priming, alert sound behavior, GPS fallbacks, and direct `createSpeedAlertPanel()` callers still work.
- Migrated Player into a first-class shell-window app module under `src/apps/player/`.
- Player now resolves `vatio.player` through `shellAppRuntimeManager`, uses the runtime audio service at the app boundary, mirrors visualizer preferences through `runtime.services.settings`, and keeps the existing shared audio runtime singleton.
- Player compatibility is preserved: shell window ID `player`, legacy tool ID `player`, persistent player global, taskbar behavior, minimize/restore/close behavior, Media Session behavior, background audio behavior, queue/session restore, pinned/local media behavior, and direct `createPlayerWidget()` callers still work.
- Migrated Milkdrop into a first-class shell-window app module under `src/apps/milkdrop/`.
- Milkdrop now resolves `vatio.milkdrop` through `shellAppRuntimeManager`, acknowledges the runtime audio service without replacing the shared audio graph, mirrors visibility through `runtime.services.settings`, and uses runtime i18n for panel labels where practical.
- Milkdrop compatibility is preserved: shell window ID `milkdrop`, legacy tool ID `milkdrop`, Player-to-Milkdrop launch, taskbar behavior, minimize/restore/close behavior, preset loading, canvas/WebGL behavior, shared audio graph behavior, legacy position/visibility/size/preset keys, and direct `createMilkdropPanel()` callers still work.
- Hardened shell-window app cold launch for App Manager and the manifest launcher.
- `createAppLauncher().openApp(appId)` now ensures the shell app runtime, dynamically loads a shell-window manifest entry when the window has not been registered yet, calls the entry's `createShellWindowApp({ mount, shellManager, shellAppRuntimeManager, runtime })`, and opens/focuses the registered shell window.
- Calculator, Energy, Camera Map, Speed Alerts, Player, and Milkdrop now all expose the generic `createShellWindowApp()` entry contract while preserving their existing app-specific exports.
- Cold-launch races are coalesced per shell manager and app ID, and already registered legacy/floating-tool windows are reused instead of duplicated.
- Migrated Speed into the first route-app wrapper under `src/apps/speed/`.
- The `vatio.speed` manifest now loads `../apps/speed/index.js`; `src/app/views/SpeedView.ts` remains as a compatibility re-export.
- Speed receives scoped runtime GPS, drive-recording, driving-alert, i18n, and logger seams through the existing `mountSpeedRoute()` context while preserving legacy globals and the existing Speed UI/controller.
- Speed's internal geolocation watch path intentionally remains on the existing `navigator.geolocation` shim so Speed recording and Accel can keep concurrent GPS subscriptions across route changes.
- Migrated Board into a conservative route-app wrapper under `src/apps/board/`.
- The `vatio.board` manifest now loads `../apps/board/index.js`; `src/app/views/BoardView.ts` remains as a compatibility re-export.
- Board receives scoped runtime storage, settings, auth, cloud-sync, i18n, and logger seams through the existing `mountBoardRoute()` context while preserving the existing Board UI/controller.
- Board ink color now mirrors through `runtime.services.settings` as `vatioboard.app.vatio.board.settings.inkRaw`, while the legacy `vatio_board_ink_raw` key remains canonical for v1.
- Migrated Library into a conservative route-app wrapper under `src/apps/library/`.
- The `vatio.library` manifest now loads `../apps/library/index.js`; `src/app/views/LibraryView.ts` remains as a compatibility re-export.
- Library receives scoped runtime storage, settings, auth, cloud-sync, i18n, and logger seams through the existing `mountLibraryRoute()` context while preserving the existing Library UI/controller.
- Library active tab now mirrors through `runtime.services.settings` as `vatioboard.app.vatio.library.settings.activeTab`, while the route query `#/library?tab=...` remains canonical for v1.

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
- `src/apps/camera-map/camera-map-app.ts`
- `src/apps/camera-map/camera-map-app.less`
- `src/apps/camera-map/index.ts`
- `src/apps/speed-alerts/speed-alerts-app.ts`
- `src/apps/speed-alerts/speed-alerts-app.less`
- `src/apps/speed-alerts/index.ts`
- `src/apps/player/player-app.ts`
- `src/apps/player/player-app.less`
- `src/apps/player/index.ts`
- `src/apps/milkdrop/milkdrop-app.ts`
- `src/apps/milkdrop/milkdrop-app.less`
- `src/apps/milkdrop/index.ts`
- `src/apps/speed/speed-route-app.ts`
- `src/apps/speed/index.ts`
- `src/apps/board/board-route-app.ts`
- `src/apps/board/index.ts`
- `src/apps/library/library-route-app.ts`
- `src/apps/library/index.ts`
- `src/apps/shared/number-format-settings.ts`
- `src/app-platform/adapters/route-registry-adapter.ts`
- `src/app-platform/adapters/tool-registry-adapter.ts`
- `src/app-platform/adapters/shell-window-registry-adapter.ts`
- `src/app/app-shell.ts`
- `src/app/router.ts`
- `src/app/route-registry.ts`
- `src/app/views/SpeedView.ts`
- `src/app/views/BoardView.ts`
- `src/app/views/LibraryView.ts`
- `src/shared/tool-registry.ts`
- `src/shared/shell-window-registry.ts`
- `src/shared/start-menu.ts`
- `src/speed/speed.ts`
- `src/board/board.ts`
- `src/library/library.ts`
- `src/calculator/calculator-widget.ts`
- `src/calculator/storage.ts`
- `src/energy/energy-calculator-widget.ts`
- `src/energy/trip-cost-storage.ts`
- `src/energy/widget/panel.ts`
- `src/energy/widget/settings-sheet.ts`
- `src/speed/camera-map-widget.ts`
- `src/speed/speed-alert-panel.ts`
- `src/player/player-shell.ts`
- `src/player/player-widget.ts`
- `src/player/milkdrop-panel.ts`
- `src/player/milkdrop-panel-prefs.ts`
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
- `test/unit/camera-map-app.test.js`
- `test/unit/speed-alerts-app.test.js`
- `test/unit/player-app.test.js`
- `test/unit/milkdrop-app.test.js`
- `test/unit/speed-route-app.test.js`
- `test/unit/board-route-app.test.js`
- `test/unit/board-route-lifecycle.test.js`
- `test/unit/library-route-app.test.js`
- `test/unit/library-route-lifecycle.test.js`
- `test/smoke/dev-harness-speed-page.test.js`
- `test/smoke/spa-gps-background.test.js`
- `test/smoke/spa-apps-route.test.js`
- `test/helpers/real-spa-route-smoke.js`
- `docs/vatioboard-os.md`
- `docs/vatioboard-os-implementation-log.md`
- `docs/next-agent-handoff.md`

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

Camera Map migration focused verification:

- `pnpm vitest run test/unit/camera-map-app.test.js` - passed, 1 file and 10 tests.
- `pnpm run typecheck` - passed.
- `pnpm vitest run test/unit/camera-map-app.test.js test/unit/camera-map-widget.test.js test/unit/speed-alert-panel.test.js test/unit/app-platform.test.js` - passed, 4 files and 99 tests.
- `pnpm run lint` - passed with 60 warning-level findings and 0 errors.
- `pnpm test` - first run failed in two known timing-sensitive smoke tests under full-suite load: `coalesces replay persistence under high-frequency recording bursts` and `keeps speed recording and an accel run subscribed across route changes`.
- `pnpm vitest run test/smoke/dev-harness-speed-page.test.js -t "coalesces replay persistence under high-frequency recording bursts"` - passed, 1 file and 1 test with 13 skipped.
- `pnpm vitest run test/smoke/spa-gps-background.test.js -t "keeps speed recording and an accel run subscribed across route changes"` - passed, 1 file and 1 test with 13 skipped.
- `pnpm test` - second run failed only `coalesces replay persistence under high-frequency recording bursts`; the same test had passed isolated.
- Increased only those two long-running smoke test timeouts to reduce full-suite timing brittleness: replay burst coalescing to 60000ms, SPA GPS background route-change coverage to 90000ms.
- `pnpm vitest run test/smoke/dev-harness-speed-page.test.js -t "coalesces replay persistence under high-frequency recording bursts"` - passed after timeout hardening, 1 file and 1 test with 13 skipped.
- `pnpm vitest run test/smoke/spa-gps-background.test.js -t "keeps speed recording and an accel run subscribed across route changes"` - passed after timeout hardening, 1 file and 1 test with 13 skipped.
- `pnpm test` - passed after timeout hardening, 128 files and 1642 tests.
- Final `pnpm run typecheck` - passed.
- Final `pnpm run lint` - passed with 60 warning-level findings and 0 errors.
- `pnpm run build` - passed. Vite still warns for dynamic/static auth and cloud-sync imports, and now also warns that Calculator, Camera Map, and Energy app entries are both manifest dynamic imports and static floating-tools imports for compatibility.

Speed Alerts migration focused and final verification:

- `pnpm run typecheck` - passed.
- `pnpm vitest run test/unit/speed-alerts-app.test.js` - first run failed one new wrapper test because the denied-permission assertion clicked the "Use current speed" button instead of the mute button. The selector was fixed.
- `pnpm vitest run test/unit/speed-alerts-app.test.js` - passed after the selector fix, 1 file and 10 tests.
- `pnpm vitest run test/unit/speed-alerts-app.test.js test/unit/speed-alert-panel.test.js test/unit/camera-map-app.test.js test/unit/app-platform.test.js test/unit/shell-window-integration.test.js` - passed, 5 files and 49 tests.
- `pnpm run lint` - passed with 60 warning-level findings and 0 errors.
- `pnpm test` - first run failed in `test/smoke/spa-gps-background.test.js` on `keeps speed recording and an accel run subscribed across route changes` after the 90000ms timeout. The same test passed isolated immediately afterward.
- `pnpm vitest run test/smoke/spa-gps-background.test.js -t "keeps speed recording and an accel run subscribed across route changes"` - passed, 1 file and 1 test with 13 skipped.
- `pnpm test` - rerun passed, 129 files and 1652 tests.
- `pnpm run build` - passed. Vite still warns for dynamic/static auth and cloud-sync imports, and now also warns that Calculator, Camera Map, Energy, and Speed Alerts app entries are both manifest dynamic imports and static floating-tools imports for compatibility.

Player migration focused and final verification:

- `pnpm run typecheck` - passed after the wrapper and Player shell setting seam were added.
- `pnpm vitest run test/unit/player-app.test.js` - passed, 1 file and 7 tests.
- `pnpm vitest run test/unit/player-app.test.js test/unit/player-widget.test.js test/unit/integrate-player-widget.test.js test/unit/player-cold-boot.test.js test/unit/shell-window-integration.test.js test/smoke/index-page.test.js` - passed, 6 files and 128 tests.
- `pnpm vitest run test/unit/app-shell-runtime-lifecycle.test.js test/unit/spa-route-remount-regression.test.js test/unit/shell-ui-integration.test.js` - passed, 3 files and 36 tests.
- After tightening Player settings fallback seeding, final verification was rerun:
  - `pnpm run typecheck` - passed.
  - `pnpm run lint` - passed with 60 warning-level findings and 0 errors.
  - `pnpm vitest run test/unit/player-app.test.js test/unit/app-platform.test.js test/unit/audio-system.test.js test/unit/audio-channel-retainer.test.js test/unit/integrate-player-widget.test.js` - passed, 5 files and 52 tests.
  - `pnpm test` - passed, 130 files and 1659 tests.
  - `pnpm run build` - passed. Vite still warns for dynamic/static auth and cloud-sync imports, and now also warns that Calculator, Camera Map, Energy, Speed Alerts, and Player app entries are both manifest dynamic imports and static imports used for compatibility.

Milkdrop migration focused verification:

- `pnpm run typecheck` - first run failed because `PlayerShellOptions.onContentOpenChange` was typed as a zero-argument callback while the shell passes a detail object. Fixed the type.
- `pnpm run typecheck` - passed after the type fix.
- `pnpm vitest run test/unit/milkdrop-app.test.js test/unit/milkdrop-panel.test.js test/unit/player-app.test.js test/unit/app-platform.test.js` - passed, 4 files and 45 tests.
- `pnpm run lint` - passed with 60 warning-level findings and 0 errors. Warnings are existing repository warnings in scripts/app/tests areas.
- `pnpm vitest run test/unit/audio-player.test.js test/unit/floating-panel-z-order.test.js test/unit/shell-window-integration.test.js` - passed, 3 files and 170 tests.

Milkdrop migration final verification after documentation updates:

- `pnpm run typecheck` - passed.
- `pnpm run lint` - passed with 60 warning-level findings and 0 errors. Warnings are existing repository warnings in scripts/app/tests areas.
- `pnpm vitest run test/unit/milkdrop-app.test.js test/unit/milkdrop-panel.test.js test/unit/player-app.test.js test/unit/audio-player.test.js test/unit/floating-panel-z-order.test.js test/unit/shell-window-integration.test.js test/unit/app-platform.test.js` - passed, 7 files and 215 tests.
- `pnpm test` - passed, 131 files and 1667 tests.
- `pnpm run build` - passed. The build prepared 1291 ANSV camera features and 73930 speed cameras, then Vite built successfully with 1302 transformed modules. Vite emitted existing dynamic/static import warnings for `backend-auth.ts`, `cloud-sync.ts`, Calculator app entry, Camera Map app entry, Energy app entry, Speed Alerts app entry, and Player app entry.
- A literal final-tree `pnpm test` rerun hit the known full-suite timing-sensitive `test/smoke/spa-gps-background.test.js` test once after 90000ms. The same test passed isolated immediately afterward, and the full `pnpm test` rerun passed again with 131 files and 1667 tests.
- Final `pnpm run build` rerun passed with the same existing Vite dynamic/static import warnings.

Final full-suite commands are also recorded in `docs/vatioboard-os-implementation-log.md`.

Shell-window cold-launch hardening verification:

- `pnpm vitest run test/unit/milkdrop-app.test.js test/unit/player-app.test.js` - passed, 2 files and 20 tests.
- `pnpm run typecheck` - passed.
- `pnpm run lint` - passed with 60 warning-level findings and 0 errors. Warnings are existing repository warnings in scripts/app/tests areas.
- `pnpm vitest run test/unit/app-platform.test.js test/unit/app-shell-runtime-lifecycle.test.js test/unit/milkdrop-app.test.js test/unit/player-app.test.js` - passed, 4 files and 36 tests.
- `pnpm vitest run test/unit/calculator-app.test.js test/unit/energy-app.test.js test/unit/camera-map-app.test.js test/unit/speed-alerts-app.test.js` - passed, 4 files and 35 tests.
- `pnpm test` - passed, 131 files and 1672 tests.
- `pnpm run build` - passed. The build prepared 1291 ANSV camera features and 73930 speed cameras, then Vite built successfully with 1302 transformed modules. Vite emitted existing dynamic/static import warnings for `backend-auth.ts`, `cloud-sync.ts`, Player app entry, Calculator app entry, Camera Map app entry, Energy app entry, and Speed Alerts app entry.

Speed route-app migration verification:

- `pnpm vitest run test/unit/speed-route-app.test.js` - passed, 1 file and 3 tests.
- `pnpm run typecheck` - passed.
- `pnpm vitest run test/unit/speed-route-app.test.js test/smoke/spa-speed-route.test.js` - passed, 2 files and 7 tests.
- `pnpm vitest run test/smoke/spa-gps-background.test.js` - passed, 1 file and 14 tests.
- `pnpm run lint` - passed with 60 warning-level findings and 0 errors. Warnings are existing repository warnings in scripts/app/tests areas.
- `pnpm test` - first full run failed in `test/smoke/spa-gps-background.test.js` after an attempted direct Speed GPS-service watch change. The direct watch change was reverted to preserve Accel/Speed concurrent geolocation behavior through the existing shim.
- `pnpm vitest run test/smoke/spa-gps-background.test.js -t "keeps speed recording and an accel run subscribed across route changes"` - passed after the revert, 1 file and 1 test with 13 skipped.
- `pnpm run typecheck` - passed after the revert.
- `pnpm vitest run test/unit/speed-route-app.test.js test/smoke/spa-speed-route.test.js test/smoke/spa-gps-background.test.js` - passed, 3 files and 21 tests.
- `pnpm test` - passed, 132 files and 1675 tests.
- `pnpm run build` - passed. The build prepared 1291 ANSV camera features and 73930 speed cameras, then Vite built successfully with 1303 transformed modules. Vite emitted existing dynamic/static import warnings for `backend-auth.ts`, `cloud-sync.ts`, Player app entry, Calculator app entry, Camera Map app entry, Energy app entry, and Speed Alerts app entry.
- Final latest-tree rerun after a debug-log cleanup:
  - `pnpm run typecheck` - passed.
  - `pnpm vitest run test/unit/speed-route-app.test.js` - passed, 1 file and 3 tests.
  - `pnpm run lint` - passed with 60 warning-level findings and 0 errors.
  - `pnpm vitest run test/unit/speed-route-app.test.js test/smoke/spa-speed-route.test.js test/smoke/spa-gps-background.test.js` - passed, 3 files and 21 tests.
  - `pnpm test` - passed, 132 files and 1675 tests.
  - `pnpm run build` - passed with the same existing Vite dynamic/static import warnings.

Board route-app migration verification:

- `pnpm vitest run test/unit/board-route-app.test.js test/unit/board-route-lifecycle.test.js test/smoke/spa-board-route.test.js` - passed, 3 files and 7 tests.
- `pnpm run typecheck` - passed.
- `pnpm run lint` - passed with 60 warning-level findings and 0 errors.
- `pnpm vitest run test/unit/app-platform.test.js test/unit/app-shell-runtime-lifecycle.test.js test/unit/board-route-app.test.js test/unit/board-route-lifecycle.test.js test/smoke/spa-board-route.test.js` - passed, 5 files and 23 tests.
- `pnpm test` - passed, 133 files and 1680 tests.
- `pnpm run build` - passed. The build prepared 1291 ANSV camera features and 73930 speed cameras, then Vite built successfully with 1304 transformed modules. Vite emitted existing dynamic/static import warnings for `backend-auth.ts`, `cloud-sync.ts`, Player app entry, Calculator app entry, Camera Map app entry, Energy app entry, and Speed Alerts app entry.

Library route-app migration verification:

- `pnpm vitest run test/unit/library-route-app.test.js test/unit/library-route-lifecycle.test.js test/smoke/spa-library-route.test.js` - first run failed because the test backend-auth mock did not export `BACKEND_AUTH_SIGNUP_URL`; fixed the mock. The same run also exposed that `vatio.library` needed `settings.write` for the new active-tab mirror.
- `pnpm vitest run test/unit/library-route-app.test.js test/unit/library-route-lifecycle.test.js test/smoke/spa-library-route.test.js` - passed after fixes, 3 files and 8 tests.
- `pnpm run typecheck` - first run failed on the active-tab type guard in `src/library/library.ts`; fixed with an explicit `TAB_ORDER` union cast.
- `pnpm run typecheck` - passed after the type guard fix.
- `pnpm run lint` - passed with 60 warning-level findings and 0 errors.
- `pnpm vitest run test/unit/app-platform.test.js test/unit/app-shell-runtime-lifecycle.test.js test/unit/library-route-app.test.js test/unit/library-route-lifecycle.test.js test/unit/library-offline-media.test.js test/smoke/spa-library-route.test.js` - passed, 6 files and 119 tests.
- `pnpm test` - passed, 135 files and 1686 tests.
- `pnpm run build` - passed. The build prepared 1291 ANSV camera features and 73930 speed cameras, then Vite built successfully with 1305 transformed modules. Vite emitted existing dynamic/static import warnings for `backend-auth.ts`, `cloud-sync.ts`, Player app entry, Calculator app entry, Camera Map app entry, Energy app entry, and Speed Alerts app entry.

## Known Limitations

- App permissions are declared and enforced at the runtime boundary, but there are no user prompts yet.
- App service declarations are now enforced with permissions, but this is still an internal runtime boundary rather than a sandbox.
- App-private storage is localStorage-backed only.
- Existing apps still import many global helpers directly; migration to `appRuntime` should be gradual. Calculator, Energy, Camera Map, Speed Alerts, Player, and Milkdrop are partially migrated through app wrappers, but Calculator expression state/history, Energy trip values/multi-trip records, Camera Map local/offline data storage, Speed Alerts panel internals, Player queue/session restore, Player media cache, Milkdrop preset/position/size persistence, and shell layout storage remain legacy for compatibility.
- Speed is now route-wrapper migrated, but its internal replay/recording persistence, preferences, geolocation watch implementation, and many globals remain legacy for compatibility.
- Board is now route-wrapper migrated, but drawing/draft persistence, cloud sync, auth, document metadata, export/import, offline mutations, and most Board globals remain legacy for compatibility.
- Library is now route-wrapper migrated, but media cache, pinned media, media manifests, downloads, playlist loading, cloud sync, auth, import/export actions, and most Library globals remain legacy for compatibility.
- Calculator and Energy intentionally share number-format settings through `embeddable_calc_settings_v1` in v1. Their app-private runtime settings are mirrors until a true platform shared-settings service exists.
- Existing global compatibility shims remain in place.
- Background-service lifecycle is registered in types but not heavily implemented.
- Shell-window runtimes are created and cached. Calculator, Energy, Camera Map, Speed Alerts, Player, and Milkdrop now consume their runtimes through app wrappers and can be cold-launched through manifest entries.
- Shell-window cold launch is trusted-internal and same-document only. `openApp()` returns `true` once the lazy entry load is scheduled, before the import has finished and the panel is visible.
- App settings are local-only through app-private storage and do not sync yet.
- Two long GPS/speed smoke tests have larger per-test timeouts because they repeatedly passed in isolation but timed out under full-suite load.
- Community/external app loading is intentionally not implemented.

## Suggested Next Prompt

Continue VatioBoard OS after Speed, Board, and Library have been route-wrapper migrated. Migrate Replay next without rewriting `src/replay/replay.ts`. Preserve `#/replay`, local replay/session history, cloud-sync/auth behavior, route playback controls, map/chart lifecycle, and direct/dev route usage. Create a conservative `src/apps/replay` wrapper, keep `src/app/views/ReplayView.ts` as a compatibility re-export if safe, pass scoped runtime storage/settings/auth/cloud-sync/driveRecording/i18n/logger seams through the existing route context, migrate only one low-risk preference seam, add focused route/runtime tests, then run full `pnpm test` and `pnpm run build`.

## Manual QA

- Desktop browser: load `/`, open the start menu, confirm Speed/Board/Library/Replay/Accel/Apps appear and launch.
- Desktop browser: visit `#/speed`, start recording, navigate to `#/accel`, confirm Speed recording remains active while Accel receives GPS fixes, then return to `#/speed` and stop recording.
- Desktop browser: visit `#/apps`, search/filter apps, and launch a route app and a shell-window app.
- Desktop browser: from a fresh reload, use `#/apps` to launch Milkdrop or another shell-window app before opening it from legacy floating tools, and confirm it appears in the taskbar with one panel.
- Mobile browser: verify `#/apps` cards, filter, and buttons fit without horizontal scrolling.
- Tesla browser: verify `#/speed`, `#/board`, `#/library`, `#/replay`, `#/accel`, and `#/apps` load; open Calculator, Energy, Camera Map, Speed Alerts, Player, and Milkdrop from their existing surfaces; use Calculator's Energy button and confirm Energy opens/focuses.
- Tesla browser: open Speed Alerts, tap its Camera Map button, and confirm Camera Map opens/focuses and follows GPS when location permission is available.
- Tesla browser: enable Speed Alerts, prime alert audio from a tap, toggle mute/sound options, close/reopen the panel, and confirm preferences persist and alerts still do not appear in the activity indicator until audio is explicitly armed.
- Tesla browser: open Player, play/pause/skip a demo or local track, close and reopen the panel while audio continues, refresh and confirm queue/session restore, and verify Media Session controls still target Player.
- Tesla browser: from Player, open Milkdrop, cycle/shuffle presets, resize/fullscreen/close/reopen it, and confirm audio playback continues and the panel restores its visibility/position behavior.
- Offline/glitch QA: load once, go offline, refresh `#/apps` and core local-first routes, and confirm the shell does not crash.
