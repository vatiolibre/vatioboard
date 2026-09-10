import { getEnvironmentConfig } from "./environment.js";

const DIRECTORY_ORIGIN = "https://all.api.radio-browser.info";
const FALLBACK_MIRROR = "https://de1.api.radio-browser.info";
const MIRROR_CACHE_KEY = "vatioboard_radio_browser_mirrors_v1";
const MIRROR_CACHE_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const RESULT_LIMIT = 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  has_favicon: boolean;
  countrycode: string;
  language: string;
  tags: string[];
  codec: string;
  bitrate: number | null;
  hls: 0 | 1;
  lastcheckok: 0 | 1;
}

export interface RadioSearchFilters {
  name?: string;
  country?: string;
  tag?: string;
}

type RadioFetch = typeof fetch;
type AccessCheck = () => boolean;

let externalNetworkAccessCheck: AccessCheck = () => true;

export function setRadioExternalNetworkAccessCheck(check?: AccessCheck | null): void {
  externalNetworkAccessCheck = typeof check === "function" ? check : () => true;
}

export function hasRadioExternalNetworkAccess(): boolean {
  try {
    return externalNetworkAccessCheck() === true;
  } catch {
    return false;
  }
}

export function isRadioStationUuid(value: unknown): value is string {
  return UUID_PATTERN.test(String(value || ""));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function int(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function normalizeStation(raw: unknown): RadioBrowserStation | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const stationuuid = text(record.stationuuid);
  const urlResolved = text(record.url_resolved);
  if (!isRadioStationUuid(stationuuid) || !urlResolved) return null;

  try {
    const parsedUrl = new URL(urlResolved);
    if ((parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") || parsedUrl.username || parsedUrl.password) return null;
  } catch {
    return null;
  }

  return {
    stationuuid,
    name: text(record.name) || "Unnamed station",
    url_resolved: urlResolved,
    has_favicon: Boolean(text(record.favicon)),
    countrycode: text(record.countrycode).toUpperCase().slice(0, 2),
    language: text(record.language),
    tags: text(record.tags).split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
    codec: text(record.codec).toUpperCase(),
    bitrate: int(record.bitrate),
    hls: Number(record.hls) === 1 ? 1 : 0,
    lastcheckok: Number(record.lastcheckok) === 1 ? 1 : 0,
  };
}

function normalizeStations(raw: unknown): RadioBrowserStation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const stations: RadioBrowserStation[] = [];
  for (const item of raw) {
    const station = normalizeStation(item);
    if (!station || station.hls !== 0 || station.lastcheckok !== 1 || seen.has(station.stationuuid)) continue;
    seen.add(station.stationuuid);
    stations.push(station);
  }
  return stations;
}

function isAllowedMirror(value: unknown): value is string {
  try {
    const url = new URL(String(value || "").startsWith("http") ? String(value) : `https://${String(value || "")}`);
    return url.protocol === "https:"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && (url.hostname === "all.api.radio-browser.info" || url.hostname.endsWith(".api.radio-browser.info"));
  } catch {
    return false;
  }
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function readCachedMirrors(storage: Storage | null): string[] {
  try {
    const parsed = JSON.parse(storage?.getItem(MIRROR_CACHE_KEY) || "null");
    if (!parsed || Date.now() - Number(parsed.savedAt) > MIRROR_CACHE_TTL_MS) return [];
    return Array.isArray(parsed.mirrors) ? parsed.mirrors.filter(isAllowedMirror) : [];
  } catch {
    return [];
  }
}

function writeCachedMirrors(storage: Storage | null, mirrors: string[]): void {
  try {
    storage?.setItem(MIRROR_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), mirrors }));
  } catch {
    // sessionStorage is best effort.
  }
}

