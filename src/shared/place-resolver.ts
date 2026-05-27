import {
  createNominatimClient,
  type NominatimClient,
  type NominatimClientOptions,
  type NominatimResponse,
} from './nominatim.js';

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

type OsmType = 'node' | 'way' | 'relation';
type OsmTypePrefix = 'N' | 'W' | 'R';
type RawPlaceRecord = Record<string, unknown>;
type AddressRecord = Record<string, unknown>;

export type NormalizedPlace = {
  label: string;
  detail: string;
  displayName: string;
  countryCode: string;
  countryName: string;
  latitude: number | null;
  longitude: number | null;
  locality: string;
  city: string;
  state: string;
  stateCode: string;
  houseNumber: string;
  road: string;
  osmType: OsmType | '';
  osmId: number | null;
  osmLookupId: string;
};

export type PlaceResolverOptions = NominatimClientOptions & {
  getLanguage?: () => string;
  language?: string;
};

export type ReversePlaceParams = {
  latitude?: number;
  longitude?: number;
  zoom?: number;
  layer?: string;
  language?: string;
};

export type LookupPlacesParams = {
  osmIds?: string | string[];
  language?: string;
  namedetails?: boolean;
  extratags?: boolean;
};

export type PlaceLookupResult<T = unknown> = {
  place: NormalizedPlace | null;
  data: T | null;
  meta: NominatimResponse['meta'] | null;
};

