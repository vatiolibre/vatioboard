const RADIO_BROWSER_DIRECTORY = "https://all.api.radio-browser.info";
const RADIO_BROWSER_FALLBACK = "https://de1.api.radio-browser.info";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METADATA_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const USER_AGENT = "VatioBoard-Radio-Relay/1.0 (+https://vatioboard.com)";
const WORKER_VERSION = "radio-media-v2";
const STREAM_SAMPLE_BYTES = 8 * 1024;
const DEFAULT_ORIGINS = ["https://vatioboard.com", "https://www.vatioboard.com"];

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  [key: string]: unknown;
  ALLOWED_ORIGINS?: string;
  SELF_HOSTNAME?: string;
  STREAM_STARTS?: RateLimitBinding;
  BUILD_VERSION?: string;
}

interface StationMetadata {
  stationuuid: string;
  url: string;
}

interface CachedMetadata {
  value: StationMetadata | null;
  expiresAt: number;
  failure?: RadioResolutionOutcome;
}

type RadioResolutionOutcome =
  | "ready"
  | "station-unavailable"
  | "directory-timeout"
  | "unrelayable-target"
  | "redirect-limit"
  | "upstream-timeout"
  | "upstream-status"
  | "unsupported-content"
  | "empty-response"
  | "early-close";

interface StationResolution {
  station: StationMetadata | null;
  outcome: RadioResolutionOutcome;
}

interface UpstreamFetchResult {
  response: Response | null;
  outcome: RadioResolutionOutcome;
  redirects: number;
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
  const headers = new Headers({
    Vary: "Origin",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Timing-Allow-Origin", origin);
  }
  return headers;
}

function response(status: number, message: string, origin: string | null = null, extra: HeadersInit = {}): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", "no-store");
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

function metadataCacheKey(uuid: string, selfHostname: string): Request {
  const hostname = selfHostname || "radio-media.vatioboard.com";
  return new Request(`https://${hostname}/__cache/stations/${encodeURIComponent(uuid)}`);
}

async function readSharedMetadataCache(uuid: string, selfHostname: string): Promise<CachedMetadata | null> {
  try {
    const hit = await getDefaultCache()?.match(metadataCacheKey(uuid, selfHostname));
    if (!hit) return null;
    const cached = await hit.json() as CachedMetadata;
    if (!Number.isFinite(cached.expiresAt) || cached.expiresAt <= Date.now()) return null;
    return cached;
  } catch {
    return null;
  }
}

async function writeSharedMetadataCache(uuid: string, selfHostname: string, cached: CachedMetadata): Promise<void> {
  try {
    await getDefaultCache()?.put(metadataCacheKey(uuid, selfHostname), Response.json(cached, {
      headers: { "Cache-Control": `public, max-age=${cached.value ? 600 : 60}` },
    }));
  } catch {
    // Shared cache is opportunistic; module-local caching remains available.
  }
}

async function fetchStationFromMirror(mirror: string, uuid: string): Promise<StationMetadata> {
  const result = await fetch(`${mirror}/json/stations/byuuid/${encodeURIComponent(uuid)}`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
  });
  if (!result.ok) throw new Error("station-unavailable");
  const raw = await result.json() as Array<Record<string, unknown>>;
  const matches = Array.isArray(raw) ? raw.filter((station) =>
    String(station.stationuuid || "").toLowerCase() === uuid.toLowerCase()
    && Number(station.lastcheckok) === 1
    && Number(station.hls) === 0,
  ) : [];
  if (matches.length !== 1) throw new Error("station-unavailable");
  const value = {
    stationuuid: uuid,
    url: stationUrl(matches[0].url_resolved),
  };
  if (!validateTarget(value.url, "")) throw new Error("unrelayable-target");
  return value;
}

