import { normalizePlace, type NormalizedPlace } from './place-resolver.js';

const ROUTE_SEPARATOR = ' -> ';

type ParsedStandaloneAddress = {
  streetLine: string;
  city: string;
  state: string;
  comparisonLocality: string;
  formatted: string;
};

type StateNameEntry = {
  name: string;
  code: string;
  tokenCount: number;
};

type CountryNameEntry = {
  name: string;
  tokenCount: number;
};

const ROAD_TOKEN_ABBREVIATIONS: Record<string, string> = {
  avenue: 'Ave',
  boulevard: 'Blvd',
  center: 'Ctr',
  circle: 'Cir',
  court: 'Ct',
  drive: 'Dr',
  east: 'E',
  expressway: 'Expy',
  freeway: 'Fwy',
  highway: 'Hwy',
  lane: 'Ln',
  north: 'N',
  northeast: 'NE',
  northwest: 'NW',
  parkway: 'Pkwy',
  place: 'Pl',
  road: 'Rd',
  route: 'Rte',
  south: 'S',
  southeast: 'SE',
  southwest: 'SW',
  square: 'Sq',
  street: 'St',
  terrace: 'Ter',
  trail: 'Trl',
  turnpike: 'Tpke',
  way: 'Way',
  west: 'W',
};

const US_STATE_CODE_BY_NAME: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC',
};

const COMMON_COUNTRY_NAMES = new Set([
  'canada',
  'colombia',
  'mexico',
  'united kingdom',
  'united states',
  'uk',
  'us',
  'usa',
]);

const US_STATE_NAME_ENTRIES: StateNameEntry[] = Object.entries(US_STATE_CODE_BY_NAME)
  .map(([name, code]) => ({
    name,
    code,
    tokenCount: name.split(' ').length,
  }))
  .sort((left, right) => right.tokenCount - left.tokenCount || right.name.length - left.name.length);

const COUNTRY_NAME_ENTRIES: CountryNameEntry[] = Array.from(COMMON_COUNTRY_NAMES)
  .map((name) => ({
    name,
    tokenCount: name.split(' ').length,
  }))
  .sort((left, right) => right.tokenCount - left.tokenCount || right.name.length - left.name.length);

