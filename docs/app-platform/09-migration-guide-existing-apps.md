# Migration Guide For Existing Apps

The platform already supports manifests, generated routes, shell windows, runtime services, app control, permissions, storage, and background service lifecycle. Existing apps can move toward the v1 pattern incrementally.

## Route Apps

- Move legacy route/view wrappers toward app-owned modules under `src/apps/<name>/`.
- Keep `createRouteView()` as the normal route wrapper.
- Prefer runtime services over `window.__vatioboard...` globals.
- Use `routeContext.cleanup` and `routeSignal` for route-owned work.
- Do not manually add normal production routes to `src/app/route-registry.ts`; routes come from manifests.

## Shell-Window Apps

- Ensure the entry exports `createShellWindowApp()`.
- Ensure `manifest.window.shellWindowId` matches the registered window id.
- Let the launcher focus or restore existing windows.
- Move simple preferences to `runtime.storage` or `runtime.services.settings`.
- Keep legacy standalone harnesses unless there is a specific reason to remove them.

## Storage

- Migrate global `localStorage` keys into `runtime.storage` where safe.
- Do not break existing data without a migration path.
- Keep compatibility reads until users have had a safe path to new storage.
- Add app-specific README/storage notes when an app owns complex data.

## Manifests

Built-in manifests used to live only in `src/app-platform/builtin-apps.ts`. New and migrated apps should own a `manifest.ts` next to the app entry.

Good first migrations are low-risk apps with clear boundaries:

- `src/apps/speed/manifest.ts`
- `src/apps/board/manifest.ts`
- `src/apps/calculator/manifest.ts`

Migrate remaining built-ins app-by-app. Avoid changing route paths, ids, window ids, permissions, or metadata during a manifest move.

## Runtime Services

When replacing fallbacks:

1. Read from `runtime.services.<service>` first.
2. Keep the legacy fallback only when old harnesses still need it.
3. Add a test that proves the runtime path works.
4. Add a follow-up note if the fallback should be removed later.

## Compatibility Metadata

Keep metadata such as `legacyToolId`, `legacyHref`, `legacyToolSurfaces`, and `legacyShellKind` only while adapters need it. Do not put new runtime behavior in metadata when a typed manifest field belongs in `VatioAppManifest`.

