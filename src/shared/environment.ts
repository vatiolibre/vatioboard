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

export interface EnvironmentConfig {
  frontendOrigin: string;
  apiBase: string;
  isProduction: boolean;
  isLocalhost: boolean;
  backendEnabled: boolean;
}

export type EnvironmentLocation = Pick<Location, "hostname" | "origin"> | null | undefined;
export type EnvironmentRuntimeEnv = Record<string, string | boolean | undefined> | null | undefined;

const LOCALHOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const BACKEND_ENABLED_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);
const BACKEND_DISABLED_VALUES = new Set(["0", "false", "off", "no", "disabled", "local"]);

function isLocalhost(host: string) {
  return LOCALHOSTS.has(host) || host.endsWith(".localhost");
}

function getBackendEnabledOverride(env: EnvironmentRuntimeEnv) {
  const rawValue = String(env?.VITE_VATIOBOARD_BACKEND ?? "").trim().toLowerCase();
  if (BACKEND_ENABLED_VALUES.has(rawValue)) return true;
  if (BACKEND_DISABLED_VALUES.has(rawValue)) return false;
  return null;
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

  return {
    frontendOrigin: String(location?.origin || ""),
    apiBase: isProduction ? PROD_API_BASE : DEV_API_BASE,
    isProduction,
    isLocalhost: isLocal,
    backendEnabled: backendEnabledOverride ?? !isLocal,
  };
}