const US_STATE_CODES = new Set<string>(Object.values(US_STATE_CODE_BY_NAME));
const ROAD_SUFFIX_TOKENS = new Set([
  ...Object.keys(ROAD_TOKEN_ABBREVIATIONS),
  ...Object.values(ROAD_TOKEN_ABBREVIATIONS).map((value) => value.toLowerCase()),
]);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeComparisonValue(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeLooseAddressText(value: unknown): string {
  return normalizeText(value)
    .replace(/\.(?=\s|$)/g, '')
    .replace(/\s*,\s*/g, ' ')
    .replace(/\s*;\s*/g, ' ')
    .replace(/\s+/g, ' ');
}

function splitAddressParts(value: unknown): string[] {
  return normalizeText(value)
    .split(',')
    .map((part) => normalizeLooseAddressText(part))
    .filter(Boolean);
}

function removeCountryParts(parts: string[], countryName = ''): string[] {
  const normalizedCountryName = normalizeComparisonValue(countryName);

  return parts.filter((part) => {
    const normalizedPart = normalizeComparisonValue(part);
    if (!normalizedPart) return false;
    if (normalizedCountryName && normalizedPart === normalizedCountryName) return false;
    return !COMMON_COUNTRY_NAMES.has(normalizedPart);
  });
}

function joinUniqueParts(parts: unknown[]): string {
  const uniqueParts = [];

  for (let index = 0; index < parts.length; index += 1) {
    const normalizedPart = normalizeLooseAddressText(parts[index]);
    if (!normalizedPart) continue;
    if (
      uniqueParts.some(
        (existingPart) => normalizeComparisonValue(existingPart) === normalizeComparisonValue(normalizedPart)
      )
    ) {
      continue;
    }
    uniqueParts.push(normalizedPart);
  }

  return uniqueParts.join(' ');
}

function normalizeSubdivisionCode(value: unknown): string {
  const normalizedValue = normalizeText(value).replace(/\./g, '').toUpperCase();
  if (!normalizedValue) return '';
  if (/^[A-Z]{2,3}$/.test(normalizedValue)) return normalizedValue;

  const match = normalizedValue.match(/^[A-Z]{2,3}-([A-Z0-9]{1,3})$/);
  return match && /^[A-Z]{2,3}$/.test(match[1]) ? match[1] : '';
}

function abbreviateState(value: unknown, countryCode = ''): string {
  const subdivisionCode = normalizeSubdivisionCode(value);
  if (subdivisionCode && countryCode === 'us') return subdivisionCode;

  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return '';
  if (countryCode === 'us') {
    return US_STATE_CODE_BY_NAME[normalizedValue.toLowerCase()] || normalizedValue;
  }

  return normalizedValue;
}

function abbreviateRoadName(road: unknown): string {
  const tokens = normalizeLooseAddressText(road)
    .split(' ')
    .map((token) => normalizeText(token))
    .filter(Boolean);

  if (!tokens.length) return '';

  return tokens
    .map((token) => {
      const normalizedToken = token.replace(/\.$/g, '');
      const replacement = ROAD_TOKEN_ABBREVIATIONS[normalizedToken.toLowerCase()];
      return replacement || normalizedToken;
    })
    .join(' ');
}

function seemsLikeStreetLine(value: string): boolean {
  return (
    /\d/.test(value) ||
    /\b(?:ave|avenue|blvd|boulevard|cir|circle|court|ct|dr|drive|hwy|highway|lane|ln|parkway|pkwy|pl|place|rd|road|rte|route|sq|square|st|street|ter|terrace|tpke|turnpike|way)\b/i.test(
      value
    )
  );
}

function tokenizeAddressText(value: unknown): string[] {
  return normalizeLooseAddressText(value)
    .split(' ')
    .map((token) => normalizeText(token))
    .filter(Boolean);
}

function formatColombiaDisplayState(state: unknown, stateCode = ''): string {
  const subdivisionCode = normalizeSubdivisionCode(stateCode);
  if (subdivisionCode === 'DC') return 'DC';
  const normalizedState = normalizeLooseAddressText(state);
  if (normalizeComparisonValue(normalizedState) === 'distrito capital') return 'DC';
  return normalizedState || subdivisionCode;
}

function formatColombiaStreetLine(streetLine: unknown): string {
  const tokens = tokenizeAddressText(streetLine);
  if (!tokens.length) return '';
  if (tokens.length > 1 && /\d/.test(tokens[0])) {
    return normalizeLooseAddressText([...tokens.slice(1), tokens[0]].join(' '));
  }
  return normalizeLooseAddressText(streetLine);
}

function buildColombiaLocation(locality: unknown, city: unknown, state: unknown, stateCode = ''): string {
  const normalizedLocality = normalizeLooseAddressText(locality);
  const normalizedCity = normalizeLooseAddressText(city);
  const displayState = formatColombiaDisplayState(state, stateCode);
  const locationParts = [normalizedLocality];

  if (
    normalizedCity &&
    normalizeComparisonValue(normalizedCity) !== normalizeComparisonValue(normalizedLocality)
  ) {
    locationParts.push(normalizedCity);
  }

  locationParts.push(displayState);
  return joinUniqueParts(locationParts);
}

function getColombiaComparisonLocality(locality: unknown, city: unknown): string {
  return joinUniqueParts([normalizeLooseAddressText(locality), normalizeLooseAddressText(city)]);
}

function isRoadSuffixToken(token: string): boolean {
  return ROAD_SUFFIX_TOKENS.has(normalizeComparisonValue(token).replace(/\.$/g, ''));
}

function removeTrailingCountryTokens(tokens: string[]): string[] {
  if (!tokens.length) return tokens;

  for (let index = 0; index < COUNTRY_NAME_ENTRIES.length; index += 1) {
    const entry = COUNTRY_NAME_ENTRIES[index];
    if (entry.tokenCount > tokens.length) continue;

    const candidate = tokens.slice(tokens.length - entry.tokenCount).join(' ');
    if (normalizeComparisonValue(candidate) !== entry.name) continue;
    return tokens.slice(0, tokens.length - entry.tokenCount);
  }

  return tokens;
}

function extractTrailingUsState(tokens: string[]): { state: string; tokens: string[] } | null {
  if (!tokens.length) return null;

  const lastToken = normalizeText(tokens[tokens.length - 1]).replace(/\./g, '').toUpperCase();
  if (US_STATE_CODES.has(lastToken)) {
    return {
      state: lastToken,
      tokens: tokens.slice(0, tokens.length - 1),
    };
  }

  for (let index = 0; index < US_STATE_NAME_ENTRIES.length; index += 1) {
    const entry = US_STATE_NAME_ENTRIES[index];
    if (entry.tokenCount > tokens.length) continue;

    const candidate = tokens.slice(tokens.length - entry.tokenCount).join(' ');
    if (normalizeComparisonValue(candidate) !== entry.name) continue;
    return {
      state: entry.code,
      tokens: tokens.slice(0, tokens.length - entry.tokenCount),
    };
  }

  return null;
}

function findStreetEndIndex(tokens: string[]): number {
  for (let index = 1; index < tokens.length; index += 1) {
    if (isRoadSuffixToken(tokens[index])) return index;
  }

  return -1;
}

function parseStandaloneAddressParts(value: unknown): ParsedStandaloneAddress | null {
  const parts = removeCountryParts(splitAddressParts(value), '');
  if (!parts.length) return null;

  if (parts.length === 1) {
    return null;
  }

  if (/\bcolombia\b/i.test(normalizeText(value)) && parts.length >= 3) {
    const locality = parts[1] || '';
    const city = parts[2] || locality;
    const state = parts[3] || '';
    const streetLine = formatColombiaStreetLine(parts[0]);

    return {
      streetLine,
      city,
      state: formatColombiaDisplayState(state),
      comparisonLocality: getColombiaComparisonLocality(locality, city),
      formatted: joinUniqueParts([streetLine, buildColombiaLocation(locality, city, state)]),
    };
  }

  const streetLine = seemsLikeStreetLine(parts[0]) ? abbreviateRoadName(parts[0]) : '';
  const locationParts = streetLine ? parts.slice(1) : parts.slice();
  if (!locationParts.length) {
    return {
      streetLine,
      city: '',
      state: '',
      comparisonLocality: '',
      formatted: streetLine,
    };
  }

  let state = '';
  let cityParts = locationParts.slice();
  const usStateMatch = extractTrailingUsState(tokenizeAddressText(locationParts[locationParts.length - 1]));
  if (usStateMatch && !usStateMatch.tokens.length) {
    state = usStateMatch.state;
    cityParts = locationParts.slice(0, -1);
  } else if (locationParts.length >= 2) {
    state = normalizeLooseAddressText(locationParts[locationParts.length - 1]);
    cityParts = locationParts.slice(0, -1);
  }

  const city = cityParts.length ? normalizeLooseAddressText(cityParts[cityParts.length - 1]) : '';
  return {
    streetLine,
    city,
    state,
    comparisonLocality: city,
    formatted: joinUniqueParts([streetLine, city, state]),
  };
}

function parseStandaloneAddressText(value: unknown): ParsedStandaloneAddress | null {
  const parsedFromParts = parseStandaloneAddressParts(value);
  if (parsedFromParts?.formatted) return parsedFromParts;

  let tokens = tokenizeAddressText(value);
  if (!tokens.length) return null;

  tokens = removeTrailingCountryTokens(tokens);
  if (!tokens.length) return null;

  let state = '';
  const usStateMatch = extractTrailingUsState(tokens);
  if (usStateMatch) {
    state = usStateMatch.state;
    tokens = usStateMatch.tokens;
  }

  const streetEndIndex = findStreetEndIndex(tokens);
  const streetLine =
    streetEndIndex >= 0 ? abbreviateRoadName(tokens.slice(0, streetEndIndex + 1).join(' ')) : '';
  const cityTokens = streetEndIndex >= 0 ? tokens.slice(streetEndIndex + 1) : tokens;
  const city = normalizeLooseAddressText(cityTokens.join(' '));

  return {
    streetLine,
    city,
    state,
    comparisonLocality: city,
    formatted: joinUniqueParts([streetLine, city, state]),
  };
}

function getDisplayParts(place: NormalizedPlace | null | undefined): string[] {
  return removeCountryParts(splitAddressParts(place?.displayName), place?.countryName);
}

function getContextParts(place: NormalizedPlace | null | undefined): string[] {
  const detailParts = removeCountryParts(splitAddressParts(place?.detail), place?.countryName);
  if (detailParts.length) return detailParts;

  const displayParts = getDisplayParts(place);
  if (displayParts.length > 1 && seemsLikeStreetLine(displayParts[0])) {
    return displayParts.slice(1);
  }

  return displayParts;
}

function getPlaceLocality(place: unknown): string {
  const normalizedPlace = normalizePlace(place);
  if (!normalizedPlace) return '';

  return (
    normalizeLooseAddressText(normalizedPlace.locality) ||
    normalizeLooseAddressText(normalizedPlace.label) ||
    getContextParts(normalizedPlace)[0] ||
    ''
  );
}

function getPlaceCity(place: unknown): string {
  const normalizedPlace = normalizePlace(place);
  if (!normalizedPlace) return '';

  return (
    normalizeLooseAddressText(normalizedPlace.city) ||
    normalizeLooseAddressText(normalizedPlace.locality) ||
    normalizeLooseAddressText(normalizedPlace.label) ||
    getContextParts(normalizedPlace)[0] ||
    ''
  );
}

function getPlaceState(place: unknown): string {
  const normalizedPlace = normalizePlace(place);
  if (!normalizedPlace) return '';

  const explicitState = normalizeLooseAddressText(normalizedPlace.state);
  if (explicitState) return explicitState;

  const subdivisionCode = normalizeSubdivisionCode(normalizedPlace.stateCode);
  if (subdivisionCode && normalizedPlace.countryCode === 'us') {
    return subdivisionCode;
  }

  const contextParts = getContextParts(normalizedPlace);
  if (contextParts.length >= 2) {
    return normalizeLooseAddressText(contextParts[contextParts.length - 1]);
  }

  if (
    contextParts.length === 1 &&
    normalizeComparisonValue(contextParts[0]) !== normalizeComparisonValue(getPlaceCity(normalizedPlace))
  ) {
    return normalizeLooseAddressText(contextParts[0]);
  }

  return subdivisionCode && normalizedPlace.countryCode === 'us' ? subdivisionCode : '';
}

function getPlaceDisplayState(place: unknown): string {
  const normalizedPlace = normalizePlace(place);
  if (!normalizedPlace) return '';

  if (normalizedPlace.countryCode === 'co') {
    return formatColombiaDisplayState(normalizedPlace.state, normalizedPlace.stateCode);
  }

  return abbreviateState(getPlaceState(normalizedPlace), normalizedPlace.countryCode);
}

function getRouteComparisonLocality(place: unknown): string {
  const normalizedPlace = normalizePlace(place);
  if (!normalizedPlace) return '';

  if (normalizedPlace.countryCode === 'co') {
    return getColombiaComparisonLocality(getPlaceLocality(normalizedPlace), getPlaceCity(normalizedPlace));
  }

  return getPlaceCity(normalizedPlace);
}

function getPlaceDisplayLocation(place: unknown): string {
  const normalizedPlace = normalizePlace(place);
  if (!normalizedPlace) return '';

  if (normalizedPlace.countryCode === 'co') {
    return buildColombiaLocation(
      getPlaceLocality(normalizedPlace),
      getPlaceCity(normalizedPlace),
      normalizedPlace.state,
      normalizedPlace.stateCode
    );
  }

  return joinUniqueParts([getPlaceCity(normalizedPlace), getPlaceDisplayState(normalizedPlace)]);
}

function getStreetLine(place: unknown): string {
  const normalizedPlace = normalizePlace(place);
  if (!normalizedPlace) return '';

  const explicitStreetLine = joinUniqueParts([
    normalizedPlace.countryCode === 'co'
      ? formatColombiaStreetLine(joinUniqueParts([normalizedPlace.houseNumber, normalizedPlace.road]))
      : normalizeLooseAddressText(normalizedPlace.houseNumber),
    normalizedPlace.countryCode === 'co'
      ? ''
      : abbreviateRoadName(normalizedPlace.road),
  ]);
  if (explicitStreetLine) return explicitStreetLine;

  const displayParts = getDisplayParts(normalizedPlace);
  if (!displayParts.length) return '';

  const firstDisplayPart = normalizeLooseAddressText(displayParts[0]);
  if (!firstDisplayPart) return '';
  if (!seemsLikeStreetLine(firstDisplayPart)) return '';
  if (normalizeComparisonValue(firstDisplayPart) === normalizeComparisonValue(getPlaceLocality(normalizedPlace))) {
    return '';
  }

  return firstDisplayPart;
}

function formatStandaloneAddressText(value: unknown): string {
  return parseStandaloneAddressText(value)?.formatted || normalizeLooseAddressText(value);
}

function optimizeTextRoute(startText: unknown, endText: unknown, fallback = '—'): string {
  const parsedStart = parseStandaloneAddressText(startText);
  const parsedEnd = parseStandaloneAddressText(endText);
  const normalizedStart = parsedStart?.formatted || formatStandaloneAddressText(startText);
  const normalizedEnd = parsedEnd?.formatted || formatStandaloneAddressText(endText);

  if (normalizedStart && normalizedEnd) {
    const sameCity =
      Boolean(parsedStart?.comparisonLocality || parsedStart?.city) &&
      Boolean(parsedEnd?.comparisonLocality || parsedEnd?.city) &&
      normalizeComparisonValue(parsedStart?.comparisonLocality || parsedStart?.city) ===
        normalizeComparisonValue(parsedEnd?.comparisonLocality || parsedEnd?.city);
    const sameState =
      Boolean(parsedStart?.state) &&
      Boolean(parsedEnd?.state) &&
      normalizeComparisonValue(parsedStart.state) === normalizeComparisonValue(parsedEnd.state);
    if (sameCity && sameState && parsedEnd?.streetLine) {
      return `${normalizedStart}${ROUTE_SEPARATOR}${parsedEnd.streetLine}`;
    }

    return `${normalizedStart}${ROUTE_SEPARATOR}${normalizedEnd}`;
  }

  return normalizedStart || normalizedEnd || fallback;
}

export function formatPlaceAddress(place: unknown, fallback = '—'): string {
  const normalizedPlace = normalizePlace(place);
  if (!normalizedPlace) {
    return typeof place === 'string' ? formatStandaloneAddressText(place) || fallback : fallback;
  }

  const streetLine = getStreetLine(normalizedPlace);
  const location = getPlaceDisplayLocation(normalizedPlace);
  const formatted = joinUniqueParts([streetLine, location]);

  return formatted || fallback;
}

export function formatRouteString(start: unknown, end: unknown, fallback = '—'): string {
  const normalizedStart = normalizePlace(start);
  const normalizedEnd = normalizePlace(end);

  if (!normalizedStart || !normalizedEnd) {
    return optimizeTextRoute(
      normalizedStart ? formatPlaceAddress(normalizedStart, '') : start,
      normalizedEnd ? formatPlaceAddress(normalizedEnd, '') : end,
      fallback
    );
  }

  const startLocality = getRouteComparisonLocality(normalizedStart);
  const endLocality = getRouteComparisonLocality(normalizedEnd);
  const startState = getPlaceDisplayState(normalizedStart);
  const endState = getPlaceDisplayState(normalizedEnd);
  const sameLocality =
    Boolean(startLocality) &&
    Boolean(endLocality) &&
    normalizeComparisonValue(startLocality) === normalizeComparisonValue(endLocality);
  const sameState =
    Boolean(startState) &&
    Boolean(endState) &&
    normalizeComparisonValue(startState) === normalizeComparisonValue(endState);

  const startText = formatPlaceAddress(normalizedStart, '');
  const endStreetLine = getStreetLine(normalizedEnd);
  const endText =
    sameLocality && sameState && endStreetLine
      ? endStreetLine
      : formatPlaceAddress(normalizedEnd, '');

  if (startText && endText) {
    return `${startText}${ROUTE_SEPARATOR}${endText}`;
  }

  return startText || endText || fallback;
}

export function formatOptimizedRouteString(start: unknown, end: unknown, fallback = '—'): string {
  return formatRouteString(start, end, fallback);
}
