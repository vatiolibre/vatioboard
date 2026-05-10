const EARTH_RADIUS_M = 6371000;
const METERS_PER_DEGREE = 111320;
const DEFAULT_BUCKET_SIZE_M = 100;

const OFFICIAL_SOURCES = new Set(["ansv", "nyc"]);

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueStrings(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [values])
      .flat()
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
      .map((value) => String(value).trim()),
  )).sort((a, b) => a.localeCompare(b));
}

function mergeArrays(...arrays) {
  return uniqueStrings(arrays.flat());
}

function normalizeIdValue(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : String(value);
}

function addSourceId(ids, source, value) {
  const normalized = normalizeIdValue(value);
  if (normalized === null) return;
  const existing = ids[source];
  if (existing === undefined) {
    ids[source] = normalized;
    return;
  }
  const merged = uniqueStrings([existing, normalized]);
  ids[source] = merged.length === 1 && Number.isFinite(Number(merged[0]))
    ? Math.round(Number(merged[0]))
    : merged;
}

function getSourceId(record, source = record?.source) {
  const ids = record?.sourceMeta?.ids || {};
  return ids[source] ?? record?.sourceId ?? record?.id ?? null;
}

function getRecordSources(record) {
  return uniqueStrings(record?.sourceMeta?.sources || record?.source || []);
}

function hasOfficialSource(record) {
  return getRecordSources(record).some((source) => OFFICIAL_SOURCES.has(source));
}

function getPrimarySource(record) {
  return String(record?.sourceMeta?.primarySource || record?.source || "osm");
}

function hasSource(record, source) {
  return getRecordSources(record).includes(source);
}

function normalizeDirections(value) {
  return uniqueStrings(value).map((direction) => direction.toUpperCase());
}

function combineTicketStats(a, b) {
  if (!a && !b) return null;
  if (!a) return { ...b };
  if (!b) return { ...a };

  const firstDates = [a.firstDate, b.firstDate].filter(Boolean).sort();
  const lastDates = [a.lastDate, b.lastDate].filter(Boolean).sort();
  return {
    totalTickets: Math.round((Number(a.totalTickets) || 0) + (Number(b.totalTickets) || 0)),
    firstDate: firstDates[0] || null,
    lastDate: lastDates.at(-1) || null,
    recentTickets: Math.round((Number(a.recentTickets) || 0) + (Number(b.recentTickets) || 0)),
  };
}

