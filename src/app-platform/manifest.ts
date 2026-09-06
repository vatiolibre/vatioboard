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
  "media.camera",
  "audio.playback",
  "audio.background",
  "cloud.sync",
  "auth.session",
  "alerts.speed",
  "driveRecording.read",
  "driveRecording.write",
  "drivingTelemetry.read",
  "drivingTelemetry.write",
  "shell.window",
  "shell.launchApp",
  "network.backend",
  "i18n.read",
  "settings.read",
  "settings.write",
  "tts.speak",
]);

const VALID_SERVICES = new Set<VatioAppServiceId>([
  "gps",
  "audio",
  "driveRecording",
  "drivingTelemetry",
  "drivingAlerts",
  "qrScanner",
  "auth",
  "cloudSync",
  "shell",
  "storage",
  "i18n",
  "settings",
  "tts",
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

function validateTheme(value: unknown, errors: string[]) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("theme must be an object.");
    return;
  }

  const theme = value as Record<string, unknown>;
  if (!hasText(theme.color)) errors.push("theme.color is required when theme is provided.");
  for (const key of ["color2", "foreground"] as const) {
    if (theme[key] !== undefined && !hasText(theme[key])) {
      errors.push(`theme.${key} must be a non-empty string.`);
    }
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
  validateTheme(manifest.theme, errors);

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
  if (manifest.permissions.includes("drivingTelemetry.write") && !manifest.permissions.includes("drivingTelemetry.read")) {
    warnings.push("drivingTelemetry.write is declared without drivingTelemetry.read.");
  }

  const permissions = new Set(manifest.permissions || []);
  const services = new Set(manifest.services || []);
  const surfaces = new Set(manifest.surfaces || []);

  if (services.has("auth")) {
    if (!permissions.has("auth.session")) warnings.push('service "auth" requires permission "auth.session".');
    if (!permissions.has("network.backend")) warnings.push('service "auth" requires permission "network.backend".');
  }

  if (services.has("cloudSync")) {
    if (!permissions.has("cloud.sync")) warnings.push('service "cloudSync" requires permission "cloud.sync".');
    if (!permissions.has("network.backend")) warnings.push('service "cloudSync" requires permission "network.backend".');
  }

  if (
    services.has("shell")
    && !permissions.has("shell.launchApp")
    && !permissions.has("shell.window")
  ) {
    warnings.push('service "shell" requires permission "shell.launchApp" or "shell.window".');
  }

  if (surfaces.has("shell-window")) {
    if (!permissions.has("shell.window")) warnings.push('surface "shell-window" requires permission "shell.window".');
    if (!services.has("shell")) warnings.push('surface "shell-window" requires service "shell".');
  }

  if (
    (permissions.has("shell.launchApp") || permissions.has("shell.window"))
    && !services.has("shell")
  ) {
    warnings.push('shell permissions are declared without service "shell".');
  }

  if (services.has("storage") && !permissions.has("storage.app")) {
    warnings.push('service "storage" requires permission "storage.app".');
  }

  if (services.has("i18n") && !permissions.has("i18n.read")) {
    warnings.push('service "i18n" requires permission "i18n.read".');
  }

  if (services.has("tts") && !permissions.has("tts.speak")) {
    warnings.push('service "tts" requires permission "tts.speak".');
  }

  if (services.has("qrScanner") && !permissions.has("media.camera")) {
    warnings.push('service "qrScanner" requires permission "media.camera".');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
