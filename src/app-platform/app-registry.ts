import { BUILTIN_APP_MANIFESTS } from "./builtin-apps.js";
import { validateAppManifest as validateManifestShape } from "./manifest.js";
import type {
  VatioAppId,
  VatioAppManifest,
  VatioAppManifestValidationResult,
  VatioAppPermission,
  VatioAppRegistry,
  VatioAppSurface,
} from "./types";

interface RegistryOptions {
  logger?: Pick<Console, "warn"> | null;
}

function compareApps(a: VatioAppManifest, b: VatioAppManifest) {
  return (a.order - b.order) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

function normalizeRoutePath(path: string) {
  const value = String(path || "").trim();
  if (!value || value === "/") return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
}

export function createAppRegistry({ logger = console }: RegistryOptions = {}): VatioAppRegistry {
  const appsById = new Map<VatioAppId, VatioAppManifest>();
  const routeOwners = new Map<string, VatioAppId>();
  const shellWindowOwners = new Map<string, VatioAppId>();
  const legacyToolOwners = new Map<string, VatioAppId>();

  function validateAppManifest(manifest: VatioAppManifest): VatioAppManifestValidationResult {
    return validateManifestShape(manifest);
  }

  function registerApp(manifest: VatioAppManifest): boolean {
    const validation = validateAppManifest(manifest);
    if (!validation.ok) {
      logger?.warn?.("[vatioboard:app-registry] Invalid app manifest skipped.", {
        appId: manifest?.id,
        errors: validation.errors,
        warnings: validation.warnings,
      });
      return false;
    }

    if (appsById.has(manifest.id)) {
      logger?.warn?.(`[vatioboard:app-registry] Duplicate app id "${manifest.id}" skipped.`);
      return false;
    }

    const routePaths = [
      ...(manifest.route ? [manifest.route] : []),
      ...(manifest.aliases || []),
    ].map(normalizeRoutePath);
    const uniqueRoutePaths = new Set<string>();
    for (const routePath of routePaths) {
      if (uniqueRoutePaths.has(routePath)) {
        logger?.warn?.(`[vatioboard:app-registry] Duplicate route or alias "${routePath}" inside app "${manifest.id}" skipped.`);
        return false;
      }
      uniqueRoutePaths.add(routePath);

      const owner = routeOwners.get(routePath);
      if (owner) {
        logger?.warn?.(`[vatioboard:app-registry] Route or alias "${routePath}" for app "${manifest.id}" conflicts with "${owner}" and was skipped.`);
        return false;
      }
    }

    const shellWindowId = manifest.window?.shellWindowId;
    if (shellWindowId) {
      const owner = shellWindowOwners.get(shellWindowId);
      if (owner) {
        logger?.warn?.(`[vatioboard:app-registry] Shell window id "${shellWindowId}" for app "${manifest.id}" conflicts with "${owner}" and was skipped.`);
        return false;
      }
    }

    const legacyToolId = typeof manifest.metadata.legacyToolId === "string"
      ? manifest.metadata.legacyToolId.trim()
      : "";
    if (legacyToolId) {
      const owner = legacyToolOwners.get(legacyToolId);
      if (owner) {
        logger?.warn?.(`[vatioboard:app-registry] Legacy tool id "${legacyToolId}" for app "${manifest.id}" conflicts with "${owner}" and was skipped.`);
        return false;
      }
    }

    if (validation.warnings.length) {
      logger?.warn?.("[vatioboard:app-registry] App manifest warnings.", {
        appId: manifest.id,
        warnings: validation.warnings,
      });
    }

    appsById.set(manifest.id, manifest);
    for (const routePath of uniqueRoutePaths) routeOwners.set(routePath, manifest.id);
    if (shellWindowId) shellWindowOwners.set(shellWindowId, manifest.id);
    if (legacyToolId) legacyToolOwners.set(legacyToolId, manifest.id);
    return true;
  }

  function registerApps(manifests: readonly VatioAppManifest[]) {
    const registered: VatioAppManifest[] = [];
    for (const manifest of manifests) {
      if (registerApp(manifest)) registered.push(manifest);
    }
    return registered.sort(compareApps);
  }

  function listApps() {
    return Array.from(appsById.values()).sort(compareApps);
  }

  function getApp(id: VatioAppId) {
    return appsById.get(id) || null;
  }

  function listAppsForSurface(surface: VatioAppSurface) {
    return listApps().filter((app) => app.surfaces.includes(surface));
  }

  function getAppByRoute(path: string) {
    const normalizedPath = normalizeRoutePath(path);
    return listApps().find((app) =>
      (app.route ? normalizeRoutePath(app.route) === normalizedPath : false)
      || app.aliases?.map(normalizeRoutePath).includes(normalizedPath)
    ) || null;
  }

  function getAppsForPermission(permission: VatioAppPermission) {
    return listApps().filter((app) => app.permissions.includes(permission));
  }

  return {
    registerApp,
    registerApps,
    getApp,
    listApps,
    listAppsForSurface,
    getAppByRoute,
    getAppsForPermission,
    validateAppManifest,
  };
}

export const appRegistry = createAppRegistry();
appRegistry.registerApps(BUILTIN_APP_MANIFESTS);

export const registerApp = appRegistry.registerApp;
export const registerApps = appRegistry.registerApps;
export const getApp = appRegistry.getApp;
export const listApps = appRegistry.listApps;
export const listAppsForSurface = appRegistry.listAppsForSurface;
export const getAppByRoute = appRegistry.getAppByRoute;
export const getAppsForPermission = appRegistry.getAppsForPermission;
export const validateAppManifest = appRegistry.validateAppManifest;
