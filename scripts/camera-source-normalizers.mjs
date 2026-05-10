import crypto from "node:crypto";
import { parseMaxspeed } from "./camera-maxspeed-enrichment.mjs";
import { extractDirectionTokens, normalizeCoordinateKey } from "./camera-source-merge.mjs";

const LIGHTWEIGHT_COUNTRY_BBOXES = [
  ["co", [-81.8, -4.5, -66.8, 13.8]],
  ["us", [-179.5, 18.5, -52.5, 72.5]],
  ["ca", [-141.5, 41.5, -52.0, 84.0]],
  ["mx", [-118.8, 14.0, -86.0, 33.5]],
  ["gb", [-8.7, 49.7, 2.2, 60.9]],
  ["fr", [-5.5, 41.0, 9.8, 51.5]],
  ["de", [5.5, 47.0, 15.5, 55.5]],
  ["es", [-9.8, 35.5, 4.5, 44.5]],
  ["it", [6.0, 35.0, 19.0, 47.5]],
];

const COUNTRY_CODE_BY_NAME = {
  colombia: "co",
  "united states": "us",
  "united states of america": "us",
  usa: "us",
  "united kingdom": "gb",
  "great britain": "gb",
};

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(6)) : null;
}

function isFiniteCoordinate(lon, lat) {
  return Number.isFinite(lon)
    && Number.isFinite(lat)
    && lon >= -180
    && lon <= 180
    && lat >= -90
    && lat <= 90;
}

export function normalizeCountryCode(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^country:/i, "")
    .replace(/^iso3166-1:/i, "")
    .toLowerCase();

  if (!normalized) return "";
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  if (/^[a-z]{2}-/.test(normalized)) return normalized.slice(0, 2);
  if (/^[a-z]{3}$/.test(normalized) && normalized === "usa") return "us";
  return COUNTRY_CODE_BY_NAME[normalized] || "";
}

function inferCountryFromCoordinate(lon, lat, fallback = "zz") {
  for (const [code, bbox] of LIGHTWEIGHT_COUNTRY_BBOXES) {
    if (lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]) return code;
  }
  return fallback || "zz";
}

function getTaggedCountryCode(tags = {}) {
  const candidates = [
    tags["ISO3166-1:alpha2"],
    tags["ISO3166-1"],
    tags["addr:country"],
    tags["is_in:country_code"],
    tags.country_code,
    tags.country,
    tags["is_in:country"],
  ];

  for (const candidate of candidates) {
    const code = normalizeCountryCode(candidate);
    if (code) return code;
  }

  return "";
}

function parseCameraMaxspeed(tags = {}) {
  const candidates = [
    tags.maxspeed,
    tags.speed,
    tags.limit,
    tags["maxspeed:forward"],
    tags["maxspeed:backward"],
  ];

  for (const candidate of candidates) {
    const parsed = parseMaxspeed(candidate);
    if (parsed.parsed) return parsed;
  }

  return { speedKph: null, raw: null, parsed: false, reason: "missing" };
}

function normalizeSpeedMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const source = String(meta.source ?? "").trim();
  const compactSource = String(meta.s ?? "").trim();
  const normalizedSource = source || (
    compactSource === "road"
      ? "nearest_road:maxspeed"
      : (compactSource === "camera" ? "camera:maxspeed" : "")
  );
  if (!normalizedSource) return null;

  const confidence = String(meta.confidence ?? meta.c ?? "low").trim() || "low";
  const wayId = meta.wayId ?? meta.sourceWayId ?? meta.w;
  const distanceM = Number(meta.distanceM ?? meta.d);
  const raw = meta.raw ?? meta.r;
  const normalized = { source: normalizedSource, confidence };
  if (wayId !== null && wayId !== undefined && wayId !== "") {
    normalized.wayId = Number.isFinite(Number(wayId)) ? Math.round(Number(wayId)) : wayId;
  }
  if (Number.isFinite(distanceM)) normalized.distanceM = Math.round(distanceM);
  if (raw !== null && raw !== undefined && raw !== "") normalized.raw = String(raw);
  return normalized;
}

export function normalizeEnrichmentEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const speedKph = Number(entry.speedKph);
  if (!Number.isFinite(speedKph) || speedKph <= 0) return null;
  const speedMeta = normalizeSpeedMeta(entry.speedMeta ?? entry.meta);
  if (!speedMeta || !speedMeta.source.startsWith("nearest_road:")) return null;
  return { speedKph: Math.round(speedKph), speedMeta };
}

function getEnrichmentForKey(maxspeedEnrichment, key) {
  if (!key || !maxspeedEnrichment) return null;
  if (maxspeedEnrichment instanceof Map) return maxspeedEnrichment.get(key) || null;
  return normalizeEnrichmentEntry(maxspeedEnrichment[key]);
}

function stableHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function cleanString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function cleanArray(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [values])
      .flat()
      .map(cleanString)
      .filter(Boolean),
  ));
}

function compactObject(value) {
  const output = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry === null || entry === undefined || entry === "") continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    if (typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length === 0) continue;
    output[key] = entry;
  }
  return output;
}

