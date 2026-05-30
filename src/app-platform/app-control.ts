import { appRegistry } from "./app-registry.js";
import {
  readAppControlRecord,
  removeAppControlState,
  writeAppControlRecord,
} from "./app-control-storage.js";
import type { StorageLike } from "../types/storage";
import type {
  VatioAppControlService,
  VatioAppControlState,
  VatioAppId,
  VatioAppManifest,
  VatioAppPermission,
  VatioAppRegistry,
  VatioAppStoragePolicy,
} from "./types";

const PROTECTED_APP_IDS = new Set<VatioAppId>([
  "vatio.speed",
  "vatio.appManager",
]);

const VALID_STORAGE_POLICIES = new Set<VatioAppStoragePolicy>([
  "default",
  "local-only",
  "clear-on-close",
]);

export interface CreateAppControlServiceOptions {
  registry?: VatioAppRegistry;
  storage?: StorageLike | null;
  now?: () => Date;
}

function isoNow(now: () => Date) {
  return now().toISOString();
}

function uniqueDeclaredPermissions(
  permissions: unknown,
  manifest: VatioAppManifest | null,
): VatioAppPermission[] {
  if (!Array.isArray(permissions) || !manifest) return [];
  const declared = new Set(manifest.permissions);
  return Array.from(new Set(
    permissions.filter((permission): permission is VatioAppPermission =>
      typeof permission === "string" && declared.has(permission as VatioAppPermission)
    ),
  ));
}

function shouldAutoGrantDeclaredPermissions(manifest: VatioAppManifest | null) {
  if (!manifest) return false;
  return manifest.status === "stable"
    || manifest.status === "internal"
    || manifest.status === "beta"
    || manifest.status === "experimental";
}

function createDefaultState(appId: VatioAppId, updatedAt: string): VatioAppControlState {
  return {
    appId,
    enabled: true,
    pinned: false,
    hiddenFromStartMenu: false,
    favorite: false,
    lastOpenedAt: null,
    openCount: 0,
    grantedPermissions: [],
    deniedPermissions: [],
    storagePolicy: "default",
    updatedAt,
  };
}

function normalizeState(
  appId: VatioAppId,
  stored: unknown,
  manifest: VatioAppManifest | null,
  updatedAt: string,
): VatioAppControlState {
  const source = stored && typeof stored === "object"
    ? stored as Partial<VatioAppControlState>
    : {};
  const storagePolicy = VALID_STORAGE_POLICIES.has(source.storagePolicy as VatioAppStoragePolicy)
    ? source.storagePolicy as VatioAppStoragePolicy
    : "default";

  return {
    appId,
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    pinned: source.pinned === true,
    hiddenFromStartMenu: source.hiddenFromStartMenu === true,
    favorite: source.favorite === true,
    lastOpenedAt: typeof source.lastOpenedAt === "string" ? source.lastOpenedAt : null,
    openCount: Number.isFinite(source.openCount) && Number(source.openCount) > 0
      ? Math.floor(Number(source.openCount))
      : 0,
    grantedPermissions: uniqueDeclaredPermissions(source.grantedPermissions, manifest),
    deniedPermissions: uniqueDeclaredPermissions(source.deniedPermissions, manifest),
    storagePolicy,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : updatedAt,
  };
}

