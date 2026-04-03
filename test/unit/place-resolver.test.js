import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetNominatimTestState } from '../../src/shared/nominatim.js';
import {
  buildOsmLookupId,
  createPlaceResolver,
  formatPlaceDisplay,
  formatPlaceTransition,
  normalizePlace,
} from '../../src/shared/place-resolver.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('shared place resolver', () => {
  beforeEach(() => {
    __resetNominatimTestState();
  });

  it('normalizes reverse payloads into compact place metadata', () => {
    const place = normalizePlace({
      osm_type: 'relation',
      osm_id: 777,
      lat: '4.711',
      lon: '-74.0721',
      display_name: '13A Calle 72, Chapinero, Bogota, Distrito Capital, Colombia',
      address: {
        house_number: '13A',
        road: 'Calle 72',
        suburb: 'Chapinero',
        city: 'Bogota',
        state: 'Distrito Capital',
        country: 'Colombia',
        country_code: 'co',
        'ISO3166-2-lvl4': 'CO-DC',
      },
    });

    expect(place).toMatchObject({
      label: 'Chapinero',
      detail: 'Bogota, Distrito Capital, Colombia',
      countryCode: 'co',
      countryName: 'Colombia',
      locality: 'Chapinero',
      city: 'Bogota',
      state: 'Distrito Capital',
      stateCode: 'DC',
      houseNumber: '13A',
      road: 'Calle 72',
      osmType: 'relation',
      osmId: 777,
      osmLookupId: 'R777',
    });
    expect(buildOsmLookupId(place)).toBe('R777');
  });

  it('formats place labels and transitions with richer detail when available', () => {
    expect(
      formatPlaceDisplay({
        label: 'Chapinero',
        detail: 'Bogota, Distrito Capital, Colombia',
      })
    ).toBe('Chapinero, Bogota, Distrito Capital, Colombia');

    expect(
      formatPlaceTransition(
        { label: 'Queens', countryCode: 'us' },
        { label: 'Manhattan', countryCode: 'us' }
      )
    ).toBe('Queens -> Manhattan');

    expect(
      formatPlaceTransition(
        { label: 'Queens', detail: 'New York, United States', countryCode: 'us' },
        { label: 'Manhattan', detail: 'New York, United States', countryCode: 'us' }
      )
    ).toBe('Queens -> Manhattan, New York, United States');

    expect(
      formatPlaceTransition(
        { label: 'Bogota', detail: 'Bogota, Colombia', countryCode: 'co' },
        { label: 'Bogota', detail: 'Bogota, Colombia', countryCode: 'co' }
      )
    ).toBe('Bogota, Colombia');
  });

  it('passes the app language through reverse lookups', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        osm_type: 'relation',
        osm_id: 123,
        display_name: 'Bogota, Colombia',
        address: {
          city: 'Bogota',
          country: 'Colombia',
          country_code: 'co',
        },
      })
    );
    const resolver = createPlaceResolver({
      getLanguage: () => 'es',
      fetchImpl,
      scheduleStorage: createMemoryStorage(),
      cacheStorage: createMemoryStorage(),
      now: () => 0,
      wait: async () => {},
    });

    const response = await resolver.reversePlace({
      latitude: 4.711,
      longitude: -74.0721,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('accept-language=es');
    expect(fetchImpl.mock.calls[0][0]).toContain('zoom=13');
    expect(response.place).toMatchObject({
      label: 'Bogota',
      countryCode: 'co',
      osmLookupId: 'R123',
    });
  });
});
