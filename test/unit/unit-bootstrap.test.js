import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPreferredTripDistanceUnit,
  getRegionalUnitsForCountry,
  hasConfiguredUnitPreferences,
  loadConfiguredDistanceUnit,
  loadConfiguredSpeedUnit,
  loadUnitBootstrap,
  markUnitBootstrapManualSelection,
  maybeInitializeUnitsFromCountry,
} from '../../src/shared/unit-bootstrap.js';

describe('shared unit bootstrap', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('derives shared defaults from the detected country on first use', () => {
    const result = maybeInitializeUnitsFromCountry('US', { nowMs: 123 });

    expect(result.changed).toBe(true);
    expect(localStorage.getItem('vatio_speed_unit')).toBe('mph');
    expect(localStorage.getItem('vatio_speed_distance_unit')).toBe('ft');
    expect(getPreferredTripDistanceUnit()).toBe('mi');
    expect(loadUnitBootstrap()).toMatchObject({
      initializedAtMs: 123,
      updatedAtMs: 123,
      source: 'auto',
      countryCode: 'us',
      speedUnit: 'mph',
      distanceUnit: 'ft',
      tripDistanceUnit: 'mi',
    });
  });

  it('treats existing shared unit preferences as already configured', () => {
    localStorage.setItem('vatio_speed_unit', 'kmh');

    expect(hasConfiguredUnitPreferences()).toBe(true);

    const result = maybeInitializeUnitsFromCountry('us', { nowMs: 500 });

    expect(result.changed).toBe(false);
    expect(localStorage.getItem('vatio_speed_unit')).toBe('kmh');
    expect(localStorage.getItem('vatio_speed_distance_unit')).toBeNull();
    expect(loadUnitBootstrap()).toBeNull();
  });

  it('stores manual overrides for later default trip units', () => {
    markUnitBootstrapManualSelection({
      speedUnit: 'kmh',
      distanceUnit: 'm',
      tripDistanceUnit: 'mi',
    });

    expect(getPreferredTripDistanceUnit()).toBe('mi');
    expect(loadUnitBootstrap()).toMatchObject({
      source: 'manual',
      speedUnit: 'kmh',
      distanceUnit: 'm',
      tripDistanceUnit: 'mi',
    });
    expect(localStorage.getItem('vatio_speed_unit')).toBe('kmh');
    expect(localStorage.getItem('vatio_speed_distance_unit')).toBe('m');
    expect(loadConfiguredSpeedUnit()).toBe('kmh');
    expect(loadConfiguredDistanceUnit()).toBe('m');
    expect(getRegionalUnitsForCountry('co')).toEqual({
      speedUnit: 'kmh',
      distanceUnit: 'm',
      tripDistanceUnit: 'km',
    });
  });

  it('falls back to bootstrap units when the shared keys are missing', () => {
    localStorage.setItem(
      'vatio_unit_bootstrap_v1',
      JSON.stringify({
        initializedAtMs: 100,
        updatedAtMs: 100,
        source: 'manual',
        countryCode: 'us',
        speedUnit: 'mph',
        distanceUnit: 'ft',
        tripDistanceUnit: 'mi',
      })
    );

    expect(localStorage.getItem('vatio_speed_unit')).toBeNull();
    expect(localStorage.getItem('vatio_speed_distance_unit')).toBeNull();
    expect(loadConfiguredSpeedUnit()).toBe('mph');
    expect(loadConfiguredDistanceUnit()).toBe('ft');
  });
});