async function resolveStationDetailed(uuid: string, selfHostname = "radio-media.vatioboard.com"): Promise<StationResolution> {
  let cached = metadataCache.get(uuid);
  if (cached && cached.expiresAt > Date.now()) {
    return { station: cached.value, outcome: cached.value ? "ready" : cached.failure || "station-unavailable" };
  }
  cached = await readSharedMetadataCache(uuid, selfHostname) || undefined;
  if (cached) {
    metadataCache.set(uuid, cached);
    return { station: cached.value, outcome: cached.value ? "ready" : cached.failure || "station-unavailable" };
  }

  const mirrors = (await getMirrors()).slice(0, 2);
  try {
    const station = await Promise.any(mirrors.map((mirror) => fetchStationFromMirror(mirror, uuid)));
    const entry = { value: station, expiresAt: Date.now() + METADATA_TTL_MS };
    metadataCache.set(uuid, entry);
    await writeSharedMetadataCache(uuid, selfHostname, entry);
    return { station, outcome: "ready" };
  } catch (error) {
    const reasons = error instanceof AggregateError
      ? error.errors.map((item) => item instanceof Error ? item.message : "unknown")
      : [error instanceof Error ? error.message : "unknown"];
    const outcome: RadioResolutionOutcome = reasons.includes("unrelayable-target")
      ? "unrelayable-target"
      : reasons.some((reason) => /abort|timeout/i.test(reason))
        ? "directory-timeout"
        : "station-unavailable";
    logEvent("radio_browser_lookup_failure", { outcome });
    const entry = { value: null, failure: outcome, expiresAt: Date.now() + NEGATIVE_TTL_MS };
    metadataCache.set(uuid, entry);
    await writeSharedMetadataCache(uuid, selfHostname, entry);
    return { station: null, outcome };
  }
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

async function fetchValidatedUpstreamResult(
  initialUrl: string,
  selfHostname: string,
  init: RequestInit,
): Promise<UpstreamFetchResult> {
  let target = validateTarget(initialUrl, selfHostname);
  if (!target) {
    logEvent("invalid_target");
    return { response: null, outcome: "unrelayable-target", redirects: 0 };
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
    if (![301, 302, 303, 307, 308].includes(upstream.status)) {
      return { response: upstream, outcome: "ready", redirects };
    }
    if (redirects === 3) return { response: null, outcome: "redirect-limit", redirects };
    const location = upstream.headers.get("Location");
    target = location ? validateTarget(new URL(location, target).toString(), selfHostname) : null;
    if (!target) {
      logEvent("invalid_target", { redirect: true });
      return { response: null, outcome: "unrelayable-target", redirects: redirects + 1 };
    }
  }
  return { response: null, outcome: "redirect-limit", redirects: 3 };
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
    "audio/flac",
    "audio/x-flac",
    "audio/mp4",
    "audio/webm",
  ].includes(mime);
}

function isGenericAudio(contentType: string): boolean {
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();
  return !mime || mime === "application/octet-stream";
}

