import type {
  VatioAppManifest,
  VatioAppManifestValidationResult,
  VatioAppPermission,
  VatioAppServiceId,
  VatioAppStatus,
  VatioAppSurface,
} from "./types";

const VALID_KINDS = new Set([
  "core-app",
  "tool-app",
  "media-app",
  "visualizer-app",
  "background-service",
  "system-app",
]);

const VALID_SURFACES = new Set<VatioAppSurface>([
  "main-route",
  "shell-window",
  "start-menu",
  "taskbar",
  "launcher",
  "background",
  "app-manager",
]);

const VALID_PERMISSIONS = new Set<VatioAppPermission>([
  "gps.read",
  "gps.highAccuracy",
  "storage.app",
  "storage.media",
  "audio.playback",
  "audio.background",
  "cloud.sync",
  "auth.session",
  "alerts.speed",
  "driveRecording.read",
  "driveRecording.write",
  "shell.window",
  "shell.launchApp",
  "network.backend",
  "i18n.read",
  "settings.read",
  "settings.write",
]);

const VALID_SERVICES = new Set<VatioAppServiceId>([
  "gps",
  "audio",
  "driveRecording",
  "drivingAlerts",
  "auth",
  "cloudSync",
  "shell",
  "storage",
  "i18n",
  "settings",
]);

const VALID_STATUSES = new Set<VatioAppStatus>([
  "stable",
  "beta",
  "experimental",
  "internal",
]);

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoolean(value: unknown) {
  return typeof value === "boolean";
}

function validateStringArray(name: string, value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`${name} must be an array.`);
    return;
  }

  for (const item of value) {
    if (!hasText(item)) errors.push(`${name} entries must be non-empty strings.`);
  }
}

export function defineAppManifest<const T extends VatioAppManifest>(manifest: T): T {
  return manifest;
}

export function validateAppManifest(manifest: VatioAppManifest): VatioAppManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return {
      ok: false,
      errors: ["Manifest must be an object."],
      warnings,
    };
  }

  for (const key of ["id", "title", "shortTitle", "description", "version", "icon", "i18nKey"] as const) {
    if (!hasText(manifest[key])) errors.push(`${key} is required.`);
  }

  if (!VALID_KINDS.has(manifest.kind)) errors.push(`kind "${manifest.kind}" is not supported.`);
  if (!VALID_STATUSES.has(manifest.status)) errors.push(`status "${manifest.status}" is not supported.`);
  if (!Number.isFinite(manifest.order)) errors.push("order must be a number.");

  if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length === 0) {
    errors.push("surfaces must include at least one surface.");
  } else {
    for (const surface of manifest.surfaces) {
      if (!VALID_SURFACES.has(surface)) errors.push(`surface "${surface}" is not supported.`);
    }
  }

  validateStringArray("permissions", manifest.permissions, errors);
  for (const permission of manifest.permissions || []) {
    if (!VALID_PERMISSIONS.has(permission)) errors.push(`permission "${permission}" is not supported.`);
  }

  validateStringArray("services", manifest.services, errors);
  for (const service of manifest.services || []) {
    if (!VALID_SERVICES.has(service)) errors.push(`service "${service}" is not supported.`);
  }

  if (manifest.route !== undefined && !hasText(manifest.route)) {
    errors.push("route must be a non-empty string when provided.");
  }

  if (manifest.aliases !== undefined) validateStringArray("aliases", manifest.aliases, errors);
  if (manifest.tags !== undefined) validateStringArray("tags", manifest.tags, errors);

  if (manifest.surfaces?.includes("main-route") && !manifest.route) {
    errors.push("main-route apps must declare route.");
  }

  if (manifest.surfaces?.includes("shell-window")) {
    if (!manifest.window) {
      errors.push("shell-window apps must declare window.");
    } else {
      if (!hasText(manifest.window.shellWindowId)) errors.push("window.shellWindowId is required.");
      if (!["floating", "fullscreen", "panel"].includes(manifest.window.mode)) {
        errors.push(`window.mode "${manifest.window.mode}" is not supported.`);
      }
      if (!manifest.window.defaultBounds || typeof manifest.window.defaultBounds !== "object") {
        errors.push("window.defaultBounds is required.");
      }
      if (!manifest.window.capabilities || typeof manifest.window.capabilities !== "object") {
        errors.push("window.capabilities is required.");
      }
      if (!isBoolean(manifest.window.restoreOnBoot)) errors.push("window.restoreOnBoot must be a boolean.");
      if (!isBoolean(manifest.window.lazy)) errors.push("window.lazy must be a boolean.");
    }
  }

  for (const key of ["localFirst", "teslaOptimized", "offlineCapable"] as const) {
    if (!isBoolean(manifest[key])) errors.push(`${key} must be a boolean.`);
  }

  if (!manifest.metadata || typeof manifest.metadata !== "object") {
    errors.push("metadata is required.");
  }

  if (manifest.permissions.includes("gps.highAccuracy") && !manifest.permissions.includes("gps.read")) {
    warnings.push("gps.highAccuracy is declared without gps.read.");
  }

  if (manifest.permissions.includes("driveRecording.write") && !manifest.permissions.includes("driveRecording.read")) {
    warnings.push("driveRecording.write is declared without driveRecording.read.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
