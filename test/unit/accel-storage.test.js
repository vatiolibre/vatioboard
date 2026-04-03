import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeStoredRun } from '../../src/accel/storage.js';

describe('accel storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves normalized place metadata on stored runs', () => {
    const run = normalizeStoredRun({
      id: 'run-1',
      savedAtMs: 1000,
      elapsedMs: 5000,
      presetId: '0-60-mph',
      presetSignature: '0-60-mph',
      comparisonSignature: '0-60-mph',
      presetKind: 'speed',
      standingStart: true,
      startSpeedMs: 0,
      targetSpeedMs: 26.8,
      displayUnit: 'mph',
      distanceDisplay: 'ft',
      speedTrace: [],
      sampleLog: [],
      partials: [],
      finishSpeedMs: 26.8,
      qualityGrade: 'good',
      qualityScore: 90,
      startPlace: {
        label: 'Queens',
        countryCode: 'us',
        osmType: 'relation',
        osmId: 11,
      },
      endPlace: {
        label: 'Manhattan',
        countryCode: 'us',
        osmType: 'relation',
        osmId: 12,
      },
    });

    expect(run).toMatchObject({
      startPlace: {
        label: 'Queens',
        countryCode: 'us',
        osmLookupId: 'R11',
      },
      endPlace: {
        label: 'Manhattan',
        countryCode: 'us',
        osmLookupId: 'R12',
      },
    });
  });
});