export function createAppControlService({
  registry = appRegistry,
  storage = null,
  now = () => new Date(),
}: CreateAppControlServiceOptions = {}): VatioAppControlService {
  const listeners = new Set<(state: VatioAppControlState) => void>();
  const getStorage = () => storage ?? (() => {
    try {
      return globalThis.localStorage || null;
    } catch {
      return null;
    }
  })();

  function getManifest(appId: VatioAppId) {
    return registry.getApp(appId);
  }

  function getState(appId: VatioAppId): VatioAppControlState {
    const record = readAppControlRecord(getStorage());
    return normalizeState(appId, record.apps[appId], getManifest(appId), isoNow(now));
  }

  function writeState(state: VatioAppControlState) {
    const record = readAppControlRecord(getStorage());
    record.apps[state.appId] = state;
    const saved = writeAppControlRecord(record, getStorage());
    if (saved) {
      for (const listener of listeners) listener(state);
      try {
        globalThis.dispatchEvent?.(new CustomEvent("vatio:app-control-change", { detail: state }));
      } catch {
        // ignore environments without CustomEvent
      }
    }
    return saved;
  }

  function mutateState(
    appId: VatioAppId,
    updater: (state: VatioAppControlState, manifest: VatioAppManifest | null) => VatioAppControlState | null,
  ) {
    const manifest = getManifest(appId);
    const current = getState(appId);
    const next = updater({ ...current }, manifest);
    if (!next) return false;
    next.updatedAt = isoNow(now);
    return writeState(next);
  }

  function isProtected(appId: VatioAppId) {
    const manifest = getManifest(appId);
    return PROTECTED_APP_IDS.has(appId) || manifest?.metadata.protected === true;
  }

  function getEffectivePermissions(appId: VatioAppId): VatioAppPermission[] {
    const manifest = getManifest(appId);
    if (!manifest) return [];

    const state = getState(appId);
    const denied = new Set(state.deniedPermissions || []);
    const granted = new Set(state.grantedPermissions || []);
    const autoGrant = shouldAutoGrantDeclaredPermissions(manifest);

    return manifest.permissions.filter((permission) => {
      if (denied.has(permission)) return false;
      return autoGrant || granted.has(permission);
    });
  }

  return {
    getState,
    listStates() {
      return registry.listApps().map((app) => getState(app.id));
    },
    isEnabled(appId) {
      return getState(appId).enabled;
    },
    setEnabled(appId, enabled) {
      if (!enabled && isProtected(appId)) return false;
      return mutateState(appId, (state) => ({
        ...state,
        enabled: Boolean(enabled),
      }));
    },
    isPinned(appId) {
      return getState(appId).pinned === true;
    },
    setPinned(appId, pinned) {
      return mutateState(appId, (state) => ({
        ...state,
        pinned: Boolean(pinned),
      }));
    },
    isFavorite(appId) {
      return getState(appId).favorite === true;
    },
    setFavorite(appId, favorite) {
      return mutateState(appId, (state) => ({
        ...state,
        favorite: Boolean(favorite),
      }));
    },
    grantPermission(appId, permission) {
      const manifest = getManifest(appId);
      if (!manifest?.permissions.includes(permission)) return false;

      return mutateState(appId, (state) => {
        const granted = new Set(state.grantedPermissions || []);
        const denied = new Set(state.deniedPermissions || []);
        granted.add(permission);
        denied.delete(permission);
        return {
          ...state,
          grantedPermissions: Array.from(granted),
          deniedPermissions: Array.from(denied),
        };
      });
    },
    revokePermission(appId, permission) {
      const manifest = getManifest(appId);
      if (!manifest?.permissions.includes(permission)) return false;

      return mutateState(appId, (state) => {
        const granted = new Set(state.grantedPermissions || []);
        const denied = new Set(state.deniedPermissions || []);
        granted.delete(permission);
        denied.add(permission);
        return {
          ...state,
          grantedPermissions: Array.from(granted),
          deniedPermissions: Array.from(denied),
        };
      });
    },
    hasGrantedPermission(appId, permission) {
      return getEffectivePermissions(appId).includes(permission);
    },
    getEffectivePermissions,
    recordLaunch(appId) {
      void mutateState(appId, (state) => ({
        ...state,
        lastOpenedAt: isoNow(now),
        openCount: Math.max(0, Number(state.openCount || 0)) + 1,
      }));
    },
    resetAppControlState(appId) {
      const removed = removeAppControlState(appId, getStorage());
      if (removed) {
        const state = createDefaultState(appId, isoNow(now));
        for (const listener of listeners) listener(state);
      }
      return removed;
    },
    isProtected,
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const appControl = createAppControlService();

export function getEffectiveAppPermissions(
  manifest: VatioAppManifest,
  control: VatioAppControlService = appControl,
): VatioAppPermission[] {
  return control.getEffectivePermissions(manifest.id);
}
