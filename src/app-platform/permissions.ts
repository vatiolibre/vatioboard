import type {
  VatioAppManifest,
  VatioAppPermission,
  VatioAppPermissionRuntime,
  VatioAppLogger,
} from "./types";

export function createAppPermissionRuntime(
  manifest: VatioAppManifest,
  logger?: Pick<VatioAppLogger, "warn"> | null,
): VatioAppPermissionRuntime {
  const declaredPermissions = new Set(manifest.permissions || []);

  function warnMissing(permission: VatioAppPermission) {
    logger?.warn?.(`Permission denied: ${permission}. Declare it in the app manifest before using this API.`);
  }

  return {
    has(permission) {
      return declaredPermissions.has(permission);
    },
    require(permission) {
      const allowed = declaredPermissions.has(permission);
      if (!allowed) warnMissing(permission);
      return allowed;
    },
    list() {
      return Array.from(declaredPermissions);
    },
  };
}
