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

## Contracts Future Work Must Use

- Add SPA routes through `defineRoute` in `src/app/route-registry.ts`.
- Add persistent shell windows through `defineShellWindow` in `src/shared/shell-window-registry.ts`.
- Expose start-menu, floating, taskbar, or launcher tools through `defineTool` in `src/shared/tool-registry.ts`.
- Consume app-level GPS, driving-alert, drive-recording, and audio services through the interfaces in `src/types/services.ts`; routes should not create competing watches, camera databases, audio engines, or cloud sync loops.
- Use `--vb-touch-target-min` and the `--vb-safe-area-*` tokens for shell/mobile touch surfaces.

## Still JavaScript

- Feature UI modules remain JavaScript to keep this batch reviewable: speed, camera map, accel, library, player shell, board, replay, calculator, and energy UI.
- Shared service implementations remain JavaScript for now: GPS, driving alerts/audio, drive recording, cloud sync, audio runtime/system/cue, media player, backend auth, and storage capability.
- Pure logic and repository modules remain JavaScript until the next conversion batch.

## Next Recommended Batch

Convert the shared service boundary next: `gps-service`, `driving-alert-service`, `driving-audio-alert-controller`, `drive-recording-service`, `audio-runtime`, `audio-system`, `audio-cue`, `media-player`, `backend-auth`, `cloud-sync`, `indexed-storage`, and `storage-capability`. Keep singleton ownership intact and add typed snapshots/subscriptions as each service moves.