export type PlaceResolver = {
  client: NominatimClient;
  reversePlace(params?: ReversePlaceParams): Promise<PlaceLookupResult>;
  reverseCountry(params?: ReversePlaceParams): Promise<PlaceLookupResult & { countryCode: string }>;
  lookupPlaces(params?: LookupPlacesParams): Promise<{
    places: NormalizedPlace[];
    data: unknown[];
    meta: NominatimResponse['meta'] | null;
  }>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toFiniteNumber(value: unknown): number | null {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeAddress(address: unknown): AddressRecord {
  return address && typeof address === 'object' ? (address as AddressRecord) : {};
}

function dedupeParts(parts: unknown[]): string[] {
  const unique: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = normalizeText(parts[index]);
    if (!part) continue;
    if (unique.includes(part)) continue;
    unique.push(part);
  }

  return unique;
}

function firstAddressValue(address: AddressRecord, keys: readonly string[]): string {
  for (let index = 0; index < keys.length; index += 1) {
    const value = normalizeText(address[keys[index]]);
    if (value) return value;
  }
  return '';
}

function normalizeOsmType(value: unknown): OsmType | '' {
  const normalizedValue = normalizeText(value).toLowerCase();

  if (Object.hasOwn(OSM_TYPE_PREFIX_BY_NAME, normalizedValue)) {
    return normalizedValue as OsmType;
  }

  const prefix = normalizedValue.toUpperCase() as OsmTypePrefix;
  if (Object.hasOwn(OSM_TYPE_NAME_BY_PREFIX, prefix)) {
    return OSM_TYPE_NAME_BY_PREFIX[prefix] as OsmType;
  }

  return '';
}

function normalizeOsmId(value: unknown): number | null {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? Math.round(numericValue) : null;
}

function normalizeSubdivisionCode(value: unknown): string {
  const normalizedValue = normalizeText(value).replace(/\./g, '').toUpperCase();
  if (!normalizedValue) return '';
  if (/^[A-Z]{2,3}$/.test(normalizedValue)) return normalizedValue;

  const match = normalizedValue.match(/^[A-Z]{2,3}-([A-Z0-9]{1,3})$/);
  return match && /^[A-Z]{2,3}$/.test(match[1]) ? match[1] : '';
}

export function normalizeCountryCode(value: unknown): string {
  const normalizedValue = normalizeText(value).toLowerCase();
  return /^[a-z]{2}$/.test(normalizedValue) ? normalizedValue : '';
}

export function buildOsmLookupId(input: unknown): string {
  const place = input && typeof input === 'object' ? (input as RawPlaceRecord) : {};
  const osmType = normalizeOsmType(place.osmType ?? place.osm_type);
  const osmId = normalizeOsmId(place.osmId ?? place.osm_id);
  if (!osmType || !osmId) return '';
  return `${OSM_TYPE_PREFIX_BY_NAME[osmType]}${osmId}`;
}

function derivePlaceLabel(rawPlace: RawPlaceRecord, address: AddressRecord): string {
  return (
    normalizeText(rawPlace.label) ||
    firstAddressValue(address, PLACE_LABEL_KEYS) ||
    normalizeText(rawPlace.name) ||
    normalizeText(rawPlace.displayName ?? rawPlace.display_name)
  );
}

function derivePlaceDetail(
  rawPlace: RawPlaceRecord,
  address: AddressRecord,
  label: string,
  countryName: string
): string {
  if (normalizeText(rawPlace.detail)) {
    return normalizeText(rawPlace.detail);
  }

  const detailParts = dedupeParts([
    ...PLACE_DETAIL_KEYS.map((key) => address[key]),
    countryName,
  ]).filter((part) => part !== label);

  return detailParts.join(', ');
}

export function normalizePlace(value: unknown): NormalizedPlace | null {
  if (!value || typeof value !== 'object') return null;

  const rawPlace = value as RawPlaceRecord;
  const address = normalizeAddress(rawPlace.address);
  const countryCode = normalizeCountryCode(
    rawPlace.countryCode ?? rawPlace.country_code ?? address.country_code
  );
  const countryName = normalizeText(rawPlace.countryName ?? address.country ?? '');
  const label = derivePlaceLabel(rawPlace, address);
  const displayName = normalizeText(rawPlace.displayName ?? rawPlace.display_name);
  const detail = derivePlaceDetail(rawPlace, address, label, countryName);
  const osmType = normalizeOsmType(rawPlace.osmType ?? rawPlace.osm_type);
  const osmId = normalizeOsmId(rawPlace.osmId ?? rawPlace.osm_id);
  const latitude = toFiniteNumber(rawPlace.latitude ?? rawPlace.lat);
  const longitude = toFiniteNumber(rawPlace.longitude ?? rawPlace.lon);
  const locality =
    normalizeText(rawPlace.locality) || firstAddressValue(address, PLACE_LOCALITY_KEYS) || label;
  const city =
    normalizeText(rawPlace.city) || firstAddressValue(address, PLACE_CITY_KEYS) || locality || label;
  const state = normalizeText(rawPlace.state) || firstAddressValue(address, PLACE_STATE_KEYS);
  const stateCode = normalizeSubdivisionCode(
    rawPlace.stateCode ??
      rawPlace.state_code ??
      address.state_code ??
      address['ISO3166-2-lvl4'] ??
      address['ISO3166-2-lvl6']
  );
  const houseNumber = normalizeText(rawPlace.houseNumber ?? rawPlace.house_number ?? address.house_number);
  const road = normalizeText(rawPlace.road ?? rawPlace.street) || firstAddressValue(address, PLACE_ROAD_KEYS);

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

export function formatPlaceDisplay(place: unknown, fallback = '—'): string {
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

export function getPlaceLabel(place: unknown, fallback = '—'): string {
  return formatPlaceDisplay(place, fallback);
}

export function formatPlaceTransition(startPlace: unknown, endPlace: unknown, fallback = '—'): string {
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

export function createPlaceResolver(options: PlaceResolverOptions = {}): PlaceResolver {
  const client = createNominatimClient(options);
  const getLanguage =
    typeof options.getLanguage === 'function'
      ? options.getLanguage
      : () => normalizeText(options.language);

  function resolveLanguage(explicitLanguage: unknown): string {
    return normalizeText(explicitLanguage) || normalizeText(getLanguage());
  }

  async function reversePlace({
    latitude,
    longitude,
    zoom = 13,
    layer = 'address',
    language = '',
  }: ReversePlaceParams = {}): Promise<PlaceLookupResult> {
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

  async function reverseCountry(options: ReversePlaceParams = {}) {
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
  }: LookupPlacesParams = {}) {
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
      places: rawResults.map(normalizePlace).filter((place): place is NormalizedPlace => Boolean(place)),
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
