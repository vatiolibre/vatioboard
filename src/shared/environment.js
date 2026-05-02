/**
 * Shared environment configuration.
 *
 * Single source of truth for detecting the runtime environment and resolving
 * the BFF (Backend For Frontend) base URL hosted on the api. subdomain.
 *
 * Production:  vatioboard.com / www.vatioboard.com  →  api.vatioboard.com
 * Development: dev.vatioboard.com / localhost / *    →  api.dev.vatioboard.com
 */

const PROD_HOSTS = new Set(["vatioboard.com", "www.vatioboard.com"]);

const PROD_API_BASE = "https://api.vatioboard.com";
const DEV_API_BASE = "https://api.dev.vatioboard.com";

/**
 * Resolve the BFF API base URL from the current hostname.
 *
 * @param {Location} [location] - Override for testing; defaults to window.location.
 * @returns {{ frontendOrigin: string, apiBase: string, isProduction: boolean }}
 */
export function getEnvironmentConfig(location = window.location) {
  const host = String(location?.hostname || "").toLowerCase();
  const isProduction = PROD_HOSTS.has(host);

  return {
    frontendOrigin: String(location?.origin || ""),
    apiBase: isProduction ? PROD_API_BASE : DEV_API_BASE,
    isProduction,
  };
}