function featurePoint(feature) {
  if (feature?.geometry?.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) return null;
  const [rawLon, rawLat] = feature.geometry.coordinates;
  const lon = roundCoordinate(rawLon);
  const lat = roundCoordinate(rawLat);
  return isFiniteCoordinate(lon, lat) ? { lon, lat } : null;
}

function createRecord({
  source,
  sourceId,
  lon,
  lat,
  speedKph = null,
  speedMeta = null,
  country = "zz",
  region = null,
  sourceMeta = {},
  raw = null,
}) {
  const sources = cleanArray(sourceMeta.sources || source);
  const ids = { ...(sourceMeta.ids || {}) };
  if (sourceId !== null && sourceId !== undefined && sourceId !== "") ids[source] = sourceId;
  const numericSpeedKph = speedKph === null || speedKph === undefined || speedKph === ""
    ? null
    : Number(speedKph);
  return {
    id: `${source}:${sourceId || normalizeCoordinateKey(lon, lat)}`,
    source,
    sourceId,
    lon,
    lat,
    speedKph: Number.isFinite(numericSpeedKph) ? Math.round(numericSpeedKph) : null,
    speedMeta: speedMeta || null,
    country: normalizeCountryCode(country) || country || "zz",
    region: cleanString(region),
    sourceMeta: compactObject({
      sources,
      primarySource: sourceMeta.primarySource || source,
      ids,
      country: normalizeCountryCode(country) || country || "zz",
      region: cleanString(region),
      ...sourceMeta,
    }),
    raw,
  };
}

export function normalizeOsmCameraElements(elements, options = {}) {
  const records = [];
  for (const element of Array.isArray(elements) ? elements : []) {
    if (element?.type && element.type !== "node") continue;
    const lon = roundCoordinate(element?.lon);
    const lat = roundCoordinate(element?.lat);
    if (!isFiniteCoordinate(lon, lat)) continue;

    const osmId = Number.isFinite(Number(element.id)) ? Math.round(Number(element.id)) : null;
    const key = osmId ? `osm:${osmId}` : `coord:${lon},${lat}`;
    const explicit = parseCameraMaxspeed(element.tags);
    const enrichment = explicit.parsed ? null : getEnrichmentForKey(options.maxspeedEnrichment, key);
    const country = getTaggedCountryCode(element.tags) || inferCountryFromCoordinate(lon, lat, "zz");
    const tags = element.tags || {};
    const name = cleanString(tags.name || tags.ref || tags["camera:type"]);

    records.push(createRecord({
      source: "osm",
      sourceId: osmId || key,
      lon,
      lat,
      speedKph: explicit.parsed ? explicit.speedKph : enrichment?.speedKph,
      speedMeta: explicit.parsed
        ? { source: "camera:maxspeed", confidence: "high", raw: explicit.raw }
        : enrichment?.speedMeta,
      country,
      sourceMeta: {
        sources: ["osm"],
        primarySource: "osm",
        ids: osmId ? { osm: osmId } : { osm: key },
        names: cleanArray(name),
        aliases: cleanArray([tags.ref, tags.operator]),
        official: false,
      },
      raw: element,
    }));
  }
  return records;
}

function normalizeAnsvActiveStatus(status) {
  const text = String(status ?? "").trim().toLowerCase();
  if (!text) return null;
  if (/operando|autorizada|renovada|prorrogada/.test(text)) return true;
  if (/suspendida|vencida|revocada|cancelada|expirada/.test(text)) return false;
  return null;
}

function splitInfractions(value) {
  return cleanArray(String(value ?? "").split(",").map((part) => part.trim()));
}

export function normalizeAnsvCameraGeoJson(geojson) {
  const records = [];
  for (const feature of Array.isArray(geojson?.features) ? geojson.features : []) {
    const point = featurePoint(feature);
    if (!point) continue;
    const props = feature.properties || {};
    const parsedSpeed = parseMaxspeed(props.speed);
    const sourceId = cleanString(props.unique_code)
      || cleanString(props.device_code)
      || cleanArray([props.request_code, props.device_name]).join(":")
      || `ansv-${stableHash(`${point.lon},${point.lat},${props.address || ""}`)}`;
    const directions = extractDirectionTokens(props.address);
    const infractions = splitInfractions(props.infractions);
    const name = cleanString(props.device_name);
    const active = normalizeAnsvActiveStatus(props.operation_status);

    records.push(createRecord({
      source: "ansv",
      sourceId,
      lon: point.lon,
      lat: point.lat,
      speedKph: parsedSpeed.parsed ? parsedSpeed.speedKph : null,
      speedMeta: parsedSpeed.parsed
        ? { source: "official:ansv:speed", confidence: "high", raw: parsedSpeed.raw }
        : null,
      country: "co",
      region: props.department,
      sourceMeta: {
        sources: ["ansv"],
        primarySource: "ansv",
        ids: { ansv: sourceId },
        names: cleanArray(name),
        aliases: cleanArray([props.address, props.request_code, props.device_code]),
        country: "co",
        region: cleanString(props.department),
        locality: cleanString(props.municipality),
        address: cleanString(props.address),
        jurisdiction: cleanString(props.jurisdiction),
        transitAuthority: cleanString(props.transit_authority),
        official: true,
        active,
        enforcementTypes: ["speed"],
        infractions,
        directions,
        operationStatus: cleanString(props.operation_status),
        approvalDate: cleanString(props.approval_date),
        operationStartDate: cleanString(props.operation_start_date),
        technologyType: cleanString(props.technology_type),
        installationType: cleanString(props.installation_type),
        deviceName: name,
        deviceCode: cleanString(props.device_code),
        requestCode: cleanString(props.request_code),
      },
      raw: feature,
    }));
  }
  return records;
}

