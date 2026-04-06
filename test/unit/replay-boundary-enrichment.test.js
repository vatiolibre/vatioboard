import { describe, expect, it, vi } from 'vitest';
import {
  enrichRouteBoundaryPlaces,
  getRouteBoundarySamples,
  isValidGeoSample,
} from '../../src/shared/route-boundary.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSample(lat, lon, opts = {}) {
  return {
    latitude: lat,
    longitude: lon,
    speedMs: opts.speedMs ?? 5,
    timestampMs: opts.timestampMs ?? Date.now(),
    totalDistanceM: opts.totalDistanceM ?? 0,
    altitudeM: opts.altitudeM ?? null,
    accuracyM: opts.accuracyM ?? 5,
    headingDeg: opts.headingDeg ?? null,
  };
}

function makePlaceResponse(label, city, countryCode = 'us') {
  return {
    place: {
      label,
      city,
      locality: city,
      state: 'New Jersey',
      stateCode: 'NJ',
      countryCode,
      road: '',
      houseNumber: '',
    },
    data: null,
    meta: null,
  };
}

function mockPlaceResolver(responses) {
  return {
    reversePlace: vi.fn(async ({ latitude }) => {
      for (const [minLat, response] of responses) {
        if (latitude >= minLat) return response;
      }
      return { place: null, data: null, meta: null };
    }),
  };
}

// ---------------------------------------------------------------------------
// getRouteBoundarySamples — minimal 2-sample inputs
// ---------------------------------------------------------------------------

