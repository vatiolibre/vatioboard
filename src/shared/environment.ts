/**
 * Shared environment configuration.
 *
 * Single source of truth for detecting the runtime environment and resolving
 * the BFF (Backend For Frontend) base URL hosted on the api. subdomain.
 *
 * Production:  vatioboard.com / www.vatioboard.com  →  api.vatioboard.com
 * Development: dev.vatioboard.com / *                →  api.dev.vatioboard.com
 * Localhost:   localhost / 127.0.0.1 / ::1           →  backend disabled by default
 */

const PROD_HOSTS = new Set(["vatioboard.com", "www.vatioboard.com"]);

const PROD_API_BASE = "https://api.vatioboard.com";
const DEV_API_BASE = "https://api.dev.vatioboard.com";
const PROD_RADIO_MEDIA_BASE = "https://radio-media.vatioboard.com";
const DEV_RADIO_MEDIA_BASE = "https://radio-media.dev.vatioboard.com";

export interface EnvironmentConfig {
  frontendOrigin: string;
  apiBase: string;
  radioMediaBase: string;
  radioMediaEnvironment: "development" | "production" | "local" | "unconfigured";
  isProduction: boolean;
  isLocalhost: boolean;
  backendEnabled: boolean;
  backendAuthDebugControlsEnabled: boolean;
}

export type EnvironmentLocation = Pick<Location, "hostname" | "origin"> | null | undefined;
export type EnvironmentRuntimeEnv = Record<string, string | boolean | undefined> | null | undefined;

const LOCALHOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const ENV_ENABLED_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);
const ENV_DISABLED_VALUES = new Set(["0", "false", "off", "no", "disabled", "local"]);

function isLocalhost(host: string) {
  return LOCALHOSTS.has(host) || host.endsWith(".localhost");
}

function getBooleanEnvOverride(env: EnvironmentRuntimeEnv, key: string) {
  const rawValue = String(env?.[key] ?? "").trim().toLowerCase();
  if (ENV_ENABLED_VALUES.has(rawValue)) return true;
  if (ENV_DISABLED_VALUES.has(rawValue)) return false;
  return null;
}

function getBackendEnabledOverride(env: EnvironmentRuntimeEnv) {
  return getBooleanEnvOverride(env, "VITE_VATIOBOARD_BACKEND");
}

/**
 * Resolve the BFF API base URL from the current hostname.
 *
 * @param location - Override for testing; defaults to window.location.
 */
export function getEnvironmentConfig(
  location: EnvironmentLocation = window.location,
  env: EnvironmentRuntimeEnv = import.meta.env,
): EnvironmentConfig {
  const host = String(location?.hostname || "").toLowerCase();
  const isProduction = PROD_HOSTS.has(host);
  const isLocal = isLocalhost(host);
  const backendEnabledOverride = getBackendEnabledOverride(env);
  const requestedRadioMediaBase = String(env?.VITE_VATIOBOARD_RADIO_MEDIA_BASE || "").trim();
  const configuredRadioMediaBase = !isProduction && !isLocal
    && requestedRadioMediaBase.replace(/\/+$/, "") === PROD_RADIO_MEDIA_BASE
    ? ""
    : requestedRadioMediaBase;
  const radioMediaBase = configuredRadioMediaBase
    || (isProduction
      ? PROD_RADIO_MEDIA_BASE
      : isLocal
        ? "http://localhost:8787"
        : DEV_RADIO_MEDIA_BASE);
  const radioMediaEnvironment = !radioMediaBase
    ? "unconfigured"
    : radioMediaBase === PROD_RADIO_MEDIA_BASE
      ? "production"
      : radioMediaBase === DEV_RADIO_MEDIA_BASE
        ? "development"
        : isLocal ? "local" : isProduction ? "production" : "development";

  return {
    frontendOrigin: String(location?.origin || ""),
    apiBase: isProduction ? PROD_API_BASE : DEV_API_BASE,
    radioMediaBase,
    radioMediaEnvironment,
    isProduction,
    isLocalhost: isLocal,
    backendEnabled: backendEnabledOverride ?? !isLocal,
    backendAuthDebugControlsEnabled:
      getBooleanEnvOverride(env, "VITE_VATIOBOARD_BACKEND_AUTH_DEBUG_CONTROLS") ?? false,
  };
}
