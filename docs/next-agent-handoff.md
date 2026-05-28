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
- `src/app-platform/adapters/route-registry-adapter.ts`
- `src/app-platform/adapters/tool-registry-adapter.ts`
- `src/app-platform/adapters/shell-window-registry-adapter.ts`
- `src/app/app-shell.ts`
- `src/app/router.ts`
- `src/app/route-registry.ts`
- `src/shared/tool-registry.ts`
- `src/shared/shell-window-registry.ts`
- `src/shared/start-menu.ts`
- `src/types/route.ts`
- `src/app/views/AppsView.ts`
- `src/app/views/templates/apps-template.ts`
- `src/apps/app-manager/app-manager.ts`
- `src/apps/app-manager/app-manager.less`
- `src/i18n.ts`
- `test/unit/app-platform.test.js`
- `test/unit/app-shell-runtime-lifecycle.test.js`
- `test/smoke/spa-apps-route.test.js`
- `test/helpers/real-spa-route-smoke.js`
- `docs/vatioboard-os.md`
- `docs/vatioboard-os-implementation-log.md`

## Commands Run

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
- Hardening pass: `pnpm run typecheck` - passed during implementation.
- Hardening pass: `pnpm vitest run test/unit/app-platform.test.js test/unit/app-shell-runtime-lifecycle.test.js` - passed, 2 files and 15 tests.
- Hardening pass: `pnpm vitest run test/smoke/spa-apps-route.test.js test/smoke/index-page.test.js` - passed, 2 files and 9 tests.

Final full-suite commands are recorded in `docs/vatioboard-os-implementation-log.md`.

## Known Limitations

- App permissions are declared and enforced at the runtime boundary, but there are no user prompts yet.
- App-private storage is localStorage-backed only.
- Existing apps still import many global helpers directly; migration to `appRuntime` should be gradual.
- Existing global compatibility shims remain in place.
- Background-service lifecycle is registered in types but not heavily implemented.
- Shell-window runtimes are created and cached, but Calculator/Energy/etc. have not yet been refactored to accept runtime directly.
- App settings are local-only through app-private storage and do not sync yet.
- Community/external app loading is intentionally not implemented.

## Suggested Next Prompt

Continue the VatioBoard OS migration by moving Calculator or Energy behind a first-class shell-window app module in `src/apps/<app-id>`. Use `routeContext.context.shellAppRuntimeManager.ensureRuntime("vatio.calculator")` or the equivalent manifest app ID to retrieve the scoped runtime, move app preferences to `runtime.services.settings`, use `runtime.storage` only for app data, preserve the existing floating-tool toggles and shell-window IDs, and add tests proving the app opens through the manifest-backed launcher and still works through the legacy start menu path.

## Manual QA

- Desktop browser: load `/`, open the start menu, confirm Speed/Board/Library/Replay/Accel/Apps appear and launch.
- Desktop browser: visit `#/apps`, search/filter apps, and launch a route app and a shell-window app.
- Mobile browser: verify `#/apps` cards, filter, and buttons fit without horizontal scrolling.
- Tesla browser: verify `#/speed`, `#/board`, `#/library`, `#/replay`, `#/accel`, and `#/apps` load; open Calculator, Energy, Camera Map, Speed Alerts, Player, and Milkdrop from their existing surfaces.
- Offline/glitch QA: load once, go offline, refresh `#/apps` and core local-first routes, and confirm the shell does not crash.