function sniffAudioMime(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return "audio/ogg";
  if (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return "audio/flac";
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "audio/aac";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "audio/mpeg";
  return "";
}

async function readStreamSample(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("stream-body-timeout")), 5_000);
  });
  try {
    while (size < STREAM_SAMPLE_BYTES) {
      const { done, value } = await Promise.race([reader.read(), timedOut]);
      if (done) break;
      const remaining = STREAM_SAMPLE_BYTES - size;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      size += chunk.byteLength;
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    try { await reader.cancel(); } catch { /* best effort */ }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
  const selfHostname = env.SELF_HOSTNAME || "radio-media.vatioboard.com";
  const resolution = await resolveStationDetailed(uuid, selfHostname);
  const station = resolution.station;
  if (!station) {
    logEvent("relay_failure", { stage: "directory", outcome: resolution.outcome });
    return response(resolution.outcome === "directory-timeout" ? 504 : 404, "Station unavailable", origin);
  }
  const requestHeaders = copyHeaders(request.headers, ["Range", "Accept"]);
  requestHeaders.set("User-Agent", USER_AGENT);
  let upstreamResult: UpstreamFetchResult;
  try {
    upstreamResult = await fetchValidatedUpstreamResult(station.url, selfHostname, {
      method: request.method,
      headers: requestHeaders,
    });
  } catch (error) {
    logEvent("relay_failure", {
      stage: "upstream",
      outcome: error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`)
        ? "upstream-timeout"
        : "upstream-status",
    });
    return response(504, "Upstream timeout", origin);
  }
  const upstream = upstreamResult.response;
  if (!upstream) {
    logEvent("relay_failure", { stage: "target", outcome: upstreamResult.outcome, redirects: upstreamResult.redirects });
    return response(502, "Unsupported upstream response", origin);
  }
  if (![200, 206].includes(upstream.status)) {
    logEvent("relay_failure", { stage: "upstream", outcome: "upstream-status", status: upstream.status });
    return response(502, "Unsupported upstream response", origin);
  }
  const declaredType = upstream.headers.get("Content-Type") || "";
  let contentType = declaredType.split(";", 1)[0].trim().toLowerCase();
  let body = request.method === "HEAD" ? null : upstream.body;
  if (!isSupportedAudio(declaredType)) {
    if (!isGenericAudio(declaredType) || request.method === "HEAD" || !body) {
      logEvent("relay_failure", { stage: "content", outcome: "unsupported-content", status: upstream.status });
      return response(502, "Unsupported upstream response", origin);
    }
    const [sampleBody, passthroughBody] = body.tee();
    let sample: Uint8Array;
    try {
      sample = await readStreamSample(sampleBody);
    } catch {
      try { await passthroughBody.cancel(); } catch { /* best effort */ }
      return response(504, "Upstream body timeout", origin);
    }
    const detectedType = sniffAudioMime(sample);
    if (!detectedType) {
      try { await passthroughBody.cancel(); } catch { /* best effort */ }
      logEvent("relay_failure", { stage: "content", outcome: "unsupported-content", status: upstream.status });
      return response(502, "Unsupported upstream response", origin);
    }
    contentType = detectedType;
    body = passthroughBody;
  }
  const headers = copyHeaders(upstream.headers, [
    "Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Content-Encoding",
    "icy-br", "icy-description", "icy-genre", "icy-name", "icy-url",
  ]);
  corsHeaders(origin).forEach((value, key) => headers.set(key, value));
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-store");
  headers.set("X-VatioBoard-Radio-Version", String(env.BUILD_VERSION || WORKER_VERSION).slice(0, 80));
  const responseInit = {
    status: upstream.status,
    headers,
    // The upstream body is passed through unchanged. Cloudflare must preserve
    // any copied Content-Encoding instead of applying automatic encoding.
    encodeBody: "manual",
  } as ResponseInit;
  return new Response(body, responseInit);
}

function getDefaultCache(): Cache | null {
  return (globalThis as typeof globalThis & { caches?: CacheStorage & { default?: Cache } }).caches?.default || null;
}

function preflight(origin: string): Response {
  const headers = corsHeaders(origin);
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Accept, Range");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.search) return response(400, "Query parameters are not allowed");
    const match = /^\/v1\/stations\/([^/]+)\/stream$/.exec(url.pathname);
    if (!match) return response(404, "Not found");
    const origin = request.headers.get("Origin");
    const origins = allowedOrigins(env);
    if (!origin || !origins.has(origin)) {
      return response(403, "Origin not allowed");
    }
    const uuid = match[1];
    if (!UUID_PATTERN.test(uuid)) {
      logEvent("invalid_uuid");
      return response(400, "Invalid station UUID");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return response(405, "Method not allowed", null, { Allow: "GET, HEAD, OPTIONS" });
    }
    if (request.method === "OPTIONS") {
      const requestedHeaders = String(request.headers.get("Access-Control-Request-Headers") || "")
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      const allowedHeaders = new Set(["accept", "range"]);
      if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
        return response(403, "Requested header not allowed", origin);
      }
      return preflight(origin);
    }
    return handleStream(request, env, uuid, origin);
  },
};
