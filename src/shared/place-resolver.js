import { createNominatimClient } from './nominatim.js';

const PLACE_LABEL_KEYS = [
  'suburb',
  'city_district',
  'borough',
  'quarter',
  'neighbourhood',
  'hamlet',
  'village',
  'town',
  'city',
  'municipality',
  'county',
  'state_district',
  'state',
  'country',
];

const PLACE_DETAIL_KEYS = [
  'city',
  'town',
  'village',
  'municipality',
  'county',
  'state_district',
  'state',
  'country',
];

const PLACE_LOCALITY_KEYS = [
  'suburb',
  'city_district',
  'borough',
  'quarter',
  'neighbourhood',
  'hamlet',
  'village',
  'town',
  'city',
  'municipality',
  'county',
];

const PLACE_CITY_KEYS = ['city', 'town', 'village', 'municipality', 'county'];
const PLACE_STATE_KEYS = ['state', 'state_district', 'region', 'province'];
const PLACE_ROAD_KEYS = ['road', 'pedestrian', 'footway', 'street', 'residential', 'path'];

const OSM_TYPE_PREFIX_BY_NAME = {
  node: 'N',
  way: 'W',
  relation: 'R',
};

const OSM_TYPE_NAME_BY_PREFIX = {
  N: 'node',
  W: 'way',
  R: 'relation',
};

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toFiniteNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeAddress(address) {
  return address && typeof address === 'object' ? address : {};
}

function dedupeParts(parts) {
  const unique = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = normalizeText(parts[index]);
    if (!part) continue;
    if (unique.includes(part)) continue;
    unique.push(part);
  }

  return unique;
}

function firstAddressValue(address, keys) {
  for (let index = 0; index < keys.length; index += 1) {
    const value = normalizeText(address[keys[index]]);
    if (value) return value;
  }
  return '';
}

function normalizeOsmType(value) {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (OSM_TYPE_PREFIX_BY_NAME[normalizedValue]) {
    return normalizedValue;
  }

  if (OSM_TYPE_NAME_BY_PREFIX[normalizedValue.toUpperCase()]) {
    return OSM_TYPE_NAME_BY_PREFIX[normalizedValue.toUpperCase()];
  }

  return '';
}

function normalizeOsmId(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? Math.round(numericValue) : null;
}

function normalizeSubdivisionCode(value) {
  const normalizedValue = normalizeText(value).replace(/\./g, '').toUpperCase();
  if (!normalizedValue) return '';
  if (/^[A-Z]{2,3}$/.test(normalizedValue)) return normalizedValue;

  const match = normalizedValue.match(/^[A-Z]{2,3}-([A-Z0-9]{1,3})$/);
  return match && /^[A-Z]{2,3}$/.test(match[1]) ? match[1] : '';
}

export function normalizeCountryCode(value) {
  const normalizedValue = normalizeText(value).toLowerCase();
  return /^[a-z]{2}$/.test(normalizedValue) ? normalizedValue : '';
}

export function buildOsmLookupId(input) {
  const place = input && typeof input === 'object' ? input : {};
  const osmType = normalizeOsmType(place.osmType ?? place.osm_type);
  const osmId = normalizeOsmId(place.osmId ?? place.osm_id);
  if (!osmType || !osmId) return '';
  return `${OSM_TYPE_PREFIX_BY_NAME[osmType]}${osmId}`;
}

function derivePlaceLabel(rawPlace, address) {
  return (
    normalizeText(rawPlace.label) ||
    firstAddressValue(address, PLACE_LABEL_KEYS) ||
    normalizeText(rawPlace.name) ||
    normalizeText(rawPlace.displayName ?? rawPlace.display_name)
  );
}

function derivePlaceDetail(rawPlace, address, label, countryName) {
  if (normalizeText(rawPlace.detail)) {
    return normalizeText(rawPlace.detail);
  }

  const detailParts = dedupeParts([
    ...PLACE_DETAIL_KEYS.map((key) => address[key]),
    countryName,
  ]).filter((part) => part !== label);

  return detailParts.join(', ');
}