describe('getRouteBoundarySamples – minimal sample sets', () => {
  it('resolves start and end from two distinct valid samples', () => {
    const first = makeSample(40.85, -73.97, { speedMs: 5, timestampMs: 1000 });
    const last = makeSample(40.78, -74.01, { speedMs: 10, timestampMs: 5000 });

    const result = getRouteBoundarySamples([first, last]);

    expect(result.startSample).toBe(first);
    expect(result.endSample).toBe(last);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(1);
    expect(result.strategy).not.toBe('empty');
  });

  it('falls back cleanly when two samples share coordinates', () => {
    const first = makeSample(40.85, -73.97, { speedMs: 0, timestampMs: 1000 });
    const last = makeSample(40.85, -73.97, { speedMs: 0, timestampMs: 5000 });

    const result = getRouteBoundarySamples([first, last]);

    expect(result.startSample).toBe(first);
    expect(result.endSample).toBe(last);
    expect(result.strategy).toBe('fallback');
  });

  it('returns empty when given an empty array', () => {
    const result = getRouteBoundarySamples([]);
    expect(result.strategy).toBe('empty');
    expect(result.startSample).toBeNull();
    expect(result.endSample).toBeNull();
  });

  it('handles a single valid sample', () => {
    const sample = makeSample(40.85, -73.97, { speedMs: 5 });
    const result = getRouteBoundarySamples([sample]);
    expect(result.startSample).toBe(sample);
    expect(result.endSample).toBe(sample);
    expect(result.strategy).not.toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// enrichRouteBoundaryPlaces — metadata-only session (2-sample input)
// ---------------------------------------------------------------------------

describe('enrichRouteBoundaryPlaces – metadata-only replay session', () => {
  it('resolves both places from two distinct samples', async () => {
    const first = makeSample(40.85, -73.97, { speedMs: 5, timestampMs: 1000 });
    const last = makeSample(40.78, -74.01, { speedMs: 10, timestampMs: 5000 });

    const resolver = mockPlaceResolver([
      [40.8, makePlaceResponse('Fort Lee', 'Fort Lee')],
      [0, makePlaceResponse('West New York', 'West New York')],
    ]);

    const enrichment = await enrichRouteBoundaryPlaces([first, last], resolver, {
      mode: 'speed',
    });

    expect(enrichment).not.toBeNull();
    expect(enrichment.startPlace).toMatchObject({ label: expect.any(String) });
    expect(enrichment.startPlace.raw).toBeTruthy();
    expect(enrichment.endPlace).toMatchObject({ label: expect.any(String) });
    expect(enrichment.endPlace.raw).toBeTruthy();
    expect(enrichment.startBoundaryPoint).toMatchObject({
      latitude: 40.85,
      longitude: -73.97,
    });
    expect(enrichment.endBoundaryPoint).toMatchObject({
      latitude: 40.78,
      longitude: -74.01,
    });
  });

  it('reuses start place when start and end coordinates match', async () => {
    const first = makeSample(40.85, -73.97, { speedMs: 0, timestampMs: 1000 });
    const last = makeSample(40.85, -73.97, { speedMs: 0, timestampMs: 5000 });

    const resolver = mockPlaceResolver([
      [0, makePlaceResponse('Fort Lee', 'Fort Lee')],
    ]);

    const enrichment = await enrichRouteBoundaryPlaces([first, last], resolver, {
      mode: 'speed',
    });

    expect(enrichment).not.toBeNull();
    expect(enrichment.startPlace).toMatchObject({ label: expect.any(String) });
    expect(enrichment.endPlace).toMatchObject({ label: expect.any(String) });
    // Only one geocode call needed for identical coordinates
    expect(resolver.reversePlace).toHaveBeenCalledTimes(1);
  });

  it('returns null for empty sample input', async () => {
    const resolver = mockPlaceResolver([]);
    const enrichment = await enrichRouteBoundaryPlaces([], resolver, { mode: 'speed' });
    expect(enrichment).toBeNull();
  });

  it('resolves start when only one sample is provided', async () => {
    const sample = makeSample(40.85, -73.97, { speedMs: 5, timestampMs: 1000 });
    const resolver = mockPlaceResolver([
      [0, makePlaceResponse('Fort Lee', 'Fort Lee')],
    ]);

    const enrichment = await enrichRouteBoundaryPlaces([sample], resolver, {
      mode: 'speed',
    });

    expect(enrichment).not.toBeNull();
    expect(enrichment.startPlace).toBeTruthy();
    // Single sample → start and end are the same → reuse
    expect(enrichment.endPlace).toBeTruthy();
    expect(resolver.reversePlace).toHaveBeenCalledTimes(1);
  });

  it('aborts when session becomes stale mid-enrichment', async () => {
    const first = makeSample(40.85, -73.97, { speedMs: 5, timestampMs: 1000 });
    const last = makeSample(40.78, -74.01, { speedMs: 10, timestampMs: 5000 });

    let currentSessionId = 'session-1';
    const resolver = {
      reversePlace: vi.fn(async () => {
        // Simulate session change during geocoding
        currentSessionId = 'session-2';
        return makePlaceResponse('Fort Lee', 'Fort Lee');
      }),
    };

    const enrichment = await enrichRouteBoundaryPlaces([first, last], resolver, {
      mode: 'speed',
      sessionId: 'session-1',
      getCurrentSessionId: () => currentSessionId,
    });

    expect(enrichment).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getReplayBoundaryInputSamples — simulated via the same logic
// (Testing the pattern that speed.js uses internally)
// ---------------------------------------------------------------------------

describe('replay boundary input sample selection', () => {
  // Replicate the getReplayBoundaryInputSamples logic for unit testing
  function getReplayBoundaryInputSamples(session) {
    if (!session) return [];
    const samples = Array.isArray(session.samples) ? session.samples : [];
    if (samples.length > 0) return samples;

    var first = session.firstSample;
    var last = session.lastSample;
    if (!first && !last) return [];

    if (!first || !isValidGeoSample(first)) return last && isValidGeoSample(last) ? [last] : [];
    if (!last || !isValidGeoSample(last)) return [first];

    if (
      first.latitude === last.latitude &&
      first.longitude === last.longitude &&
      first.timestampMs === last.timestampMs
    ) {
      return [first];
    }

    if (
      Number.isFinite(first.timestampMs) &&
      Number.isFinite(last.timestampMs) &&
      first.timestampMs > last.timestampMs
    ) {
      return [last, first];
    }
    return [first, last];
  }

  it('returns full samples when available', () => {
    const samples = [makeSample(40.85, -73.97), makeSample(40.78, -74.01)];
    const session = { samples, firstSample: samples[0], lastSample: samples[1] };
    expect(getReplayBoundaryInputSamples(session)).toBe(samples);
  });

  it('falls back to firstSample and lastSample when samples is empty', () => {
    const first = makeSample(40.85, -73.97, { timestampMs: 1000 });
    const last = makeSample(40.78, -74.01, { timestampMs: 5000 });
    const session = { samples: [], firstSample: first, lastSample: last };

    const result = getReplayBoundaryInputSamples(session);
    expect(result).toEqual([first, last]);
  });

  it('deduplicates when first and last are the same point and timestamp', () => {
    const sample = makeSample(40.85, -73.97, { timestampMs: 1000 });
    const session = { samples: [], firstSample: sample, lastSample: sample };

    const result = getReplayBoundaryInputSamples(session);
    expect(result).toEqual([sample]);
  });

  it('keeps distinct first and last with same coordinates but different timestamps', () => {
    const first = makeSample(40.85, -73.97, { timestampMs: 1000 });
    const last = makeSample(40.85, -73.97, { timestampMs: 5000 });
    const session = { samples: [], firstSample: first, lastSample: last };

    const result = getReplayBoundaryInputSamples(session);
    expect(result).toEqual([first, last]);
  });

  it('preserves chronological order when timestamps are reversed', () => {
    const first = makeSample(40.85, -73.97, { timestampMs: 5000 });
    const last = makeSample(40.78, -74.01, { timestampMs: 1000 });
    const session = { samples: [], firstSample: first, lastSample: last };

    const result = getReplayBoundaryInputSamples(session);
    expect(result).toEqual([last, first]);
  });

  it('returns only firstSample when lastSample is missing', () => {
    const first = makeSample(40.85, -73.97);
    const session = { samples: [], firstSample: first, lastSample: null };
    expect(getReplayBoundaryInputSamples(session)).toEqual([first]);
  });

  it('returns only lastSample when firstSample is invalid', () => {
    const last = makeSample(40.78, -74.01);
    const session = {
      samples: [],
      firstSample: { latitude: null, longitude: null },
      lastSample: last,
    };
    expect(getReplayBoundaryInputSamples(session)).toEqual([last]);
  });

  it('returns empty when both samples are missing', () => {
    const session = { samples: [], firstSample: null, lastSample: null };
    expect(getReplayBoundaryInputSamples(session)).toEqual([]);
  });

  it('returns empty for null session', () => {
    expect(getReplayBoundaryInputSamples(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: metadata-only session → enrichRouteBoundaryPlaces
// ---------------------------------------------------------------------------

describe('metadata-only replay session enrichment flow', () => {
  it('produces startPlace, endPlace, and boundary points from firstSample/lastSample', async () => {
    const first = makeSample(40.85, -73.97, { speedMs: 5, timestampMs: 1000 });
    const last = makeSample(40.78, -74.01, { speedMs: 10, timestampMs: 5000 });

    const session = {
      id: 'session-metadata',
      samples: [],
      firstSample: first,
      lastSample: last,
      startPlace: null,
      endPlace: null,
    };

    // Simulate the same flow speed.js uses
    function getReplayBoundaryInputSamples(s) {
      const arr = Array.isArray(s.samples) ? s.samples : [];
      if (arr.length > 0) return arr;
      const f = s.firstSample;
      const l = s.lastSample;
      if (!f && !l) return [];
      if (!f || !isValidGeoSample(f)) return l && isValidGeoSample(l) ? [l] : [];
      if (!l || !isValidGeoSample(l)) return [f];
      if (f.latitude === l.latitude && f.longitude === l.longitude && f.timestampMs === l.timestampMs) return [f];
      return [f, l];
    }

    const resolver = mockPlaceResolver([
      [40.8, makePlaceResponse('Fort Lee', 'Fort Lee')],
      [0, makePlaceResponse('West New York', 'West New York')],
    ]);

    const boundarySamples = getReplayBoundaryInputSamples(session);
    expect(boundarySamples).toHaveLength(2);

    const enrichment = await enrichRouteBoundaryPlaces(boundarySamples, resolver, {
      mode: 'speed',
    });

    expect(enrichment).not.toBeNull();
    expect(enrichment.startPlace).toMatchObject({
      label: expect.any(String),
      detail: expect.any(String),
      raw: expect.objectContaining({ city: 'Fort Lee' }),
    });
    expect(enrichment.endPlace).toMatchObject({
      label: expect.any(String),
      detail: expect.any(String),
      raw: expect.objectContaining({ city: 'West New York' }),
    });
    expect(enrichment.startBoundaryPoint).toMatchObject({
      latitude: 40.85,
      longitude: -73.97,
    });
    expect(enrichment.endBoundaryPoint).toMatchObject({
      latitude: 40.78,
      longitude: -74.01,
    });
  });

  it('handles metadata-only session with same start/end coordinates', async () => {
    const sample = makeSample(40.85, -73.97, { speedMs: 0, timestampMs: 1000 });

    const session = {
      id: 'session-loop',
      samples: [],
      firstSample: sample,
      lastSample: { ...sample, timestampMs: 5000 },
      startPlace: null,
      endPlace: null,
    };

    function getReplayBoundaryInputSamples(s) {
      const arr = Array.isArray(s.samples) ? s.samples : [];
      if (arr.length > 0) return arr;
      const f = s.firstSample;
      const l = s.lastSample;
      if (!f && !l) return [];
      if (!f || !isValidGeoSample(f)) return l && isValidGeoSample(l) ? [l] : [];
      if (!l || !isValidGeoSample(l)) return [f];
      if (f.latitude === l.latitude && f.longitude === l.longitude && f.timestampMs === l.timestampMs) return [f];
      return [f, l];
    }

    const resolver = mockPlaceResolver([
      [0, makePlaceResponse('Fort Lee', 'Fort Lee')],
    ]);

    const boundarySamples = getReplayBoundaryInputSamples(session);
    expect(boundarySamples).toHaveLength(2);

    const enrichment = await enrichRouteBoundaryPlaces(boundarySamples, resolver, {
      mode: 'speed',
    });

    expect(enrichment).not.toBeNull();
    expect(enrichment.startPlace).toBeTruthy();
    expect(enrichment.endPlace).toBeTruthy();
    // Identical coordinates → reuse start place, one geocode call
    expect(resolver.reversePlace).toHaveBeenCalledTimes(1);
  });
});
