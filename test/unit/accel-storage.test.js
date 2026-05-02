import { beforeEach, describe, expect, it } from 'vitest';
import { buildAccelReplaySource } from '../../src/accel/replay.js';
import {
  getAccelPayloadCompleteness,
  importRun,
  normalizeStoredRun,
} from '../../src/accel/storage.js';

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
        raw: expect.objectContaining({
          countryCode: 'us',
          osmLookupId: 'R11',
        }),
      },
      endPlace: {
        label: 'Manhattan',
        raw: expect.objectContaining({
          countryCode: 'us',
          osmLookupId: 'R12',
        }),
      },
    });
  });

  it('imports accel runs when they include replayable telemetry', async () => {
    const imported = await importRun({
      id: 'run-telemetry',
      savedAtMs: 1000,
      elapsedMs: 4200,
      presetId: '0-60-mph',
      presetSignature: '0-60-mph',
      comparisonSignature: '0-60-mph',
      presetKind: 'speed',
      standingStart: true,
      startSpeedMs: 0,
      targetSpeedMs: 26.8,
      displayUnit: 'mph',
      distanceDisplay: 'ft',
      speedTrace: [
        { elapsedMs: 0, speedMs: 0, distanceM: 0 },
        { elapsedMs: 4200, speedMs: 26.8, distanceM: 120 },
      ],
      sampleLog: [],
      partials: [],
      finishSpeedMs: 26.8,
      qualityGrade: 'good',
      qualityScore: 90,
    });

    expect(getAccelPayloadCompleteness(imported)).toMatchObject({
      hasSampleLogPayload: false,
      hasSpeedTracePayload: true,
      payloadComplete: true,
      canOpen: true,
    });
    expect(buildAccelReplaySource(imported)).not.toBeNull();
  });

  it('rejects summary-only accel imports without replayable telemetry', async () => {
    await expect(importRun({
      id: 'run-summary',
      savedAtMs: 1000,
      elapsedMs: 4200,
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
      sampleCount: 24,
    })).resolves.toBeNull();

    expect(getAccelPayloadCompleteness({
      id: 'run-summary',
      savedAtMs: 1000,
      elapsedMs: 4200,
      speedTrace: [],
      sampleLog: [],
    })).toMatchObject({
      payloadComplete: false,
      canOpen: false,
    });
  });
});