export function normalizePlace(value) {
  if (!value || typeof value !== 'object') return null;

  const address = normalizeAddress(value.address);
  const countryCode = normalizeCountryCode(
    value.countryCode ?? value.country_code ?? address.country_code
  );
  const countryName = normalizeText(value.countryName ?? address.country ?? '');
  const label = derivePlaceLabel(value, address);
  const displayName = normalizeText(value.displayName ?? value.display_name);
  const detail = derivePlaceDetail(value, address, label, countryName);
  const osmType = normalizeOsmType(value.osmType ?? value.osm_type);
  const osmId = normalizeOsmId(value.osmId ?? value.osm_id);
  const latitude = toFiniteNumber(value.latitude ?? value.lat);
  const longitude = toFiniteNumber(value.longitude ?? value.lon);
  const locality =
    normalizeText(value.locality) || firstAddressValue(address, PLACE_LOCALITY_KEYS) || label;
  const city =
    normalizeText(value.city) || firstAddressValue(address, PLACE_CITY_KEYS) || locality || label;
  const state = normalizeText(value.state) || firstAddressValue(address, PLACE_STATE_KEYS);
  const stateCode = normalizeSubdivisionCode(
    value.stateCode ??
      value.state_code ??
      address.state_code ??
      address['ISO3166-2-lvl4'] ??
      address['ISO3166-2-lvl6']
  );
  const houseNumber = normalizeText(value.houseNumber ?? value.house_number ?? address.house_number);
  const road = normalizeText(value.road ?? value.street) || firstAddressValue(address, PLACE_ROAD_KEYS);

  if (!label && !displayName && !countryName && !osmType && !osmId) {
    return null;
  }

  return {
    label: label || displayName || countryName,
    detail,
    displayName,
    countryCode,
    countryName,
    latitude,
    longitude,
    locality,
    city,
    state,
    stateCode,
    houseNumber,
    road,
    osmType,
    osmId,
    osmLookupId: buildOsmLookupId({ osmType, osmId }),
  };
}

export function formatPlaceDisplay(place, fallback = '—') {
  const normalizedPlace = normalizePlace(place);
  if (!normalizedPlace) return fallback;

  const label = normalizeText(normalizedPlace.label);
  const detail = normalizeText(normalizedPlace.detail);
  const displayName = normalizeText(normalizedPlace.displayName);
  const countryName = normalizeText(normalizedPlace.countryName);

  if (detail) {
    if (!label) return detail;
    if (detail === label) return label;
    if (detail.startsWith(`${label},`)) return detail;
    return `${label}, ${detail}`;
  }

  return label || displayName || countryName || fallback;
}

export function getPlaceLabel(place, fallback = '—') {
  return formatPlaceDisplay(place, fallback);
}

export function formatPlaceTransition(startPlace, endPlace, fallback = '—') {
  const normalizedStart = normalizePlace(startPlace);
  const normalizedEnd = normalizePlace(endPlace);
  const startLabel = normalizeText(normalizedStart?.label);
  const endLabel = normalizeText(normalizedEnd?.label);
  const startDetail = normalizeText(normalizedStart?.detail);
  const endDetail = normalizeText(normalizedEnd?.detail);
  const startDisplay = formatPlaceDisplay(normalizedStart, '');
  const endDisplay = formatPlaceDisplay(normalizedEnd, '');

  if (startDisplay && endDisplay) {
    if (startDisplay === endDisplay) {
      return startDisplay;
    }

    if (startLabel && endLabel) {
      if (startLabel === endLabel) {
        return startDisplay || endDisplay;
      }

      if (startDetail && startDetail === endDetail) {
        return `${startLabel} -> ${endLabel}, ${startDetail}`;
      }
    }

    return `${startDisplay} -> ${endDisplay}`;
  }

  return startDisplay || endDisplay || fallback;
}

export function createPlaceResolver(options = {}) {
  const client = createNominatimClient(options);
  const getLanguage =
    typeof options.getLanguage === 'function'
      ? options.getLanguage
      : () => normalizeText(options.language);

  function resolveLanguage(explicitLanguage) {
    return normalizeText(explicitLanguage) || normalizeText(getLanguage());
  }

  async function reversePlace({
    latitude,
    longitude,
    zoom = 13,
    layer = 'address',
    language = '',
  } = {}) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        place: null,
        data: null,
        meta: null,
      };
    }

    const response = await client.reverse({
      lat: latitude,
      lon: longitude,
      zoom,
      layer,
      namedetails: 1,
      'accept-language': resolveLanguage(language) || undefined,
    });

    return {
      place: normalizePlace(response.data),
      data: response.data,
      meta: response.meta,
    };
  }

  async function reverseCountry(options = {}) {
    const response = await reversePlace({
      ...options,
      zoom: Number.isFinite(options.zoom) ? options.zoom : 5,
    });

    return {
      ...response,
      countryCode: response.place?.countryCode || '',
    };
  }

  async function lookupPlaces({
    osmIds,
    language = '',
    namedetails = true,
    extratags = false,
  } = {}) {
    const normalizedIds = Array.isArray(osmIds)
      ? osmIds.map((value) => normalizeText(value)).filter(Boolean)
      : normalizeText(osmIds)
          .split(',')
          .map((value) => normalizeText(value))
          .filter(Boolean);

    if (!normalizedIds.length) {
      return {
        places: [],
        data: [],
        meta: null,
      };
    }

    const response = await client.lookup({
      osm_ids: normalizedIds.join(','),
      namedetails: namedetails ? 1 : undefined,
      extratags: extratags ? 1 : undefined,
      'accept-language': resolveLanguage(language) || undefined,
    });

    const rawResults = Array.isArray(response.data) ? response.data : [];

    return {
      places: rawResults.map(normalizePlace).filter(Boolean),
      data: rawResults,
      meta: response.meta,
    };
  }

  return {
    client,
    reversePlace,
    reverseCountry,
    lookupPlaces,
  };
}
