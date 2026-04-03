import { describe, expect, it } from 'vitest';
import {
  formatOptimizedRouteString,
  formatPlaceAddress,
} from '../../src/shared/route-string.js';

describe('shared route string helpers', () => {
  it('optimizes raw route strings using the shared locality tail', () => {
    expect(
      formatOptimizedRouteString(
        '6312 Hilltop Ct, Fort Lee, NJ',
        '123 Anderson Ave, Fort Lee, NJ'
      )
    ).toBe('6312 Hilltop Ct Fort Lee NJ -> 123 Anderson Ave');

    expect(
      formatOptimizedRouteString(
        '6312 Hilltop Ct Fort Lee NJ',
        '119 58th St West New York NJ'
      )
    ).toBe('6312 Hilltop Ct Fort Lee NJ -> 119 58th St West New York NJ');

    expect(
      formatOptimizedRouteString(
        '6312 Hilltop Ct Fort Lee NJ',
        '535 8th Ave Manhattan NY'
      )
    ).toBe('6312 Hilltop Ct Fort Lee NJ -> 535 8th Ave Manhattan NY');

    expect(
      formatOptimizedRouteString(
        '6312 Hilltop Court, Fort Lee, New Jersey',
        '123 Anderson Avenue, Fort Lee, New Jersey'
      )
    ).toBe('6312 Hilltop Ct Fort Lee NJ -> 123 Anderson Ave');
  });

  it('formats normalized place objects as compact geocodable addresses', () => {
    expect(
      formatPlaceAddress({
        label: 'Fort Lee',
        locality: 'Fort Lee',
        state: 'New Jersey',
        stateCode: 'NJ',
        houseNumber: '6312',
        road: 'Hilltop Court',
        countryCode: 'us',
      })
    ).toBe('6312 Hilltop Ct Fort Lee NJ');

    expect(
      formatOptimizedRouteString(
        {
          label: 'Fort Lee',
          city: 'Fort Lee',
          locality: 'Fort Lee',
          state: 'New Jersey',
          stateCode: 'NJ',
          houseNumber: '6312',
          road: 'Hilltop Court',
          countryCode: 'us',
        },
        {
          label: 'Fort Lee',
          city: 'Fort Lee',
          locality: 'Fort Lee',
          state: 'New Jersey',
          stateCode: 'NJ',
          houseNumber: '123',
          road: 'Anderson Avenue',
          countryCode: 'us',
        }
      )
    ).toBe('6312 Hilltop Ct Fort Lee NJ -> 123 Anderson Ave');
  });

  it('uses the actual city instead of the smaller locality when both are available', () => {
    expect(
      formatPlaceAddress({
        address: {
          house_number: '123',
          road: 'Main Street',
          suburb: 'Downtown',
          city: 'Jersey City',
          state: 'New Jersey',
          country: 'United States',
          country_code: 'us',
          'ISO3166-2-lvl4': 'US-NJ',
        },
        display_name: '123 Main Street, Downtown, Jersey City, New Jersey, United States',
      })
    ).toBe('123 Main St Jersey City NJ');
  });

  it('falls back to locality and state when street precision is unavailable', () => {
    expect(
      formatOptimizedRouteString(
        {
          label: 'Queens',
          detail: 'New York, United States',
          countryCode: 'us',
        },
        {
          label: 'Manhattan',
          detail: 'New York, United States',
          countryCode: 'us',
        }
      )
    ).toBe('Queens NY -> Manhattan NY');
  });

  it('formats colombia places with road-first numbering and state code', () => {
    expect(
      formatOptimizedRouteString(
        '13A Calle 72, Chapinero, Bogota, Distrito Capital, Colombia',
        '32 Carrera 7, Chapinero, Bogota, Distrito Capital, Colombia'
      )
    ).toBe('Calle 72 13A Chapinero Bogota DC -> Carrera 7 32');

    expect(
      formatPlaceAddress({
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
        display_name: '13A Calle 72, Chapinero, Bogota, Distrito Capital, Colombia',
      })
    ).toBe('Calle 72 13A Chapinero Bogota DC');

    expect(
      formatOptimizedRouteString(
        {
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
          display_name: '13A Calle 72, Chapinero, Bogota, Distrito Capital, Colombia',
        },
        {
          address: {
            house_number: '32',
            road: 'Carrera 7',
            suburb: 'Chapinero',
            city: 'Bogota',
            state: 'Distrito Capital',
            country: 'Colombia',
            country_code: 'co',
            'ISO3166-2-lvl4': 'CO-DC',
          },
          display_name: '32 Carrera 7, Chapinero, Bogota, Distrito Capital, Colombia',
        }
      )
    ).toBe('Calle 72 13A Chapinero Bogota DC -> Carrera 7 32');

    expect(
      formatPlaceAddress({
        address: {
          house_number: '123',
          road: 'Carrera 43A',
          suburb: 'El Poblado',
          city: 'Medellin',
          state: 'Antioquia',
          country: 'Colombia',
          country_code: 'co',
          'ISO3166-2-lvl4': 'CO-ANT',
        },
        display_name: '123 Carrera 43A, El Poblado, Medellin, Antioquia, Colombia',
      })
    ).toBe('Carrera 43A 123 El Poblado Medellin Antioquia');
  });

  it('keeps full non-us state names for other countries', () => {
    expect(
      formatPlaceAddress({
        address: {
          house_number: '123',
          road: 'Queen Street',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          country_code: 'ca',
        },
        display_name: '123 Queen Street, Toronto, Ontario, Canada',
      })
    ).toBe('123 Queen St Toronto Ontario');
  });
});
