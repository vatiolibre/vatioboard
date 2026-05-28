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

## Important Files Changed

- `src/app-platform/types.ts`
- `src/app-platform/builtin-apps.ts`
- `src/app-platform/app-registry.ts`
- `src/app-platform/runtime.ts`
- `src/app-platform/launcher.ts`
- `src/app-platform/storage.ts`
- `src/app-platform/services.ts`
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

Final full-suite commands are recorded in `docs/vatioboard-os-implementation-log.md`.

## Known Limitations

- App permissions are declared and enforced at the runtime boundary, but there are no user prompts yet.
- App-private storage is localStorage-backed only.
- Existing apps still import many global helpers directly; migration to `appRuntime` should be gradual.
- Existing global compatibility shims remain in place.
- Background-service lifecycle is registered in types but not heavily implemented.
- Community/external app loading is intentionally not implemented.

## Suggested Next Prompt

Continue the VatioBoard OS migration by moving one small shell-window tool, such as Calculator or Energy, behind a first-class app module in `src/apps/<app-id>`. Use `routeContext.context.appRuntime` or a shell app runtime instead of direct global imports where practical, keep the compatibility registry exports working, and add tests that prove the app can launch through the manifest-backed launcher.

## Manual QA

- Desktop browser: load `/`, open the start menu, confirm Speed/Board/Library/Replay/Accel/Apps appear and launch.
- Desktop browser: visit `#/apps`, search/filter apps, and launch a route app and a shell-window app.
- Mobile browser: verify `#/apps` cards, filter, and buttons fit without horizontal scrolling.
- Tesla browser: verify `#/speed`, `#/board`, `#/library`, `#/replay`, `#/accel`, and `#/apps` load; open Calculator, Energy, Camera Map, Speed Alerts, Player, and Milkdrop from their existing surfaces.
- Offline/glitch QA: load once, go offline, refresh `#/apps` and core local-first routes, and confirm the shell does not crash.
