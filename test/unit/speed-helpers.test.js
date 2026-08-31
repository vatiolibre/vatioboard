import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAlertUiState, normalizeAlertDisplayValue } from '../../src/speed/alerts.js';
import {
  createGlobeController,
  getMovementThresholdM,
  getResponsiveGlobeZoom,
  normalizePositionTimestamp,
} from '../../src/speed/navigation.js';
import {
  loadCameraApproachOptionsPreference,
  loadDistanceUnitPreference,
  loadUnitPreference,
  normalizeCameraApproachFallbackMode,
  normalizeTrapAlertDistance,
} from '../../src/speed/preferences.js';
import { convertSpeed } from '../../src/speed/render.js';
import {
  formatTrapDistance,
  formatTrapSpeed,
  updateNearestTrap,
  updateNearestTrapAcrossDatasets,
} from '../../src/speed/traps.js';

describe('speed extracted helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('fits globe zoom to short rectangular mounts without enlarging square mounts', () => {
    expect(getResponsiveGlobeZoom(0.8, 260, 195)).toBeCloseTo(0.38496, 4);
    expect(getResponsiveGlobeZoom(0.15, 260, 195)).toBeCloseTo(-0.26504, 4);
    expect(getResponsiveGlobeZoom(0.8, 220, 220)).toBe(0.8);
    expect(getResponsiveGlobeZoom(0.8, 0, 195)).toBe(0.8);
  });

  it('refits an actively followed globe on resize but preserves paused user zoom', () => {
    const globeMount = document.createElement('div');
    globeMount.getBoundingClientRect = () => ({ width: 260, height: 195 });
    const map = {
      getZoom: vi.fn(() => 0.8),
      resize: vi.fn(),
      setZoom: vi.fn(),
    };
    const state = {
      globeMap: map,
      globeReady: true,
      globeFollowPausedUntil: 0,
      lastKnownLatitude: 40,
      lastKnownLongitude: -74,
      lastPoint: null,
    };
    const controller = createGlobeController({
      state,
      elements: { globeMount },
      t: (key) => key,
      renderStatusText: () => '',
    });

    controller.resizeGlobe();
    expect(map.resize).toHaveBeenCalledTimes(1);
    expect(map.setZoom).toHaveBeenCalledWith(expect.closeTo(0.38496, 4));

    state.globeFollowPausedUntil = Date.now() + 10_000;
    map.resize.mockClear();
    map.setZoom.mockClear();
    controller.resizeGlobe();
    expect(map.resize).toHaveBeenCalledTimes(1);
    expect(map.setZoom).not.toHaveBeenCalled();
  });

  it('renders requesting, timestamp, retry, and unavailable globe status without a visual title', () => {
    const globeStatus = document.createElement('p');
    const state = {
      globeError: null,
      lastPositionTimestamp: Number.NaN,
      statusText: 'Requesting GPS...',
    };
    const controller = createGlobeController({
      state,
      elements: { globeStatus },
      t: (key) => key === 'globeUnavailable' ? 'Globe unavailable' : key,
      renderStatusText: (timestamp) => `Position ${timestamp}`,
    });

    controller.renderGlobeStatus();
    expect(globeStatus.textContent).toBe('Requesting GPS...');

    state.lastPositionTimestamp = 123;
    controller.renderGlobeStatus();
    expect(globeStatus.textContent).toBe('Position 123');

    state.lastPositionTimestamp = Number.NaN;
    state.statusText = 'Retry location';
    controller.renderGlobeStatus();
    expect(globeStatus.textContent).toBe('Retry location');

    state.globeError = new Error('map failed');
    controller.renderGlobeStatus();
    expect(globeStatus.textContent).toBe('Globe unavailable');
  });

  it('normalizes alert display values to unit steps and limits', () => {
    expect(normalizeAlertDisplayValue(67, 'mph')).toBe(65);
    expect(normalizeAlertDisplayValue(9, 'mph')).toBe(10);
    expect(normalizeAlertDisplayValue(287, 'kmh')).toBe(280);
  });

  it('snaps trap alert distance preferences to the nearest preset', () => {
    expect(normalizeTrapAlertDistance(780, 'ft')).toBeCloseTo(804.672, 6);
    expect(normalizeTrapAlertDistance(850, 'm')).toBe(1000);
  });

  it('loads tunable camera approach matcher preferences safely', () => {
    expect(normalizeCameraApproachFallbackMode('heading-only')).toBe('heading-only');
    expect(normalizeCameraApproachFallbackMode('radius-party')).toBe('legacy-radius');

    localStorage.setItem('vatio_speed_camera_approach_fallback_mode', 'silent');
    localStorage.setItem('vatio_speed_camera_approach_heading_tolerance_deg', '35');
    localStorage.setItem('vatio_speed_camera_approach_minimum_speed_ms', '2.25');

    expect(loadCameraApproachOptionsPreference()).toEqual({
      fallbackMode: 'silent',
      headingToleranceDeg: 35,
      minimumSpeedMs: 2.25,
    });
  });

  it('loads unit preferences from the bootstrap snapshot when shared keys are absent', () => {
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

    expect(loadUnitPreference()).toBe('mph');
    expect(loadDistanceUnitPreference()).toBe('ft');
  });

  it('builds trap-priority alert state with over-limit details', () => {
    const alertState = getAlertUiState({
      unit: 'mph',
      currentSpeedMs: 35,
      alertEnabled: true,
      alertLimitMs: 30,
      trapAlertEnabled: true,
      trapLoadPending: false,
      trapLoadError: null,
      nearestTrapId: 7,
      nearestTrapDistanceM: 320,
      nearestTrapSpeedKph: 100,
      trapAlertDistanceM: 500,
      convertSpeed,
      getTrapAlertDistanceLabel: (distanceM) => `${Math.round(distanceM)} m`,
      formatTrapSpeed: (speedKph) => `${Math.round(speedKph / 1.609344)} mph`,
    });

    expect(alertState).toMatchObject({
      source: 'trap',
      enabled: true,
      trapActive: true,
      trapDistanceLabel: '320 m',
      trapSpeedLabel: '62 mph',
      over: true,
      near: false,
    });
    expect(alertState.limitDisplayValue).toBe(62);
    expect(alertState.deltaDisplayValue).toBe(16);
  });

  it('builds manual near-limit alert state when no trap limit is active', () => {
    const alertState = getAlertUiState({
      unit: 'kmh',
      currentSpeedMs: 28,
      alertEnabled: true,
      alertLimitMs: 30,
      trapAlertEnabled: false,
      trapLoadPending: false,
      trapLoadError: null,
      nearestTrapId: null,
      nearestTrapDistanceM: null,
      nearestTrapSpeedKph: null,
      trapAlertDistanceM: 500,
      convertSpeed,
      getTrapAlertDistanceLabel: () => null,
      formatTrapSpeed: () => null,
    });

    expect(alertState).toMatchObject({
      source: 'manual',
      enabled: true,
      trapActive: false,
      over: false,
      near: true,
      limitDisplayValue: 108,
    });
  });

  it('formats trap distances and speeds for metric and imperial units', () => {
    expect(formatTrapDistance(450, 'm')).toEqual({ value: '450', unit: 'm' });
    expect(formatTrapDistance(2000, 'ft')).toEqual({ value: '1.2', unit: 'mi' });
    expect(formatTrapDistance(Number.NaN, 'm', 'away')).toEqual({ value: '—', unit: 'away' });
    expect(formatTrapSpeed(100, 'kmh')).toBe('100 km/h');
    expect(formatTrapSpeed(100, 'mph')).toBe('62 mph');
  });

  it('updates nearest trap state from injected spatial helpers', () => {
    const trapState = updateNearestTrap(
      { fake: true },
      [
        [-74, 4.7, 50],
        [-73.99, 4.71, 80],
      ],
      -74.1,
      4.72,
      {
        around: vi.fn(() => [1]),
        distanceKm: vi.fn(() => 0.42),
      }
    );

    expect(trapState).toEqual({
      nearestTrapId: 1,
      nearestTrapDistanceM: 420,
      nearestTrapSpeedKph: 80,
      nearestTrapSpeedMeta: null,
    });
  });

  it('returns optional nearest trap speed metadata without changing speed semantics', () => {
    const meta = { source: 'nearest_road:maxspeed', confidence: 'medium', wayId: 9, distanceM: 18, raw: '50' };
    const trapState = updateNearestTrap(
      { fake: true },
      [[-73.99, 4.71, 50, 123, meta]],
      -74.1,
      4.72,
      {
        around: vi.fn(() => [0]),
        distanceKm: vi.fn(() => 0.12),
      }
    );

    expect(trapState).toMatchObject({
      nearestTrapSpeedKph: 50,
      nearestTrapSpeedMeta: meta,
    });
  });

  it('keeps unknown trap speed null instead of zero', () => {
    const trapState = updateNearestTrap(
      { fake: true },
      [[-73.99, 4.71, null, 123]],
      -74.1,
      4.72,
      {
        around: vi.fn(() => [0]),
        distanceKm: vi.fn(() => 0.12),
      }
    );

    expect(trapState.nearestTrapSpeedKph).toBeNull();
  });

  it('does not let low-confidence inferred trap speed override the manual alert limit', () => {
    const alertState = getAlertUiState({
      unit: 'kmh',
      currentSpeedMs: 20,
      alertEnabled: true,
      alertLimitMs: 30,
      trapAlertEnabled: true,
      trapLoadPending: false,
      trapLoadError: null,
      nearestTrapId: 7,
      nearestTrapDistanceM: 100,
      nearestTrapSpeedKph: 50,
      nearestTrapSpeedMeta: { source: 'nearest_road:maxspeed', confidence: 'low' },
      trapAlertDistanceM: 500,
      convertSpeed,
      getTrapAlertDistanceLabel: (distanceM) => `${Math.round(distanceM)} m`,
      formatTrapSpeed: (speedKph) => `${speedKph} km/h`,
    });

    expect(alertState).toMatchObject({
      source: 'manual',
      trapActive: true,
      trapSpeedLabel: '50 km/h',
      over: false,
      limitDisplayValue: 108,
    });
  });

  it('finds the nearest trap across multiple loaded datasets', () => {
    const trapState = updateNearestTrapAcrossDatasets(
      [
        {
          key: 'country:us',
          index: { id: 'us-index' },
          traps: [[-73.9, 40.7, 50]],
        },
        {
          key: 'country:ca',
          index: { id: 'ca-index' },
          traps: [[-73.99, 40.71, 80]],
        },
      ],
      -74,
      40.72,
      {
        around: vi.fn((index) => index.id === 'us-index' ? [0] : [0]),
        distanceKm: vi.fn((lon, lat, trapLon) => trapLon === -73.9 ? 2 : 0.4),
      }
    );

    expect(trapState).toMatchObject({
      nearestTrapId: 'country:ca:0',
      nearestTrapDistanceM: 400,
      nearestTrapSpeedKph: 80,
      nearestTrapSpeedMeta: null,
    });
    expect(trapState.nearestTrapDataset.key).toBe('country:ca');
  });

  it('normalizes timestamps and movement thresholds safely', () => {
    const now = Date.UTC(2026, 2, 26, 12, 0, 0);
    expect(normalizePositionTimestamp(now - 1000, now)).toBe(now - 1000);
    expect(normalizePositionTimestamp(Date.UTC(1990, 0, 1), now)).toBe(now);
    expect(getMovementThresholdM(50, 30)).toBe(9);
    expect(getMovementThresholdM(null, null)).toBe(4);
  });
});
