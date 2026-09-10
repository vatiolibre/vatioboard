const RADIO_BROWSER_DIRECTORY = "https://all.api.radio-browser.info";
const RADIO_BROWSER_FALLBACK = "https://de1.api.radio-browser.info";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METADATA_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "VatioBoard-Radio-Relay/1.0 (+https://vatioboard.com)";
const DEFAULT_ORIGINS = ["https://vatioboard.com", "https://www.vatioboard.com"];

const FALLBACK_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="Radio"><rect width="256" height="256" rx="42" fill="#131722"/><path d="M54 102h148v104H54zM82 102l91-57M83 143h72M83 169h58" fill="none" stroke="#73d4ff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><circle cx="178" cy="151" r="15" fill="#73d4ff"/></svg>`;

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ALLOWED_ORIGINS?: string;
  SELF_HOSTNAME?: string;
  STREAM_STARTS?: RateLimitBinding;
  LOGO_REQUESTS?: RateLimitBinding;
}

interface StationMetadata {
  stationuuid: string;
  url: string;
  favicon: string;
}

interface CachedMetadata {
  value: StationMetadata | null;
  expiresAt: number;
}

const metadataCache = new Map<string, CachedMetadata>();
let mirrorCache: { origins: string[]; expiresAt: number } | null = null;

function logEvent(event: string, detail: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ event, ...detail }));
}

function allowedOrigins(env: Env): Set<string> {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configured.length > 0 ? configured : DEFAULT_ORIGINS);
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({ Vary: "Origin" });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function response(status: number, message: string, origin: string | null = null, extra: HeadersInit = {}): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(message, { status, headers });
}

function getClientKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

async function applyRateLimit(binding: RateLimitBinding | undefined, request: Request, kind: string): Promise<Response | null> {
  if (!binding) return null;
  const result = await binding.limit({ key: getClientKey(request) });
  if (result.success) return null;
  logEvent("rate_limited", { kind });
  return response(429, "Too many requests", request.headers.get("Origin"), { "Retry-After": "60" });
}

function isAllowedMirror(value: unknown): value is string {
  try {
    const url = new URL(String(value || "").startsWith("http") ? String(value) : `https://${String(value || "")}`);
    return url.protocol === "https:"
      && !url.port
      && !url.username
      && !url.password
      && (url.hostname === "all.api.radio-browser.info" || url.hostname.endsWith(".api.radio-browser.info"));
  } catch {
    return false;
  }
}

/** Clears module caches so isolated Worker tests do not influence one another. */
export function resetRadioMediaWorkerForTesting(): void {
  metadataCache.clear();
  mirrorCache = null;
}

