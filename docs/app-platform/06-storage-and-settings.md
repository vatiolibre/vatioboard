# Storage And Settings

VatioBoard is local-first. New apps should keep their core state in the browser and use the platform storage APIs unless there is a clear reason not to.

## App-Private Storage

`runtime.storage` writes under:

```txt
vatioboard.app.<appId>.<key>
```

For example, `runtime.storage.setItem("draft", "...")` in `vatio.notes` writes a browser key like:

```txt
vatioboard.app.vatio.notes.draft
```

Do not include the namespace yourself. Use short app-local keys.

App Manager can list, estimate, export, import, and reset app-private storage. Resetting app-private storage does not reset App Manager control state.

## Limitations

`runtime.storage` is backed by browser storage and is best for small strings, JSON preferences, short drafts, and status markers. It is not the right place for large media blobs, long histories, map tiles, or large queryable records.

## When To Use Each Store

- `runtime.storage`: simple private state, drafts, flags, small JSON.
- `runtime.services.settings`: app preferences that fit the app settings namespace.
- `runtime.services.sharedSettings`: cross-app OS preferences such as units, language, UI density, or shared audio defaults.
- IndexedDB: large structured records, recordings, media caches, offline datasets, and query-heavy app-owned data.
- Raw `localStorage` or `sessionStorage`: legacy compatibility and migrations only.

## Rules For New Apps

- New apps must not create undocumented global `localStorage` keys.
- New apps should use `runtime.storage` for simple private state.
- New apps should use `runtime.services.settings` for app preferences.
- Large structured records should use an app-owned IndexedDB wrapper.
- Any app using raw `localStorage`, `sessionStorage`, or IndexedDB must document the keys/database in the app README or storage docs.

For IndexedDB, document:

- Database name.
- Version number.
- Object stores.
- Indexes.
- Migration behavior.
- What can be safely deleted.

## Migration Strategy

Many existing apps still have legacy global keys. Migrate carefully:

1. Keep reading the legacy key.
2. Write the value into `runtime.storage` or runtime settings.
3. Keep the old key until a safe cleanup window exists.
4. Avoid changing user-visible behavior during migration.
5. Add tests for both old and new data.
6. Document the migration in the app docs.

Never delete legacy user data just because a new namespace exists.

