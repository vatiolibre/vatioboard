# Agent Quickstart

This is the shortest path for a coding agent working on VatioBoard apps without wasting context.

## Read Order

1. [`README.md`](../README.md)
2. [`docs/app-platform/00-overview.md`](app-platform/00-overview.md)
3. The relevant app type doc:
   - [`01-create-a-route-app.md`](app-platform/01-create-a-route-app.md)
   - [`02-create-a-shell-window-app.md`](app-platform/02-create-a-shell-window-app.md)
   - [`03-create-a-background-service.md`](app-platform/03-create-a-background-service.md)
4. [`docs/app-platform/04-manifest-reference.md`](app-platform/04-manifest-reference.md)
5. [`docs/app-platform/05-runtime-services.md`](app-platform/05-runtime-services.md)
6. [`docs/app-platform/08-testing-new-apps.md`](app-platform/08-testing-new-apps.md)

## Source-Of-Truth Files

- `src/app-platform/types.ts`
- `src/app-platform/manifest.ts`
- `src/app-platform/builtin-apps.ts`
- `src/app-platform/runtime.ts`
- `scripts/create-app.mjs`

## Rules

- Use the generator first.
- Add or import the manifest in `src/app-platform/builtin-apps.ts`.
- Do not manually add normal production routes to `src/app/route-registry.ts`.
- Declare both permissions and services.
- Use `runtime.storage`, `runtime.i18n`, `runtime.services.settings`, and `runtime.services.sharedSettings` correctly.
- Keep raw `localStorage` or IndexedDB only for legacy compatibility or large app-owned data, and document keys/databases.
- Add tests.
- Run `pnpm run verify`.

## Common Mistakes

- Declaring a permission but forgetting the service.
- Declaring a service but forgetting the permission.
- Using `runtime.services.storage` instead of `runtime.storage`.
- Using `runtime.services.i18n` instead of `runtime.i18n`.
- Using `runtime.services.shell` instead of gated APIs on `runtime.shell`.
- Duplicating route IDs, route paths, aliases, or shell window IDs.
- Adding undocumented global storage keys.
- Moving legacy storage without a migration.
