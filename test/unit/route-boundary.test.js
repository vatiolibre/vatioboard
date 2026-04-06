import { describe, expect, it, vi } from 'vitest';
import {
  buildBoundaryPoint,
  buildRouteBoundaryPlaceDisplay,
  enrichRouteBoundaryPlaces,
  getRouteBoundarySamples,
  isValidGeoSample,
  reverseGeocodeBoundarySample,
} from '../../src/shared/route-boundary.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSample(lat, lon, opts = {}) {
  return {
    latitude: lat,
    longitude: lon,
    speedMs: opts.speedMs ?? undefined,
    timestampMs: opts.timestampMs ?? Date.now(),
    totalDistanceM: opts.totalDistanceM ?? 0,
    ...opts,
  };
}

/** Stationary sample cluster near the same lat/lon. */
function parkedSamples(lat, lon, count, opts = {}) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    samples.push(makeSample(lat, lon, { speedMs: 0, ...opts }));
  }
  return samples;
}

/** Moving samples that displace progressively from (startLat, startLon). */
function movingSamples(startLat, startLon, count, opts = {}) {
  const samples = [];
  const stepLat = opts.stepLat ?? 0.001; // ~111 m per step
  for (let i = 0; i < count; i++) {
    samples.push(
      makeSample(startLat + i * stepLat, startLon, {
        speedMs: opts.speedMs ?? 15,
        timestampMs: (opts.startMs ?? 1000000) + i * 1000,
      })
    );
  }
  return samples;
}

// ---------------------------------------------------------------------------
// isValidGeoSample
// ---------------------------------------------------------------------------

