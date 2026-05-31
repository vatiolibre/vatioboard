# Permissions

Permissions are declared in the manifest and enforced through the app runtime. They are separate from service declarations.

```ts
permissions: ["gps.read"],
services: ["gps"],
```

`appControl` stores permission grants and revocations. App Manager uses it to show permission toggles. Stable, beta, experimental, and internal built-ins are auto-granted their declared permissions unless the user revokes a non-protected permission.

Protected apps and protected critical permissions cannot be disabled or revoked when doing so would break the shell. Examples include Speed, App Manager, and Offline Readiness critical permissions.

## Runtime Helpers

- `runtime.permissions.has(permission)`: returns true only when declared and currently granted.
- `runtime.permissions.require(permission)`: returns true when allowed; logs a scoped warning and returns false when denied.
- `runtime.permissions.list()`: lists currently effective permissions.

Denied behavior should be graceful. Disable the feature, show local/offline state, or use a read-only fallback. Do not crash the route or window because a permission is missing.

## Least Privilege Examples

Storage-only app:

```ts
permissions: ["storage.app", "i18n.read"],
services: ["storage", "i18n"],
```

GPS app:

```ts
permissions: ["gps.read", "gps.highAccuracy", "storage.app"],
services: ["gps", "storage"],
```

Audio app:

```ts
permissions: ["audio.playback", "audio.background", "storage.app"],
services: ["audio", "storage"],
```

Cloud-sync app:

```ts
permissions: ["cloud.sync", "auth.session", "network.backend", "storage.app"],
services: ["cloudSync", "auth", "storage"],
```

Shell launcher app:

```ts
permissions: ["shell.launchApp", "i18n.read"],
services: ["shell", "i18n"],
```

Shell-window app:

```ts
permissions: ["shell.window", "storage.app", "settings.read", "settings.write"],
services: ["shell", "storage", "settings"],
```

Choose the smallest set that supports the app. Add permissions when a real feature needs them, not as a future wish list.