async function fetchJson(fetchFn: RadioFetch, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Radio Browser returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export interface RadioBrowserClient {
  getPopularStations(): Promise<RadioBrowserStation[]>;
  searchStations(filters?: RadioSearchFilters): Promise<RadioBrowserStation[]>;
  getStationByUuid(uuid: string): Promise<RadioBrowserStation | null>;
  registerStationClick(uuid: string): Promise<boolean>;
}

export function createRadioBrowserClient({
  fetchFn = fetch,
  storage = typeof sessionStorage === "undefined" ? null : sessionStorage,
}: {
  fetchFn?: RadioFetch;
  storage?: Storage | null;
} = {}): RadioBrowserClient {
  let mirrors = readCachedMirrors(storage);
  let currentMirror = mirrors[0] || DIRECTORY_ORIGIN;
  const reportedClicks = new Set<string>();

  async function discoverMirrors(): Promise<string[]> {
    if (mirrors.length > 0) return mirrors;
    try {
      const raw = await fetchJson(fetchFn, `${DIRECTORY_ORIGIN}/json/servers`);
      const discovered = Array.isArray(raw)
        ? raw.map((entry) => `https://${text((entry as Record<string, unknown>)?.name)}`).filter(isAllowedMirror)
        : [];
      mirrors = shuffle([...new Set(discovered)]);
      if (mirrors.length > 0) writeCachedMirrors(storage, mirrors);
    } catch {
      mirrors = [];
    }
    return mirrors;
  }

  async function request(path: string): Promise<unknown> {
    if (!hasRadioExternalNetworkAccess()) throw new Error("radio-network-permission-denied");
    await discoverMirrors();
    const candidates = [...new Set([currentMirror, ...mirrors, DIRECTORY_ORIGIN, FALLBACK_MIRROR])]
      .filter(isAllowedMirror);
    let lastError: unknown = null;
    for (const origin of candidates) {
      try {
        const result = await fetchJson(fetchFn, `${origin}${path}`);
        currentMirror = origin;
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Radio Browser is unavailable.");
  }

  async function getPopularStations(): Promise<RadioBrowserStation[]> {
    const params = new URLSearchParams({
      hidebroken: "true",
      limit: String(RESULT_LIMIT),
      order: "clickcount",
      reverse: "true",
    });
    const raw = await request(`/json/stations/search?${params.toString()}`);
    return normalizeStations(raw).slice(0, RESULT_LIMIT);
  }

  async function searchStations(filters: RadioSearchFilters = {}): Promise<RadioBrowserStation[]> {
    const params = new URLSearchParams({
      hidebroken: "true",
      limit: String(RESULT_LIMIT),
      order: "clickcount",
      reverse: "true",
    });
    const name = text(filters.name).slice(0, 120);
    const country = text(filters.country).slice(0, 80);
    const tag = text(filters.tag).slice(0, 80);
    if (name) params.set("name", name);
    if (country) {
      if (/^[a-z]{2}$/i.test(country)) params.set("countrycode", country.toUpperCase());
      else params.set("country", country);
    }
    if (tag) params.set("tag", tag);
    const raw = await request(`/json/stations/search?${params.toString()}`);
    return normalizeStations(raw).slice(0, RESULT_LIMIT);
  }

  async function getStationByUuid(uuid: string): Promise<RadioBrowserStation | null> {
    if (!isRadioStationUuid(uuid)) return null;
    const raw = await request(`/json/stations/byuuid/${encodeURIComponent(uuid)}`);
    return normalizeStations(raw)[0] || null;
  }

  async function registerStationClick(uuid: string): Promise<boolean> {
    if (!isRadioStationUuid(uuid) || reportedClicks.has(uuid)) return false;
    reportedClicks.add(uuid);
    try {
      await request(`/json/url/${encodeURIComponent(uuid)}`);
      return true;
    } catch {
      reportedClicks.delete(uuid);
      return false;
    }
  }

  return { getPopularStations, searchStations, getStationByUuid, registerStationClick };
}

export const radioBrowser = createRadioBrowserClient();

export function getValidRadioMediaBase(): string {
  const value = String(getEnvironmentConfig().radioMediaBase || "").trim();
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function getRadioStreamRelayUrl(stationUuid: string): string {
  const base = getValidRadioMediaBase();
  return base && isRadioStationUuid(stationUuid)
    ? `${base}/v1/stations/${encodeURIComponent(stationUuid)}/stream`
    : "";
}

export function getRadioLogoUrl(stationUuid: string): string {
  const base = getValidRadioMediaBase();
  return base && isRadioStationUuid(stationUuid)
    ? `${base}/v1/stations/${encodeURIComponent(stationUuid)}/logo`
    : "";
}

export function radioStationToTrack(station: RadioBrowserStation): Record<string, unknown> {
  return {
    name: `radio:${station.stationuuid}`,
    title: station.name,
    artist: [station.countrycode, station.language].filter(Boolean).join(" · "),
    album: "Internet Radio",
    genre: station.tags.slice(0, 3).join(", "),
    duration: null,
    artwork_ref: getRadioLogoUrl(station.stationuuid),
    media_kind: "radio",
    original_filename: "",
    content_hash: "",
    mime_type: "",
    blob_size: 0,
    file_extension: "",
    folder_path: "",
    src: "",
    station_uuid: station.stationuuid,
    countrycode: station.countrycode,
    language: station.language,
    codec: station.codec,
    bitrate: station.bitrate,
    hls: station.hls,
    url_resolved: station.url_resolved,
    _offline: false,
    _demo: false,
  };
}
