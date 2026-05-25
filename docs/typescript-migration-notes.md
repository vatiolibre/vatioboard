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

## Contracts Future Work Must Use

- Add SPA routes through `defineRoute` in `src/app/route-registry.ts`.
- Add persistent shell windows through `defineShellWindow` in `src/shared/shell-window-registry.ts`.
- Expose start-menu, floating, taskbar, or launcher tools through `defineTool` in `src/shared/tool-registry.ts`.
- Consume app-level GPS, driving-alert, drive-recording, and audio services through the interfaces in `src/types/services.ts`; routes should not create competing watches, camera databases, audio engines, or cloud sync loops.
- Use `--vb-touch-target-min` and the `--vb-safe-area-*` tokens for shell/mobile touch surfaces.
- Service consumers should keep using the existing exported functions and shared instances. This batch preserved the GPS watch owner, driving alert service state flow, lazy audio runtime/system, backend auth session surface, cloud sync loop ownership, IndexedDB keys, storage capability probes, and media player/audio cue contracts.

## Still JavaScript

- Feature UI modules remain JavaScript to keep this batch reviewable: speed, camera map, accel, library, player shell, board, replay, calculator, and energy UI.
- No files under `src/app/services/` remain JavaScript.
- Service-adjacent shared helpers remain JavaScript for now: `audio-catalog`, `audio-channel-retainer`, `audio-graph-registry`, `audio-mini-visualizer`, `audio-source-resolver`, `audio-visualizer`, and base `storage`.
- Pure logic and repository modules remain JavaScript until the next conversion batch.

## Next Recommended Batch

Convert the service-adjacent shared helpers and repositories next, especially the audio source/visualizer helpers, base storage helper, media cache/access modules, and data repositories consumed by the newly typed services. Keep large feature UI files such as speed, camera map, accel, library, player shell, board, and replay for a later batch.
