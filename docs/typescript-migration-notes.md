# TypeScript Migration Notes

## Typed In This Batch

- TypeScript tooling, `tsconfig.json`, `typecheck`, and `verify` are in place.
- Shared contracts now live under `src/types/` for routes, cleanup stacks, shell windows, tools, services, UI design, storage, and existing `window.__vatioboard...` globals.
- The route and shell core has moved to TypeScript: router, routes, route-view, cleanup stack, runtime context, app shell, shell window/layout/snap/taskbar/work-area, floating layer/tools, start menu, and tools menu.
- Typed registries now define routes, persistent shell windows, tools, and UI design tokens:
  - `src/app/route-registry.ts`
  - `src/shared/shell-window-registry.ts`
  - `src/shared/tool-registry.ts`
  - `src/shared/ui-design-contract.ts`
- The shared service boundary has moved to TypeScript while preserving existing public APIs and singleton ownership:
  - `src/app/services/gps-service.ts`
  - `src/app/services/driving-alert-service.ts`
  - `src/app/services/driving-audio-alert-controller.ts`
  - `src/app/services/drive-recording-service.ts`
  - `src/shared/audio-runtime.ts`
  - `src/shared/audio-system.ts`
  - `src/shared/audio-cue.ts`
  - `src/shared/media-player.ts`
  - `src/shared/backend-auth.ts`
  - `src/shared/cloud-sync.ts`
  - `src/shared/indexed-storage.ts`
  - `src/shared/storage-capability.ts`
- Service-adjacent shared helpers, media/cache helpers, base storage, repositories, and small pure logic utilities have now moved to TypeScript:
  - `src/shared/audio-catalog.ts`
  - `src/shared/audio-channel-retainer.ts`
  - `src/shared/audio-graph-registry.ts`
  - `src/shared/audio-mini-visualizer.ts`
  - `src/shared/audio-source-resolver.ts`
  - `src/shared/audio-visualizer.ts`
  - `src/shared/media-access-cache.ts`
  - `src/shared/media-cache.ts`
  - `src/shared/media-session-adapter.ts`
  - `src/shared/player-session.ts`
  - `src/shared/playlist-cache.ts`
  - `src/shared/playlist-loader.ts`
  - `src/shared/storage.ts`
  - `src/shared/repositories/accel-repository.ts`
  - `src/shared/repositories/board-document-repository.ts`
  - `src/shared/repositories/replay-repository.ts`
  - `src/shared/display-format.ts`
  - `src/shared/geo-heading.ts`
  - `src/calculator/calc-core.ts`
  - `src/energy/energy-core.ts`

## Contracts Future Work Must Use

- Add SPA routes through `defineRoute` in `src/app/route-registry.ts`.
- Add persistent shell windows through `defineShellWindow` in `src/shared/shell-window-registry.ts`.
- Expose start-menu, floating, taskbar, or launcher tools through `defineTool` in `src/shared/tool-registry.ts`.
- Consume app-level GPS, driving-alert, drive-recording, and audio services through the interfaces in `src/types/services.ts`; routes should not create competing watches, camera databases, audio engines, or cloud sync loops.
- Use `--vb-touch-target-min` and the `--vb-safe-area-*` tokens for shell/mobile touch surfaces.
- Service consumers should keep using the existing exported functions and shared instances. This batch preserved the GPS watch owner, driving alert service state flow, lazy audio runtime/system, backend auth session surface, cloud sync loop ownership, IndexedDB keys, storage capability probes, and media player/audio cue contracts.
- Audio/media consumers should keep importing the same public `.js` specifiers. This phase preserved lazy Web Audio creation, gesture-compatible priming, Media Session ownership, player-session keys, media-access memory-only semantics, media-cache IndexedDB database/store names, user-scoped cache keys, manifest/playlist record shapes, and signed-URL non-persistence.
- Repository consumers should keep using the existing public functions. This phase preserved cloud handoff resource names, route hashes returned by cloud-open helpers, restore de-duplication/failure cooldown behavior, local import/persistence calls, and repository payload shapes for accel runs, board documents, and replay sessions.
- Base storage helpers still use the same localStorage keys supplied by callers and keep the same fallback behavior for text, booleans, numbers, JSON, and removals.

## Still JavaScript

- Feature UI modules remain JavaScript to keep this batch reviewable: speed, camera map, accel, library, player shell, board, replay, calculator, and energy UI.
- No files under `src/app/services/` remain JavaScript.
- No files under `src/shared/repositories/` remain JavaScript.
- Shared helper files still in JavaScript include `activity-indicator`, `activity-state`, `analog-speedometer`, `chunked-blob-store`, `cloud-library-open`, `cloud-library-resources`, `cloud-library`, `cloud-sync-status-indicator`, `demo-cache`, `environment`, `maplibre-loader`, `navigation-payload-handoff`, `nominatim`, `place-resolver`, `route-boundary`, `route-string`, `shell-keyboard`, `shell-layers`, `single-tab`, `track-model`, `track-source-policy`, `unit-bootstrap`, and `ui/confirm-dialog`.
- Feature/domain storage and session helpers still in JavaScript include `src/accel/storage.js`, `src/board/storage.js`, `src/calculator/storage.js`, `src/energy/trip-cost-storage.js`, and `src/replay/session.js`.

## Next Recommended Batch

Convert the remaining small shared helper dependencies next: `track-model.js`, `track-source-policy.js`, `demo-cache.js`, `chunked-blob-store.js`, `navigation-payload-handoff.js`, and `environment.js`. After those are stable, move through small feature storage/session helpers such as calculator settings/history storage and trip-cost storage. Keep large UI/domain-heavy modules such as speed, camera map, accel, library, player shell, board, replay, and route-boundary/route-string work for a later, focused batch.