export function normalizeNycCameraGeoJson(geojson) {
  const records = [];
  for (const feature of Array.isArray(geojson?.features) ? geojson.features : []) {
    const point = featurePoint(feature);
    if (!point) continue;
    const props = feature.properties || {};
    const sourceId = cleanString(props.id) || `nyc-${stableHash(`${point.lon},${point.lat},${props.name || ""}`)}`;
    const aliases = cleanArray(props.origName);
    const directions = cleanArray([
      ...extractDirectionTokens(props.name),
      ...aliases.flatMap((alias) => extractDirectionTokens(alias)),
    ]);

    records.push(createRecord({
      source: "nyc",
      sourceId,
      lon: point.lon,
      lat: point.lat,
      speedKph: null,
      speedMeta: null,
      country: "us",
      region: "NY",
      sourceMeta: {
        sources: ["nyc"],
        primarySource: "nyc",
        ids: { nyc: Number.isFinite(Number(sourceId)) ? Math.round(Number(sourceId)) : sourceId },
        names: cleanArray(props.name),
        aliases,
        country: "us",
        region: "NY",
        locality: "New York City",
        official: true,
        active: null,
        enforcementTypes: ["speed"],
        directions,
      },
      raw: feature,
    }));
  }
  return records;
}

function normalizeNameKey(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getTicketStats(properties = {}) {
  const dates = Array.isArray(properties.dates) ? properties.dates : [];
  const totalFromDates = dates.reduce((sum, entry) => sum + (Number(entry?.tickets) || 0), 0);
  const dateValues = dates.map((entry) => cleanString(entry?.date)).filter(Boolean).sort();
  return compactObject({
    totalTickets: Math.round(Number(properties.total) || totalFromDates || 0),
    firstDate: dateValues[0] || null,
    lastDate: dateValues.at(-1) || null,
    recentTickets: Number.isFinite(Number(properties.recent)) ? Math.round(Number(properties.recent)) : null,
  });
}

export function normalizeNycTicketGeoJson(geojson) {
  const tickets = [];
  for (const feature of Array.isArray(geojson?.features) ? geojson.features : []) {
    const props = feature.properties || {};
    const aliases = cleanArray(props.origName);
    tickets.push({
      name: cleanString(props.name),
      aliases,
      keys: cleanArray([props.name, ...aliases]).map(normalizeNameKey).filter(Boolean),
      ticketStats: getTicketStats(props),
      raw: feature,
    });
  }
  return tickets;
}

function combineTicketStats(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const firstDates = [a.firstDate, b.firstDate].filter(Boolean).sort();
  const lastDates = [a.lastDate, b.lastDate].filter(Boolean).sort();
  return compactObject({
    totalTickets: Math.round((Number(a.totalTickets) || 0) + (Number(b.totalTickets) || 0)),
    firstDate: firstDates[0] || null,
    lastDate: lastDates.at(-1) || null,
    recentTickets: Math.round((Number(a.recentTickets) || 0) + (Number(b.recentTickets) || 0)),
  });
}

export function attachNycTicketStats(cameraRecords, ticketRecords) {
  const ticketsByKey = new Map();
  for (const ticket of Array.isArray(ticketRecords) ? ticketRecords : []) {
    for (const key of ticket.keys || []) {
      const existing = ticketsByKey.get(key);
      ticketsByKey.set(key, existing
        ? { ...ticket, ticketStats: combineTicketStats(existing.ticketStats, ticket.ticketStats) }
        : ticket);
    }
  }

  return (Array.isArray(cameraRecords) ? cameraRecords : []).map((record) => {
    if (record.source !== "nyc") return record;
    const keys = cleanArray([
      ...(record.sourceMeta.names || []),
      ...(record.sourceMeta.aliases || []),
    ]).map(normalizeNameKey);
    const matchedTickets = Array.from(new Set(keys.map((key) => ticketsByKey.get(key)).filter(Boolean)));
    if (!matchedTickets.length) return record;

    const ticketStats = matchedTickets.reduce(
      (stats, ticket) => combineTicketStats(stats, ticket.ticketStats),
      null,
    );
    return {
      ...record,
      sourceMeta: {
        ...record.sourceMeta,
        sources: cleanArray([...(record.sourceMeta.sources || []), "nyc-tickets"]),
        ticketStats,
      },
    };
  });
}