describe('isValidGeoSample', () => {
  it('accepts a normal sample', () => {
    expect(isValidGeoSample({ latitude: 4.6, longitude: -74.1 })).toBe(true);
  });

  it('rejects null/undefined', () => {
    expect(isValidGeoSample(null)).toBe(false);
    expect(isValidGeoSample(undefined)).toBe(false);
  });

  it('rejects missing coordinates', () => {
    expect(isValidGeoSample({ latitude: 4.6 })).toBe(false);
    expect(isValidGeoSample({ longitude: -74.1 })).toBe(false);
  });

  it('rejects NaN coordinates', () => {
    expect(isValidGeoSample({ latitude: NaN, longitude: -74.1 })).toBe(false);
  });

  it('rejects Null Island (0, 0)', () => {
    expect(isValidGeoSample({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it('rejects out-of-range latitude', () => {
    expect(isValidGeoSample({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidGeoSample({ latitude: -91, longitude: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getRouteBoundarySamples – parked lead-in
// ---------------------------------------------------------------------------

describe('getRouteBoundarySamples – parked lead-in', () => {
  it('skips stationary lead-in and picks the first moving sample', () => {
    const samples = [
      ...parkedSamples(4.600, -74.100, 5),
      ...movingSamples(4.601, -74.100, 10),
    ];

    const result = getRouteBoundarySamples(samples);

    expect(result.strategy).toBe('movement');
    // Start sample should NOT be the first parked sample
    expect(result.startSample.latitude).not.toBe(4.600);
    // It should be one of the moving samples
    expect(result.startSample.latitude).toBeGreaterThanOrEqual(4.601);
    expect(result.startIndex).toBeGreaterThanOrEqual(5);
  });

  it('falls back to first/last valid when no movement detected', () => {
    const samples = parkedSamples(4.600, -74.100, 5);
    const result = getRouteBoundarySamples(samples);

    expect(result.strategy).toBe('fallback');
    expect(result.startSample.latitude).toBe(4.600);
    expect(result.endSample.latitude).toBe(4.600);
  });

  it('returns empty when no valid samples', () => {
    const result = getRouteBoundarySamples([]);
    expect(result.strategy).toBe('empty');
    expect(result.startSample).toBeNull();
    expect(result.endSample).toBeNull();
  });

  it('returns empty for array of invalid samples', () => {
    const samples = [
      { latitude: NaN, longitude: -74 },
      { latitude: 0, longitude: 0 },
      null,
    ];
    const result = getRouteBoundarySamples(samples);
    expect(result.strategy).toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// getRouteBoundarySamples – parked tail
// ---------------------------------------------------------------------------

describe('getRouteBoundarySamples – parked tail', () => {
  it('skips trailing stationary samples and picks the last moving sample', () => {
    const samples = [
      ...movingSamples(4.600, -74.100, 10),
      ...parkedSamples(4.610, -74.100, 5),
    ];

    const result = getRouteBoundarySamples(samples);

    expect(result.strategy).toBe('movement');
    // End sample should NOT be the last parked sample
    expect(result.endSample.latitude).not.toBe(4.610);
    // It should be one of the moving samples near the end of movement
    expect(result.endIndex).toBeLessThan(10 + 5 - 1);
  });

  it('handles both parked lead-in and tail simultaneously', () => {
    const samples = [
      ...parkedSamples(4.560, -74.100, 4),
      ...movingSamples(4.570, -74.100, 10),
      ...parkedSamples(4.580, -74.100, 4),
    ];

    const result = getRouteBoundarySamples(samples);

    expect(result.strategy).toBe('movement');
    // Start should skip the first 4 parked samples
    expect(result.startIndex).toBeGreaterThanOrEqual(4);
    // End should not be in the trailing 4 parked samples
    expect(result.endIndex).toBeLessThan(4 + 10 + 4 - 1);
  });
});

// ---------------------------------------------------------------------------
// buildRouteBoundaryPlaceDisplay – suburb vs city
// ---------------------------------------------------------------------------

describe('buildRouteBoundaryPlaceDisplay – suburb vs city', () => {
  it('prefers city over suburb for the label', () => {
    const place = {
      label: 'Chapinero',
      city: 'Bogotá',
      locality: 'Chapinero',
      state: 'Cundinamarca',
      countryCode: 'co',
      address: {
        suburb: 'Chapinero',
        city: 'Bogotá',
        state: 'Cundinamarca',
        country: 'Colombia',
      },
    };

    const display = buildRouteBoundaryPlaceDisplay(place);
    // Main label should be city-level, not suburb
    expect(display.label).toContain('Bogotá');
    expect(display.label).not.toBe('Chapinero');
  });

  it('falls back to suburb when no city is available', () => {
    const place = {
      label: 'Some Hamlet',
      address: {
        hamlet: 'Some Hamlet',
        country: 'Germany',
      },
    };

    const display = buildRouteBoundaryPlaceDisplay(place);
    expect(display.label).toBe('Some Hamlet');
  });

  it('includes road + city when road is present and meaningful', () => {
    const place = {
      city: 'Austin',
      road: 'Congress Ave',
      state: 'Texas',
      countryCode: 'us',
      address: {
        city: 'Austin',
        road: 'Congress Ave',
        state: 'Texas',
        country: 'United States',
      },
    };

    const display = buildRouteBoundaryPlaceDisplay(place);
    expect(display.label).toContain('Congress Ave');
    expect(display.label).toContain('Austin');
  });

  it('provides state/country in detail avoiding label duplication', () => {
    const place = {
      city: 'Miami',
      state: 'Florida',
      countryCode: 'us',
      address: {
        city: 'Miami',
        state: 'Florida',
        country: 'United States',
      },
    };

    const display = buildRouteBoundaryPlaceDisplay(place);
    expect(display.label).toBe('Miami');
    expect(display.detail).toContain('Florida');
    // Label text should not repeat in detail
    expect(display.detail.toLowerCase()).not.toContain('miami');
  });

  it('returns fallback for null place', () => {
    const display = buildRouteBoundaryPlaceDisplay(null);
    expect(display.label).toBe('—');
    expect(display.detail).toBe('');
    expect(display.raw).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildBoundaryPoint
// ---------------------------------------------------------------------------

describe('buildBoundaryPoint', () => {
  it('builds a boundary point from a valid sample', () => {
    const sample = makeSample(4.6, -74.1, { timestampMs: 12345 });
    const point = buildBoundaryPoint(sample, 7);
    expect(point).toEqual({
      latitude: 4.6,
      longitude: -74.1,
      timestampMs: 12345,
      sampleIndex: 7,
    });
  });

  it('returns null for invalid sample', () => {
    expect(buildBoundaryPoint(null, 0)).toBeNull();
    expect(buildBoundaryPoint({ latitude: NaN, longitude: 1 }, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getRouteBoundarySamples – accel mode
// ---------------------------------------------------------------------------

describe('getRouteBoundarySamples – accel boundary selection', () => {
  it('uses actual launch/finish boundary points for short accel runs', () => {
    // Simulate: short idle → fast acceleration → idle
    const samples = [
      makeSample(40.000, -74.000, { speedMs: 0 }),
      makeSample(40.000, -74.000, { speedMs: 0 }),
      // Launch
      makeSample(40.001, -74.000, { speedMs: 5 }),
      makeSample(40.002, -74.000, { speedMs: 15 }),
      makeSample(40.004, -74.000, { speedMs: 30 }),
      makeSample(40.007, -74.000, { speedMs: 40 }),
      // Finish / coast
      makeSample(40.007, -74.000, { speedMs: 0 }),
      makeSample(40.007, -74.000, { speedMs: 0 }),
    ];

    const result = getRouteBoundarySamples(samples, {
      mode: 'accel',
      movementThresholdM: 10,
      speedThresholdMs: 0.5,
      lookaheadWindow: 2,
    });

    expect(result.strategy).toBe('movement');
    // Start should skip the idle lead-in
    expect(result.startIndex).toBeGreaterThanOrEqual(2);
    // End should skip the coasting tail
    expect(result.endIndex).toBeLessThan(7);
  });
});

// ---------------------------------------------------------------------------
// reverseGeocodeBoundarySample – async
// ---------------------------------------------------------------------------

describe('reverseGeocodeBoundarySample', () => {
  it('returns boundary display and place on success', async () => {
    const mockResolver = {
      reversePlace: vi.fn().mockResolvedValue({
        place: {
          label: 'Chapinero',
          city: 'Bogotá',
          state: 'Cundinamarca',
          countryCode: 'co',
          address: { city: 'Bogotá', suburb: 'Chapinero' },
        },
        data: {},
        meta: {},
      }),
    };

    const sample = makeSample(4.6, -74.1);
    const result = await reverseGeocodeBoundarySample(sample, mockResolver);

    expect(result).not.toBeNull();
    expect(result.place.countryCode).toBe('co');
    // boundaryDisplay should prefer city
    expect(result.boundaryDisplay.label).toContain('Bogotá');
    expect(result.countryCode).toBe('co');
  });

  it('returns null for invalid sample', async () => {
    const mockResolver = { reversePlace: vi.fn() };
    const result = await reverseGeocodeBoundarySample(null, mockResolver);
    expect(result).toBeNull();
    expect(mockResolver.reversePlace).not.toHaveBeenCalled();
  });

  it('returns null on network failure', async () => {
    const mockResolver = {
      reversePlace: vi.fn().mockRejectedValue(new Error('Network error')),
    };
    const sample = makeSample(4.6, -74.1);
    const result = await reverseGeocodeBoundarySample(sample, mockResolver);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// enrichRouteBoundaryPlaces – stale enrichment guard
// ---------------------------------------------------------------------------

describe('enrichRouteBoundaryPlaces – stale enrichment', () => {
  it('aborts enrichment when session becomes stale', async () => {
    let currentId = 'session-1';
    const mockResolver = {
      reversePlace: vi.fn().mockImplementation(async () => {
        // Simulate session change during geocoding
        currentId = 'session-2';
        return {
          place: {
            label: 'Old Place',
            city: 'Old City',
            countryCode: 'us',
          },
          data: {},
          meta: {},
        };
      }),
    };

    const samples = movingSamples(4.600, -74.100, 10);
    const result = await enrichRouteBoundaryPlaces(samples, mockResolver, {
      sessionId: 'session-1',
      getCurrentSessionId: () => currentId,
    });

    // Should return null because session became stale during geocoding
    expect(result).toBeNull();
  });

  it('completes enrichment when session is still current', async () => {
    const mockResolver = {
      reversePlace: vi.fn().mockResolvedValue({
        place: {
          label: 'Downtown',
          city: 'Miami',
          state: 'Florida',
          countryCode: 'us',
        },
        data: {},
        meta: {},
      }),
    };

    const samples = movingSamples(25.76, -80.19, 10);
    const result = await enrichRouteBoundaryPlaces(samples, mockResolver, {
      sessionId: 'session-1',
      getCurrentSessionId: () => 'session-1',
    });

    expect(result).not.toBeNull();
    expect(result.startPlace).not.toBeNull();
    expect(result.startPlace.label).toContain('Miami');
    expect(result.startBoundaryPoint).not.toBeNull();
    expect(result.endBoundaryPoint).not.toBeNull();
  });
});