export function normalizeCoordinateKey(lon, lat, precision = 6) {
  const longitude = finiteNumber(lon);
  const latitude = finiteNumber(lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return "";
  return `${longitude.toFixed(precision)},${latitude.toFixed(precision)}`;
}

export function distanceMeters(a, b) {
  const lonA = finiteNumber(a?.lon ?? a?.longitude ?? a?.[0]);
  const latA = finiteNumber(a?.lat ?? a?.latitude ?? a?.[1]);
  const lonB = finiteNumber(b?.lon ?? b?.longitude ?? b?.[0]);
  const latB = finiteNumber(b?.lat ?? b?.latitude ?? b?.[1]);
  if (![lonA, latA, lonB, latB].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

  const lat1 = toRadians(latA);
  const lat2 = toRadians(latB);
  const dLat = toRadians(latB - latA);
  const dLon = toRadians(lonB - lonA);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function extractDirectionTokens(text) {
  const normalized = String(text ?? "").toUpperCase();
  const tokens = new Set();
  for (const match of normalized.matchAll(/\b(NB|SB|EB|WB)\b/g)) tokens.add(match[1]);
  for (const match of normalized.matchAll(/\b(NORTE\s*-\s*SUR|SUR\s*-\s*NORTE|ORIENTE\s*-\s*OCCIDENTE|OCCIDENTE\s*-\s*ORIENTE)\b/g)) {
    tokens.add(match[1].replace(/\s+/g, ""));
  }
  return Array.from(tokens).sort();
}

export function createSpatialBuckets(records, bucketSizeMeters = DEFAULT_BUCKET_SIZE_M) {
  const bucketDegrees = Math.max(1, bucketSizeMeters) / METERS_PER_DEGREE;
  const spatialIndex = { buckets: new Map(), bucketDegrees };

  for (const record of Array.isArray(records) ? records : []) {
    insertRecordToSpatialIndex(spatialIndex, record);
  }

  return spatialIndex;
}

function insertRecordToSpatialIndex(spatialIndex, record) {
  if (!spatialIndex || !Number.isFinite(record?.lon) || !Number.isFinite(record?.lat)) return;
  const x = Math.floor((record.lon + 180) / spatialIndex.bucketDegrees);
  const y = Math.floor((record.lat + 90) / spatialIndex.bucketDegrees);
  const key = `${y}:${x}`;
  const bucket = spatialIndex.buckets.get(key) || [];
  bucket.push(record);
  spatialIndex.buckets.set(key, bucket);
}

function getBucketCandidates(record, spatialIndex, thresholdM) {
  if (!spatialIndex) return [];
  const radius = Math.max(1, Math.ceil((thresholdM / METERS_PER_DEGREE) / spatialIndex.bucketDegrees));
  const x = Math.floor((record.lon + 180) / spatialIndex.bucketDegrees);
  const y = Math.floor((record.lat + 90) / spatialIndex.bucketDegrees);
  const candidates = new Set();

  for (let yy = y - radius; yy <= y + radius; yy += 1) {
    for (let xx = x - radius; xx <= x + radius; xx += 1) {
      const bucket = spatialIndex.buckets.get(`${yy}:${xx}`);
      if (bucket) {
        for (const candidate of bucket) candidates.add(candidate);
      }
    }
  }

  return Array.from(candidates);
}

function speedRank(record) {
  if (!Number.isFinite(record?.speedKph) || record.speedKph <= 0) return 0;
  const source = String(record?.speedMeta?.source || "");
  const confidence = String(record?.speedMeta?.confidence || "");
  if (source === "official:ansv:speed") return 40;
  if (source === "camera:maxspeed") return 30;
  if (source.startsWith("nearest_road:")) {
    if (confidence === "high") return 24;
    if (confidence === "medium") return 22;
    return 20;
  }
  return 25;
}

function shouldPreferRecordLocation(record, candidate) {
  const source = getPrimarySource(record);
  const candidateSource = getPrimarySource(candidate);
  if (source === "ansv" && candidate.country === "co") return true;
  if (source === "nyc" && candidate.country === "us") return true;
  if (!OFFICIAL_SOURCES.has(candidateSource) && OFFICIAL_SOURCES.has(source)) return true;
  return false;
}

function getMergeThreshold(record, candidate, options = {}) {
  const recordSources = getRecordSources(record);
  const candidateSources = getRecordSources(candidate);
  const sameSource = recordSources.some((source) => candidateSources.includes(source));
  if (sameSource) return options.sameSourceDistanceM ?? 5;

  if ((hasSource(record, "ansv") && hasSource(candidate, "osm"))
    || (hasSource(record, "osm") && hasSource(candidate, "ansv"))) {
    return options.ansvOsmDistanceM ?? 50;
  }

  if ((hasSource(record, "nyc") && hasSource(candidate, "osm"))
    || (hasSource(record, "osm") && hasSource(candidate, "nyc"))) {
    return options.nycOsmDistanceM ?? 20;
  }

  if (hasOfficialSource(record) || hasOfficialSource(candidate)) {
    return options.officialDistanceM ?? 35;
  }

  return options.defaultDistanceM ?? 25;
}

function hasConflictingOfficialDirections(record, candidate, distanceM) {
  if (distanceM <= 1) return false;
  const a = normalizeDirections(record?.sourceMeta?.directions);
  const b = normalizeDirections(candidate?.sourceMeta?.directions);
  if (!a.length || !b.length) return false;
  return !a.some((direction) => b.includes(direction));
}

export function findMergeCandidate(record, candidates, options = {}) {
  let best = null;
  let bestDistanceM = Number.POSITIVE_INFINITY;

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || candidate === record) continue;
    const threshold = getMergeThreshold(record, candidate, options);
    const distanceM = distanceMeters(record, candidate);
    if (!Number.isFinite(distanceM) || distanceM > threshold) continue;
    if (hasConflictingOfficialDirections(record, candidate, distanceM)
      && !hasSource(record, "nyc")
      && !hasSource(candidate, "nyc")) {
      continue;
    }
    if (distanceM < bestDistanceM) {
      best = candidate;
      bestDistanceM = distanceM;
    }
  }

  return best ? { record: best, distanceM: bestDistanceM } : null;
}

function mergeSourceMeta(base = {}, incoming = {}, { duplicate = false } = {}) {
  const sources = mergeArrays(base.sources, incoming.sources, base.primarySource, incoming.primarySource);
  const primarySource = sources.includes("ansv")
    ? "ansv"
    : (sources.includes("nyc") ? "nyc" : (base.primarySource || incoming.primarySource || "osm"));
  const ids = { ...(base.ids || {}) };
  for (const [source, value] of Object.entries(incoming.ids || {})) {
    addSourceId(ids, source, value);
  }

  return {
    ...base,
    ...incoming,
    sources,
    primarySource,
    ids,
    names: mergeArrays(base.names, incoming.names),
    aliases: mergeArrays(base.aliases, incoming.aliases),
    directions: mergeArrays(base.directions, incoming.directions),
    infractions: mergeArrays(base.infractions, incoming.infractions),
    enforcementTypes: mergeArrays(base.enforcementTypes, incoming.enforcementTypes),
    official: Boolean(base.official || incoming.official),
    active: incoming.active !== null && incoming.active !== undefined ? incoming.active : (base.active ?? null),
    ticketStats: combineTicketStats(base.ticketStats, incoming.ticketStats),
    duplicateCount: (Number(base.duplicateCount) || 0) + (duplicate ? 1 : 0) + (Number(incoming.duplicateCount) || 0),
  };
}

function mergeSpeed(target, incoming) {
  const targetRank = speedRank(target);
  const incomingRank = speedRank(incoming);
  const hasConflict = Number.isFinite(target.speedKph)
    && Number.isFinite(incoming.speedKph)
    && Math.round(target.speedKph) !== Math.round(incoming.speedKph)
    && Math.min(targetRank, incomingRank) >= 30;

  if (hasConflict) {
    const conflicts = target.sourceMeta.speedConflicts || [];
    target.sourceMeta.speedConflicts = [
      ...conflicts,
      {
        kept: target.speedKph,
        incoming: incoming.speedKph,
        incomingSource: incoming.speedMeta?.source || getPrimarySource(incoming),
      },
    ];
  }

  if (incomingRank > targetRank) {
    target.speedKph = incoming.speedKph;
    target.speedMeta = incoming.speedMeta || null;
    if (String(incoming.speedMeta?.source || "").startsWith("official:")) {
      target.sourceMeta.speedUpdatedFromOfficial = true;
    }
  }
}

function mergeInto(target, incoming, { distanceM = null, duplicate = false } = {}) {
  if (shouldPreferRecordLocation(incoming, target)) {
    target.sourceMeta.alternateLocations = [
      ...(target.sourceMeta.alternateLocations || []),
      { source: getPrimarySource(target), lon: target.lon, lat: target.lat },
    ];
    target.lon = incoming.lon;
    target.lat = incoming.lat;
  } else if (Number.isFinite(distanceM) && distanceM > 0) {
    target.sourceMeta.alternateLocations = [
      ...(target.sourceMeta.alternateLocations || []),
      { source: getPrimarySource(incoming), lon: incoming.lon, lat: incoming.lat },
    ];
  }

  target.country = incoming.country || target.country;
  target.region = incoming.region || target.region;
  target.sourceMeta = mergeSourceMeta(target.sourceMeta, incoming.sourceMeta, { duplicate });
  mergeSpeed(target, incoming);
  return target;
}

function cloneRecord(record) {
  const rawMeta = {
    ...(record.sourceMeta || {}),
  };
  rawMeta.sources = mergeArrays(rawMeta.sources, record.source || "osm");
  rawMeta.primarySource = rawMeta.primarySource || record.source || "osm";
  rawMeta.ids = { ...(rawMeta.ids || {}) };
  addSourceId(rawMeta.ids, record.source || "osm", getSourceId(record));
  return {
    ...record,
    sourceMeta: mergeSourceMeta({}, rawMeta),
  };
}

export function mergeCameraRecords(records, options = {}) {
  const merged = [];
  const stats = {
    addedByOfficialSources: 0,
    mergedOfficialIntoOsm: 0,
    speedUpdatedFromOfficial: 0,
    ticketStatsAttached: 0,
    duplicateCandidatesSkipped: 0,
    conflicts: 0,
  };
  const spatialIndex = createSpatialBuckets([], options.bucketSizeMeters ?? DEFAULT_BUCKET_SIZE_M);

  for (const sourceRecord of Array.isArray(records) ? records : []) {
    if (!Number.isFinite(sourceRecord?.lon) || !Number.isFinite(sourceRecord?.lat)) continue;
    const record = cloneRecord(sourceRecord);
    const maxThreshold = Math.max(
      options.ansvOsmDistanceM ?? 50,
      options.officialDistanceM ?? 35,
      options.defaultDistanceM ?? 25,
    );
    const candidate = findMergeCandidate(record, getBucketCandidates(record, spatialIndex, maxThreshold), options);

    if (!candidate) {
      merged.push(record);
      if (hasOfficialSource(record) && !hasSource(record, "osm")) stats.addedByOfficialSources += 1;
      insertRecordToSpatialIndex(spatialIndex, record);
      continue;
    }

    const beforeSpeed = candidate.record.speedKph;
    const beforeSource = candidate.record.speedMeta?.source;
    const hadOsm = hasSource(candidate.record, "osm");
    const hadTicketStats = Boolean(candidate.record.sourceMeta.ticketStats);
    mergeInto(candidate.record, record, {
      distanceM: candidate.distanceM,
      duplicate: true,
    });

    if (hasOfficialSource(record)) stats.duplicateCandidatesSkipped += 1;
    if (hadOsm && hasOfficialSource(record)) stats.mergedOfficialIntoOsm += 1;
    if (candidate.record.sourceMeta.ticketStats && !hadTicketStats) stats.ticketStatsAttached += 1;
    if (
      candidate.record.speedMeta?.source !== beforeSource
      && candidate.record.speedMeta?.source?.startsWith("official:")
      && candidate.record.speedKph !== beforeSpeed
    ) {
      stats.speedUpdatedFromOfficial += 1;
    }
    stats.conflicts += candidate.record.sourceMeta.speedConflicts?.length || 0;
  }

  for (const record of merged) {
    if (record.sourceMeta.ticketStats) stats.ticketStatsAttached += 1;
    if (record.sourceMeta.speedUpdatedFromOfficial) stats.speedUpdatedFromOfficial += 1;
    if (record.sourceMeta.speedConflicts?.length) stats.conflicts += record.sourceMeta.speedConflicts.length;
  }

  stats.ticketStatsAttached = Math.min(stats.ticketStatsAttached, merged.length);
  return { records: merged, stats };
}