async function getMirrors(): Promise<string[]> {
  if (mirrorCache && mirrorCache.expiresAt > Date.now()) return mirrorCache.origins;
  let origins: string[];
  try {
    const result = await fetch(`${RADIO_BROWSER_DIRECTORY}/json/servers`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    if (!result.ok) throw new Error(`Radio Browser directory returned HTTP ${result.status}`);
    const raw = await result.json() as Array<{ name?: string }>;
    origins = raw.map((entry) => `https://${String(entry?.name || "")}`).filter(isAllowedMirror);
  } catch (error) {
    logEvent("radio_browser_directory_failure", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    origins = [];
  }
  origins = [...new Set([...origins, RADIO_BROWSER_DIRECTORY, RADIO_BROWSER_FALLBACK])];
  mirrorCache = { origins, expiresAt: Date.now() + 60 * 60 * 1000 };
  return origins;
}

function stationUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function resolveStation(uuid: string): Promise<StationMetadata | null> {
  const cached = metadataCache.get(uuid);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  for (const mirror of await getMirrors()) {
    try {
      const result = await fetch(`${mirror}/json/stations/byuuid/${encodeURIComponent(uuid)}`, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      if (!result.ok) continue;
      const raw = await result.json() as Array<Record<string, unknown>>;
      const matches = Array.isArray(raw) ? raw.filter((station) =>
        String(station.stationuuid || "").toLowerCase() === uuid.toLowerCase()
        && Number(station.lastcheckok) === 1
        && Number(station.hls) === 0,
      ) : [];
      if (matches.length !== 1) continue;
      const value = {
        stationuuid: uuid,
        url: stationUrl(matches[0].url_resolved),
        favicon: stationUrl(matches[0].favicon),
      };
      if (!validateTarget(value.url, "")) {
        logEvent("invalid_target");
        continue;
      }
      metadataCache.set(uuid, { value, expiresAt: Date.now() + METADATA_TTL_MS });
      return value;
    } catch (error) {
      logEvent("radio_browser_lookup_failure", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      // Fail over to the next directory mirror.
    }
  }
  metadataCache.set(uuid, { value: null, expiresAt: Date.now() + NEGATIVE_TTL_MS });
  return null;
}

function isIpLiteral(hostname: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  return hostname.includes(":") || /^\[.*\]$/.test(hostname);
}

function validateTarget(value: string, selfHostname: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || !host) return null;
    if (isIpLiteral(host)
      || host === "localhost"
      || host.endsWith(".localhost")
      || host.endsWith(".local")
      || host.endsWith(".internal")
      || (selfHostname && host === selfHostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

async function fetchValidatedUpstream(
  initialUrl: string,
  selfHostname: string,
  init: RequestInit,
): Promise<Response | null> {
  let target = validateTarget(initialUrl, selfHostname);
  if (!target) {
    logEvent("invalid_target");
    return null;
  }
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      // Clear as soon as response headers arrive so a continuous body is not
      // aborted after the connection timeout has served its purpose.
      clearTimeout(timeout);
    }
    if (![301, 302, 303, 307, 308].includes(upstream.status)) return upstream;
    if (redirects === 3) return null;
    const location = upstream.headers.get("Location");
    target = location ? validateTarget(new URL(location, target).toString(), selfHostname) : null;
    if (!target) {
      logEvent("invalid_target", { redirect: true });
      return null;
    }
  }
  return null;
}

function isSupportedAudio(contentType: string): boolean {
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();
  return [
    "audio/mpeg",
    "audio/mp3",
    "audio/aac",
    "audio/aacp",
    "audio/x-aac",
    "audio/ogg",
    "application/ogg",
    "application/octet-stream",
  ].includes(mime);
}

function isSupportedArtwork(contentType: string): boolean {
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();
  return [
    "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif",
    "image/x-icon", "image/vnd.microsoft.icon",
  ].includes(mime);
}

function copyHeaders(source: Headers, names: string[]): Headers {
  const result = new Headers();
  for (const name of names) {
    const value = source.get(name);
    if (value) result.set(name, value);
  }
  return result;
}

async function handleStream(request: Request, env: Env, uuid: string, origin: string): Promise<Response> {
  const limited = await applyRateLimit(env.STREAM_STARTS, request, "stream");
  if (limited) return limited;
  const station = await resolveStation(uuid);
  if (!station) return response(404, "Station unavailable", origin);
  const requestHeaders = copyHeaders(request.headers, ["Range", "Accept"]);
  requestHeaders.set("User-Agent", USER_AGENT);
  let upstream: Response | null;
  try {
    upstream = await fetchValidatedUpstream(station.url, env.SELF_HOSTNAME || "radio-media.vatioboard.com", {
      method: request.method,
      headers: requestHeaders,
    });
  } catch {
    logEvent("relay_failure");
    return response(504, "Upstream timeout", origin);
  }
  if (!upstream || ![200, 206].includes(upstream.status) || !isSupportedAudio(upstream.headers.get("Content-Type") || "")) {
    logEvent("relay_failure", { status: upstream?.status || 0 });
    return response(502, "Unsupported upstream response", origin);
  }
  const headers = copyHeaders(upstream.headers, [
    "Content-Type", "Content-Length", "Content-Range", "Accept-Ranges",
    "icy-br", "icy-description", "icy-genre", "icy-name", "icy-url",
  ]);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Cache-Control", "no-store");
  if (station.url.startsWith("https:")) logEvent("direct_fallback");
  logEvent("relay_start");
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}

function fallbackLogo(origin: string | null): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "image/svg+xml; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("CDN-Cache-Control", "public, max-age=3600");
  logEvent("logo_fallback");
  return new Response(FALLBACK_LOGO, { status: 200, headers });
}

async function cachedFallbackLogo(
  cache: Cache | null,
  cacheKey: Request,
  method: string,
  origin: string | null,
): Promise<Response> {
  const fallback = fallbackLogo(origin);
  if (cache) await cache.put(cacheKey, fallback.clone());
  return method === "HEAD" ? new Response(null, fallback) : fallback;
}

async function collectLimitedBody(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LOGO_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function getDefaultCache(): Cache | null {
  return (globalThis as typeof globalThis & { caches?: CacheStorage & { default?: Cache } }).caches?.default || null;
}

async function handleLogo(request: Request, env: Env, uuid: string, origin: string | null): Promise<Response> {
  const cache = getDefaultCache();
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.set("__origin", origin || "none");
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      logEvent("logo_hit");
      return request.method === "HEAD" ? new Response(null, hit) : hit;
    }
  }
  logEvent("logo_miss");
  const limited = await applyRateLimit(env.LOGO_REQUESTS, request, "logo");
  if (limited) return limited;
  const station = await resolveStation(uuid);
  if (!station?.favicon) return cachedFallbackLogo(cache, cacheKey, request.method, origin);
  let upstream: Response | null;
  try {
    upstream = await fetchValidatedUpstream(station.favicon, env.SELF_HOSTNAME || "radio-media.vatioboard.com", {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon", "User-Agent": USER_AGENT },
    });
  } catch {
    return cachedFallbackLogo(cache, cacheKey, request.method, origin);
  }
  if (!upstream?.ok || !isSupportedArtwork(upstream.headers.get("Content-Type") || "")) {
    return cachedFallbackLogo(cache, cacheKey, request.method, origin);
  }
  const declaredLength = Number(upstream.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_LOGO_BYTES) return cachedFallbackLogo(cache, cacheKey, request.method, origin);
  const bytes = await collectLimitedBody(upstream.body);
  if (!bytes) return cachedFallbackLogo(cache, cacheKey, request.method, origin);
  const headers = corsHeaders(origin);
  headers.set("Content-Type", upstream.headers.get("Content-Type")!.split(";", 1)[0]);
  headers.set("Content-Length", String(bytes.byteLength));
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("CDN-Cache-Control", "public, max-age=604800");
  const body = bytes.buffer as ArrayBuffer;
  const result = new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  if (cache) await cache.put(cacheKey, new Response(body, { status: 200, headers }));
  return result;
}

function preflight(origin: string, route: "stream" | "logo"): Response {
  const headers = corsHeaders(origin);
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", route === "stream" ? "Accept, Range" : "Accept");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.search) return response(400, "Query parameters are not allowed");
    const match = /^\/v1\/stations\/([^/]+)\/(stream|logo)$/.exec(url.pathname);
    if (!match) return response(404, "Not found");
    const uuid = match[1];
    const route = match[2] as "stream" | "logo";
    if (!UUID_PATTERN.test(uuid)) {
      logEvent("invalid_uuid");
      return response(400, "Invalid station UUID");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return response(405, "Method not allowed", null, { Allow: "GET, HEAD, OPTIONS" });
    }
    const origin = request.headers.get("Origin");
    const origins = allowedOrigins(env);
    if (route === "stream" && (!origin || !origins.has(origin))) return response(403, "Origin not allowed");
    if (route === "logo" && origin && !origins.has(origin)) return response(403, "Origin not allowed");
    if (request.method === "OPTIONS") {
      if (!origin) return response(403, "Origin required");
      const requestedHeaders = String(request.headers.get("Access-Control-Request-Headers") || "")
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      const allowedHeaders = route === "stream" ? new Set(["accept", "range"]) : new Set(["accept"]);
      if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
        return response(403, "Requested header not allowed", origin);
      }
      return preflight(origin, route);
    }
    return route === "stream"
      ? handleStream(request, env, uuid, origin!)
      : handleLogo(request, env, uuid, origin);
  },
};
