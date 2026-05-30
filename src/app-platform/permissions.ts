import type {
  VatioAppControlService,
  VatioAppManifest,
  VatioAppPermission,
  VatioAppPermissionRuntime,
  VatioAppLogger,
} from "./types";
import { appControl } from "./app-control.js";
import { appRegistry } from "./app-registry.js";

export function createAppPermissionRuntime(
  manifest: VatioAppManifest,
  logger?: Pick<VatioAppLogger, "warn"> | null,
  control: VatioAppControlService = appControl,
): VatioAppPermissionRuntime {
  const declaredPermissions = new Set(manifest.permissions || []);
  const useControlState = control !== appControl || appRegistry.getApp(manifest.id) !== null;

  function warnMissing(permission: VatioAppPermission) {
    logger?.warn?.(`Permission denied: ${permission}. Declare it in the app manifest before using this API.`);
  }

  function warnNotGranted(permission: VatioAppPermission) {
    logger?.warn?.(`Permission denied: ${permission}. Grant it in App Manager before using this API.`);
  }

  function isGranted(permission: VatioAppPermission) {
    if (!useControlState) return declaredPermissions.has(permission);
    return control.hasGrantedPermission(manifest.id, permission);
  }

  return {
    has(permission) {
      return declaredPermissions.has(permission) && isGranted(permission);
    },
    require(permission) {
      if (!declaredPermissions.has(permission)) {
        warnMissing(permission);
        return false;
      }
      const allowed = isGranted(permission);
      if (!allowed) warnNotGranted(permission);
      return allowed;
    },
    list() {
      return Array.from(declaredPermissions).filter((permission) => isGranted(permission));
    },
  };
}
