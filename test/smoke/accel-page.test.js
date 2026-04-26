import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitGeolocationSuccess, getBrowserMocks } from '../helpers/browser-mocks.js';
import { bootHtmlPage, expectPageSeo, flushTasks } from '../helpers/page-smoke.js';
import { MPH_TO_MS } from '../../src/accel/constants.js';

let createdChartCount = 0;
let destroyedChartCount = 0;
const fakeMaps = [];
const reversePlaceSpy = vi.fn(async () => ({ place: null, data: null, meta: null }));

async function settleAsyncWork(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

function createActiveSubscriberFetch() {
  return vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? '');

    if (url.includes('vatiolibre.services.tesla_connection_status')) {
      return new Response(JSON.stringify({ message: { is_guest: false } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('frappe.auth.get_logged_user')) {
      return new Response(JSON.stringify({ message: 'Administrator' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('vatiolibre.vatiolibre.feature_access.get_my_feature_access')) {
      return new Response(JSON.stringify({
        message: {
          csrf_token: 'csrf-token',
          has_active_subscription: true,
          features: {
            cloud_sync: {
              enabled: true,
              reason: '',
            },
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('vatiolibre.vatiolibre.cloud_sync.pull_my_sync_changes')) {
      return new Response(JSON.stringify({
        message: {
          records: [],
          has_more: false,
          next_cursor: '',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function getCloudSyncLoginButton() {
  return Array.from(document.querySelectorAll('.cloud-sync-indicator-action'))
    .find((button) => !button.classList.contains('cloud-sync-indicator-close'));
}

function createCloudSyncFeatureAccessResponse() {
  return new Response(JSON.stringify({
    message: {
      csrf_token: 'csrf-token',
      has_active_subscription: true,
      features: {
        cloud_sync: {
          enabled: true,
          reason: '',
        },
      },
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

vi.mock('../../src/shared/analog-speedometer.js', () => ({
  createAnalogSpeedometer: () => ({
    render: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  }),
}));

vi.mock('../../src/shared/place-resolver.js', async () => {
  const actual = await vi.importActual('../../src/shared/place-resolver.js');
  return {
    ...actual,
    createPlaceResolver: () => ({
      reversePlace: reversePlaceSpy,
      reverseCountry: vi.fn(async () => ({ place: null, data: null, meta: null, countryCode: '' })),
    }),
  };
});

vi.mock('chart.js/auto', () => ({
  default: class FakeChart {
    constructor(canvas, config) {
      createdChartCount += 1;
      this.canvas = canvas;
      this.config = config;
      this.data = config.data;
      this.options = config.options;
      this.ctx = canvas.getContext('2d');
      this.chartArea = {
        top: 0,
        left: 0,
        right: 300,
        bottom: 200,
      };
      this.tooltip = {
        getActiveElements: () => [],
        setActiveElements: vi.fn(),
      };
      this.scales = {
        x: {
          getPixelForValue: (value) => value,
        },
        y: {
          getPixelForValue: (value) => value,
        },
      };
    }

    destroy() {
      destroyedChartCount += 1;
    }
    draw() {}
    resize() {}
    update() {}
    setActiveElements() {}
    getDatasetMeta(datasetIndex) {
      const dataset = this.data.datasets[datasetIndex];
      return {
        data: (dataset?.data ?? []).map((point, index) => ({
          x: index * 10,
          y: 100,
          getProps() {
            return { x: this.x, y: this.y };
          },
          point,
        })),
      };
    }
  },
}));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor() {
      this.handlers = {};
      this.sources = new Map();
      this.scrollZoom = { disable: vi.fn(), enable: vi.fn() };
      this.boxZoom = { disable: vi.fn() };
      this.doubleClickZoom = { disable: vi.fn() };
      this.keyboard = { disable: vi.fn() };
      this.jumpTo = vi.fn();
      this.easeTo = vi.fn();
      this.fitBounds = vi.fn();
      this.stop = vi.fn();
      this.remove = vi.fn();
      fakeMaps.push(this);
      queueMicrotask(() => {
        for (const handler of this.handlers.load ?? []) {
          handler();
        }
      });
    }

    on(event, handler) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }

    addControl() {
      return this;
    }

    getSource(id) {
      if (!this.sources.has(id)) {
        this.sources.set(id, { setData: vi.fn() });
      }
      return this.sources.get(id);
    }
  }

  class FakeAttributionControl {}

  return {
    default: {
      Map: FakeMap,
      AttributionControl: FakeAttributionControl,
    },
  };
});

function createStoredRun() {
  return {
    id: 'run-1',
    savedAtMs: Date.UTC(2026, 2, 29, 10, 0, 0),
    presetId: '0-60-mph',
    presetSignature: '0-60-mph',
    comparisonSignature: 'launch-4',
    presetKind: 'speed',
    standingStart: true,
    customStart: null,
    customEnd: null,
    customUnit: null,
    startSpeedMs: 0,
    targetSpeedMs: 60 * MPH_TO_MS,
    distanceTargetM: null,
    displayUnit: 'mph',
    distanceDisplay: 'ft',
    elapsedMs: 5000,
    speedTrace: [
      {
        elapsedMs: 0,
        speedMs: 0,
        distanceM: 0,
        altitudeM: 100,
        accuracyM: 5,
        speedSource: 'reported',
      },
      {
        elapsedMs: 2500,
        speedMs: 30 * MPH_TO_MS,
        distanceM: 60,
        altitudeM: 101,
        accuracyM: 4.5,
        speedSource: 'reported',
      },
      {
        elapsedMs: 5000,
        speedMs: 60 * MPH_TO_MS,
        distanceM: 120,
        altitudeM: 102,
        accuracyM: 4,
        speedSource: 'reported',
      },
    ],
    sampleLog: [
      {
        elapsedFromStartMs: 1200,
        speedMs: 14 * MPH_TO_MS,
        distanceFromStartM: 18,
        altitudeM: 100.4,
        headingDeg: 14,
        accuracyM: 5,
        speedSource: 'reported',
        latitude: 12,
        longitude: -77,
      },
      {
        elapsedFromStartMs: 3000,
        speedMs: 38 * MPH_TO_MS,
        distanceFromStartM: 72,
        altitudeM: 101.4,
        headingDeg: 18,
        accuracyM: 4.4,
        speedSource: 'reported',
        latitude: 12.001,
        longitude: -77.001,
      },
      {
        elapsedFromStartMs: 4200,
        speedMs: 52 * MPH_TO_MS,
        distanceFromStartM: 102,
        altitudeM: 101.8,
        headingDeg: 22,
        accuracyM: 4.2,
        speedSource: 'reported',
        latitude: 12.002,
        longitude: -77.002,
      },
    ],
    partials: [
      {
        id: '0-60-mph',
        kind: 'speed',
        labelKey: 'accelPreset0to60',
        startSpeedMs: 0,
        targetSpeedMs: 60 * MPH_TO_MS,
        elapsedMs: 5000,
      },
    ],
    finishSpeedMs: 60 * MPH_TO_MS,
    trapSpeedMs: null,
    rolloutApplied: false,
    launchThresholdMs: 0.5 * MPH_TO_MS,
    rolloutDistanceM: 0,
    averageAccuracyM: 4.5,
    runDistanceM: 120,
    finishDistanceM: 120,
    startAccuracyM: 5,
    startAltitudeM: 100,
    finishAltitudeM: 102,
    elevationDeltaM: 2,
    slopePercent: (2 / 120) * 100,
    averageHz: 10,
    averageIntervalMs: 100,
    jitterMs: 12,
    qualityGrade: 'good',
    qualityScore: 90,
    warningKeys: [],
    sampleCount: 5,
    sparseCount: 0,
    staleCount: 0,
    nullSpeedCount: 0,
    derivedSpeedCount: 0,
    speedSource: 'reported',
    startSpeedSource: 'reported',
    notes: 'Flat road',
    startPlace: {
      label: 'Fort Lee',
      locality: 'Fort Lee',
      state: 'New Jersey',
      stateCode: 'NJ',
      houseNumber: '6312',
      road: 'Hilltop Court',
      countryCode: 'us',
    },
    endPlace: {
      label: 'Fort Lee',
      locality: 'Fort Lee',
      state: 'New Jersey',
      stateCode: 'NJ',
      houseNumber: '123',
      road: 'Anderson Avenue',
      countryCode: 'us',
    },
  };
}

describe('accel.html smoke', () => {
  beforeEach(async () => {
    vi.resetModules();
    createdChartCount = 0;
    destroyedChartCount = 0;
    fakeMaps.length = 0;
    reversePlaceSpy.mockReset();
    reversePlaceSpy.mockImplementation(async () => ({ place: null, data: null, meta: null }));
    await bootHtmlPage('accel.html');
  });

  it('boots the acceleration page and enables the test after a mocked fix', async () => {
    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await flushTasks();

    expectPageSeo({
      titleIncludes: 'Vatio Accel',
      canonical: 'https://vatioboard.com/accel.html',
    });
    expect(document.getElementById('armRun').getAttribute('aria-label')).toBe('Start test');
    expect(document.querySelector('#armRun .btn-icon svg')).toBeTruthy();
    expect(document.getElementById('accelToolsMenuBtn').getAttribute('aria-label')).toBe('Pages');
    expect(document.querySelector('#accelToolsMenuBtn .btn-icon svg')).toBeTruthy();
    expect(['Local only', 'Syncing']).toContain(
      document.querySelector('.cloud-sync-indicator-btn')?.textContent
    );
    document.querySelector('.cloud-sync-indicator-btn')?.click();
    await flushTasks();
    expect(document.querySelector('.cloud-sync-indicator-panel')?.hidden).toBe(false);
    document.querySelector('.cloud-sync-indicator-close')?.click();
    await flushTasks();
    expect(document.querySelector('.cloud-sync-indicator-panel')?.hidden).toBe(true);
    document.querySelector('.cloud-sync-indicator-btn')?.click();
    await flushTasks();
    document.querySelector('.cloud-sync-indicator-action')?.click();
    await settleAsyncWork();
    expect(document.querySelector('#accelToolbarSetup .btn-icon svg')).toBeTruthy();
    expect(document.querySelector('#accelToolbarResults .btn-icon svg')).toBeTruthy();
    expect(document.getElementById('closeSetupPanel').getAttribute('aria-label')).toBe('Close');
    expect(document.querySelector('#closeSetupPanel.accel-sheet-close-icon svg')).toBeTruthy();
    expect(document.getElementById('accelToolbarResults').disabled).toBe(true);
    expect(document.getElementById('accelToolsMenuList').hidden).toBe(false);
    expect(document.getElementById('accelToolsMenuBtn').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(
      document.querySelector('#accelToolsMenuList [data-backend-auth-user]')
    );
    expect(document.getElementById('accelLangToggleMenu').textContent).toBe('EN');
    expect(document.querySelector('#accelToolsMenuList [data-backend-auth]')).toBeTruthy();
    expect(
      document.querySelector('#accelToolsMenuList [data-backend-auth-signup]')?.getAttribute('href')
    ).toBe('https://www.vatiolibre.com/login#signup');
    expect(
      document.querySelector('#accelToolsMenuList [data-backend-auth-forgot]')?.getAttribute('href')
    ).toBe('https://www.vatiolibre.com/login#forgot');
    document.getElementById('accelToolsMenuBtn').click();
    await flushTasks();
    expect(document.getElementById('accelToolsMenuList').hidden).toBe(true);
    document.getElementById('accelToolbarSetup').click();
    await flushTasks();
    expect(document.getElementById('setupPanel').hidden).toBe(false);
    expect(document.getElementById('accelToolbarSetup').getAttribute('aria-pressed')).toBe('true');
    document.getElementById('closeSetupPanel').click();
    await flushTasks();
    expect(document.activeElement).toBe(document.getElementById('accelToolbarSetup'));
    document.getElementById('setupTrigger').click();
    await flushTasks();
    expect(document.getElementById('setupPanel').hidden).toBe(false);
    document.getElementById('accelToolbarSetup').click();
    await flushTasks();
    expect(document.getElementById('setupPanel').hidden).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('accelToolbarSetup'));
    expect(getBrowserMocks().geolocation.watchPosition).toHaveBeenCalledTimes(1);

    emitGeolocationSuccess({
      coords: {
        speed: 0,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await flushTasks();

    expect(document.getElementById('latestAccuracyValue').textContent).not.toBe('—');
    expect(document.getElementById('armRun').disabled).toBe(false);

    document.getElementById('armRun').click();
    await flushTasks();

    expect(document.getElementById('armRun').getAttribute('aria-label')).toBe('Cancel test');
    expect(document.getElementById('armRun').disabled).toBe(false);

    document.getElementById('armRun').click();
    await flushTasks();

    expect(document.getElementById('armRun').getAttribute('aria-label')).toBe('Start test');
  });

  it('hides the cloud sync login action for active subscribers', async () => {
    window.fetch = createActiveSubscriberFetch();

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await settleAsyncWork();

    document.querySelector('.cloud-sync-indicator-btn')?.click();
    await settleAsyncWork();

    const loginButton = getCloudSyncLoginButton();
    const subscribeLink = document.querySelector('.cloud-sync-indicator-link');

    expect(subscribeLink?.textContent).toBe('Manage subscription');
    expect(loginButton?.hidden).toBe(true);
    expect(window.getComputedStyle(loginButton).display).toBe('none');
  });

  it('keeps distinct start and end places for a completed run that finishes elsewhere', async () => {
    reversePlaceSpy
      .mockResolvedValueOnce({
        place: {
          label: 'Fort Lee',
          city: 'Fort Lee',
          locality: 'Fort Lee',
          state: 'New Jersey',
          stateCode: 'NJ',
          houseNumber: '6312',
          road: 'Hilltop Court',
          countryCode: 'us',
        },
        data: null,
        meta: null,
      })
      .mockResolvedValueOnce({
        place: {
          label: 'West New York',
          city: 'West New York',
          locality: 'West New York',
          state: 'New Jersey',
          stateCode: 'NJ',
          houseNumber: '119',
          road: '58th Street',
          countryCode: 'us',
        },
        data: null,
        meta: null,
      });

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 1000,
      coords: {
        latitude: 40.8501,
        longitude: -73.97,
        speed: 0,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await flushTasks();

    document.getElementById('armRun').click();
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 1500,
      coords: {
        latitude: 40.8501,
        longitude: -73.97,
        speed: 0.1,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 2000,
      coords: {
        latitude: 40.8502,
        longitude: -73.9701,
        speed: 1,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 3000,
      coords: {
        latitude: 40.787,
        longitude: -74.014,
        speed: 30,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await settleAsyncWork();

    const storage = await import('../../src/accel/storage.js');
    const runs = await storage.loadRuns();

    expect(reversePlaceSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        latitude: 40.8502,
        longitude: -73.9701,
        zoom: 18,
      })
    );
    expect(reversePlaceSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        latitude: 40.787,
        longitude: -74.014,
        zoom: 18,
      })
    );
    expect(runs[0]).toMatchObject({
      startPlace: {
        raw: expect.objectContaining({
          houseNumber: '6312',
          road: 'Hilltop Court',
        }),
      },
      endPlace: {
        raw: expect.objectContaining({
          houseNumber: '119',
          road: '58th Street',
        }),
      },
    });
    expect(runs[0].startPlace).not.toEqual(runs[0].endPlace);
  });

  it('reuses start place for end when boundary coordinates match', async () => {
    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 1000,
      coords: {
        latitude: 40.8501,
        longitude: -73.97,
        speed: 0,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await flushTasks();

    document.getElementById('armRun').click();
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 1500,
      coords: {
        latitude: 40.8501,
        longitude: -73.97,
        speed: 0.1,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 2000,
      coords: {
        latitude: 40.8502,
        longitude: -73.9701,
        speed: 1,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 2500,
      coords: {
        latitude: 40.818,
        longitude: -73.96,
        speed: 15,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 3000,
      coords: {
        latitude: 40.8502,
        longitude: -73.9701,
        speed: 30,
        accuracy: 5,
        altitude: 15,
        heading: 180,
      },
    });
    await settleAsyncWork();

    // With boundary selection the start coordinate is the first moving sample
    // and the end coordinate is the last moving sample. When they match,
    // only one geocoding call is needed.
    expect(reversePlaceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 40.8502,
        longitude: -73.9701,
        zoom: 18,
      })
    );
  });

  it('loads an accel result from history into the results panel', async () => {
    const storage = await import('../../src/accel/storage.js');
    await storage.saveRuns([createStoredRun()]);

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await flushTasks();

    const historyButton = document.querySelector(
      '[data-history-action="load"][data-run-id="run-1"]'
    );
    expect(historyButton).toBeTruthy();
    expect(document.querySelector('[data-history-action="replay"]')).toBeNull();
    expect(document.getElementById('historyList').textContent).toContain(
      '6312 Hilltop Ct Fort Lee NJ -> 123 Anderson Ave'
    );
    expect(document.querySelector('#historyList .accel-history-detail-text')).toBeTruthy();

    historyButton.click();
    await flushTasks();

    expect(document.getElementById('resultsPanel').hidden).toBe(false);
    expect(document.getElementById('resultReplayControls').hidden).toBe(false);
    expect(document.getElementById('resultReplayMapShell').hidden).toBe(false);
    expect(document.querySelector('.accel-history-btn[aria-pressed="true"]')).toBeTruthy();
    expect(document.querySelector('.accel-history-chip')?.textContent).toBe('Viewing');
    expect(document.getElementById('resultReplayToggle').getAttribute('aria-label')).toBe(
      'Play replay'
    );

    document.getElementById('resultReplayToggle').click();
    await settleAsyncWork(4);
    expect(document.getElementById('resultReplayToggle').getAttribute('aria-label')).toBe(
      'Pause replay'
    );
    expect(document.getElementById('resultLocationValue').textContent).toBe(
      '6312 Hilltop Ct Fort Lee NJ -> 123 Anderson Ave'
    );
    expect(
      document.querySelector('#resultLocationValue .accel-result-location-text')
    ).toBeTruthy();
    expect(Number(document.getElementById('resultReplayProgress').max)).toBeGreaterThan(0);
    expect(fakeMaps).toHaveLength(1);
    expect(fakeMaps[0].jumpTo).toHaveBeenCalledTimes(1);
    expect(fakeMaps[0].fitBounds).not.toHaveBeenCalled();

    document.getElementById('resultReplayAxisDistance').click();
    await flushTasks();
    expect(document.getElementById('resultReplayAxisDistance').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(document.getElementById('resultGraphMeta').textContent).toContain('Distance');

    const progress = document.getElementById('resultReplayProgress');
    progress.value = progress.max;
    progress.dispatchEvent(new Event('input', { bubbles: true }));
    await flushTasks();

    expect(document.getElementById('resultReplayCurrentValue').textContent).toBe(
      document.getElementById('resultReplayMaxValue').textContent
    );
    expect(fakeMaps[0].jumpTo).toHaveBeenCalledTimes(1);
    expect(fakeMaps[0].stop).toHaveBeenCalledTimes(2);

    document.getElementById('resultReplayChartsBtn').click();
    await flushTasks();

    expect(document.getElementById('resultReplayChartSheet').closest('#resultsPanel')).toBeNull();
    expect(document.getElementById('resultReplayChartSheet').hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('closeResultReplayChartSheet'));
    expect(document.getElementById('resultReplaySheetAltitudeStage').hidden).toBe(false);
    expect(document.getElementById('resultReplaySheetHeadingStage').hidden).toBe(false);
    expect(document.getElementById('resultReplaySheetSpeedValue').textContent).not.toBe('—');
    expect(document.getElementById('resultReplaySheetAltitudeValue').textContent).not.toBe('—');
    expect(document.getElementById('resultReplaySheetHeadingValue').textContent).not.toBe('—');

    const filterStartValue = document.getElementById('resultReplaySheetFilterStartValue');
    const initialFilterStartLabel = filterStartValue.textContent;
    const filterStart = document.getElementById('resultReplaySheetFilterStart');
    filterStart.value = '250';
    filterStart.dispatchEvent(new Event('input', { bubbles: true }));
    await flushTasks();
    expect(filterStartValue.textContent).not.toBe(initialFilterStartLabel);

    const speedCanvas = document.getElementById('resultReplaySheetSpeedCanvas');
    speedCanvas.getBoundingClientRect = () => ({
      left: 0,
      right: 300,
      width: 300,
      top: 0,
      bottom: 200,
      height: 200,
    });
    const initialSpeedValue = document.getElementById('resultReplaySheetSpeedValue').textContent;
    const pointerDown = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(pointerDown, 'clientX', { value: 220 });
    speedCanvas.dispatchEvent(pointerDown);
    await flushTasks();
    expect(document.getElementById('resultReplaySheetSpeedValue').textContent).not.toBe(
      initialSpeedValue
    );

    document.getElementById('closeResultReplayChartSheet').click();
    await flushTasks();
    expect(document.getElementById('resultReplayChartSheet').hidden).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('resultReplayChartsBtn'));

    const destroyedAfterSheetClose = destroyedChartCount;
    document.getElementById('resultReplayChartsBtn').click();
    await flushTasks();
    expect(createdChartCount).toBeGreaterThan(destroyedAfterSheetClose);

    document.getElementById('closeResultsPanel').click();
    await flushTasks();
    expect(destroyedChartCount).toBe(createdChartCount);
    expect(document.activeElement).toBe(document.getElementById('resultsTrigger'));
  });

  it('restores a summary-only selected run from cloud sync before opening results', async () => {
    const storage = await import('../../src/accel/storage.js');
    const fullRun = createStoredRun();
    const summaryRun = {
      ...fullRun,
      speedTrace: [],
      sampleLog: [],
    };
    await storage.saveRuns([summaryRun]);
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'accel_run:run-1': {
          name: 'sync-restore-run-1',
          entity_type: 'accel_run',
          client_record_id: 'run-1',
          device_id: 'device-b',
          record_title: '0-60-mph',
          content_hash: 'hash-run-1',
          client_updated_at_ms: String(fullRun.savedAtMs),
          deleted_at_ms: '',
          server_version: 1,
          payload_size: 256,
          modified: '2026-04-05 02:30:00.000000',
        },
      },
    }));

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      if (url.includes('vatiolibre.vatiolibre.feature_access.get_my_feature_access')) {
        return createCloudSyncFeatureAccessResponse();
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload')) {
        return new Response(JSON.stringify({
          message: {
            payload: fullRun,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.pull_my_sync_records')) {
        return new Response(JSON.stringify({
          message: {
            records: [],
            has_more: false,
            next_cursor: '',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await settleAsyncWork();

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload'),
      expect.any(Object)
    );
    document.getElementById('accelToolbarResults').click();
    await flushTasks();

    expect(document.getElementById('resultReplayControls').hidden).toBe(false);
    expect(document.getElementById('resultReplayMapShell').hidden).toBe(false);
    expect(fakeMaps).toHaveLength(1);
  });

  it('retries accel telemetry recovery after cloud sync metadata arrives later', async () => {
    const storage = await import('../../src/accel/storage.js');
    const fullRun = createStoredRun();
    const summaryRun = {
      ...fullRun,
      speedTrace: [],
      sampleLog: [],
    };
    await storage.saveRuns([summaryRun]);

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      if (url.includes('vatiolibre.vatiolibre.feature_access.get_my_feature_access')) {
        return createCloudSyncFeatureAccessResponse();
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload')) {
        return new Response(JSON.stringify({
          message: {
            payload: fullRun,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.pull_my_sync_records')) {
        return new Response(JSON.stringify({
          message: {
            records: [],
            has_more: false,
            next_cursor: '',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await settleAsyncWork();

    expect(window.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload'),
      expect.any(Object)
    );

    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'accel_run:run-1': {
          name: 'sync-restore-run-1-late',
          entity_type: 'accel_run',
          client_record_id: 'run-1',
          device_id: 'device-b',
          record_title: '0-60-mph',
          content_hash: 'hash-run-1-late',
          client_updated_at_ms: String(fullRun.savedAtMs),
          deleted_at_ms: '',
          server_version: 1,
          payload_size: 256,
          modified: '2026-04-05 02:45:00.000000',
        },
      },
    }));
    window.dispatchEvent(new CustomEvent('vatioboard:cloud-sync-applied', {
      detail: {
        entityType: 'accel_run',
        recordId: 'run-1',
      },
    }));
    await settleAsyncWork();

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload'),
      expect.any(Object)
    );
  });

  it('keeps accel boot non-blocking while a background restore is still downloading', async () => {
    const storage = await import('../../src/accel/storage.js');
    const fullRun = createStoredRun();
    const summaryRun = {
      ...fullRun,
      speedTrace: [],
      sampleLog: [],
    };
    await storage.saveRuns([summaryRun]);
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'accel_run:run-1': {
          name: 'sync-restore-run-1-slow',
          entity_type: 'accel_run',
          client_record_id: 'run-1',
          device_id: 'device-b',
          record_title: '0-60-mph',
          content_hash: 'hash-run-1-slow',
          client_updated_at_ms: String(fullRun.savedAtMs),
          deleted_at_ms: '',
          server_version: 1,
          payload_size: 256,
          modified: '2026-04-05 03:10:00.000000',
        },
      },
    }));

    var resolveDownload;
    var downloadPending = new Promise(function (resolve) {
      resolveDownload = resolve;
    });
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      if (url.includes('vatiolibre.vatiolibre.feature_access.get_my_feature_access')) {
        return createCloudSyncFeatureAccessResponse();
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload')) {
        return downloadPending;
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.pull_my_sync_records')) {
        return new Response(JSON.stringify({
          message: {
            records: [],
            has_more: false,
            next_cursor: '',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const accelPage = await import('../../src/accel/accel.js');
    var initResolved = false;
    accelPage.initPromise.then(function () {
      initResolved = true;
    });
    await settleAsyncWork();

    expect(initResolved).toBe(true);
    expect(document.getElementById('accelToolbarResults').disabled).toBe(false);

    resolveDownload(new Response(JSON.stringify({
      message: {
        payload: fullRun,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await settleAsyncWork();
  });

  it('does not let a stale accel restore snap selection back to an older run', async () => {
    const storage = await import('../../src/accel/storage.js');
    const restoredRun = createStoredRun();
    const summaryRun = {
      ...restoredRun,
      speedTrace: [],
      sampleLog: [],
    };
    const latestRun = {
      ...createStoredRun(),
      id: 'run-2',
      savedAtMs: Date.UTC(2026, 2, 29, 11, 0, 0),
      notes: 'Second run',
      startPlace: { label: 'Hoboken' },
      endPlace: { label: 'Jersey City' },
    };
    await storage.saveRuns([latestRun, summaryRun]);
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'accel_run:run-1': {
          name: 'sync-restore-run-1-race',
          entity_type: 'accel_run',
          client_record_id: 'run-1',
          device_id: 'device-b',
          record_title: '0-60-mph',
          content_hash: 'hash-run-1-race',
          client_updated_at_ms: String(restoredRun.savedAtMs),
          deleted_at_ms: '',
          server_version: 1,
          payload_size: 256,
          modified: '2026-04-05 03:15:00.000000',
        },
      },
    }));

    var resolveDownload;
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      if (url.includes('vatiolibre.vatiolibre.feature_access.get_my_feature_access')) {
        return createCloudSyncFeatureAccessResponse();
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload')) {
        return new Promise(function (resolve) {
          resolveDownload = resolve;
        });
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.pull_my_sync_records')) {
        return new Response(JSON.stringify({
          message: {
            records: [],
            has_more: false,
            next_cursor: '',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await settleAsyncWork();

    (
      document.querySelector('[data-history-action="replay"][data-run-id="run-1"]')
      || document.querySelector('[data-history-action="load"][data-run-id="run-1"]')
    ).click();
    await flushTasks();
    document.querySelector('[data-history-action="load"][data-run-id="run-2"]').click();
    await flushTasks();

    if (resolveDownload) {
      resolveDownload(new Response(JSON.stringify({
        message: {
          payload: restoredRun,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      await settleAsyncWork();
    }

    expect(
      document.querySelector('.accel-history-btn[aria-pressed="true"]')?.getAttribute('data-run-id')
    ).toBe('run-2');
    expect(document.getElementById('resultNotesValue').textContent).toBe('Second run');
  });

  it('falls back to an available local run when a requested remote run never materializes', async () => {
    const storage = await import('../../src/accel/storage.js');
    const localRun = createStoredRun();
    await storage.saveRuns([localRun]);
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {},
    }));
    window.history.replaceState({}, '', 'https://vatioboard.com/accel.html?run=missing-run');

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.pull_my_sync_records')) {
        return new Response(JSON.stringify({
          message: {
            records: [],
            has_more: false,
            next_cursor: '',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await settleAsyncWork();

    expect(
      document.querySelector('.accel-history-btn[aria-pressed="true"]')?.getAttribute('data-run-id')
    ).toBe('run-1');
    expect(document.getElementById('accelToolbarResults').disabled).toBe(false);
  });

  it('keeps a newly synced accel run selected while recovering from a missing deep link', async () => {
    const storage = await import('../../src/accel/storage.js');
    const localRun = {
      ...createStoredRun(),
      id: 'run-local',
      savedAtMs: Date.UTC(2026, 2, 29, 13, 0, 0),
      notes: 'Local latest run',
    };
    const remoteRun = {
      ...createStoredRun(),
      id: 'run-remote-sync',
      savedAtMs: Date.UTC(2026, 2, 29, 12, 0, 0),
      notes: 'Remote synced run',
      startPlace: { label: 'Hoboken' },
      endPlace: { label: 'Jersey City' },
    };
    await storage.saveRuns([localRun]);
    window.history.replaceState({}, '', 'https://vatioboard.com/accel.html?run=missing-run');

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await settleAsyncWork();

    await storage.saveRuns([localRun, remoteRun]);
    window.dispatchEvent(new CustomEvent('vatioboard:cloud-sync-applied', {
      detail: {
        entityType: 'accel_run',
        recordId: 'run-remote-sync',
      },
    }));
    await settleAsyncWork();

    expect(
      document.querySelector('.accel-history-btn[aria-pressed="true"]')?.getAttribute('data-run-id')
    ).toBe('run-remote-sync');
    expect(document.getElementById('resultNotesValue').textContent).toBe('Remote synced run');
  });

  it('falls back to an available run after cloud sync deletes the selected run', async () => {
    const storage = await import('../../src/accel/storage.js');
    const selectedRun = createStoredRun();
    const fallbackRun = {
      ...createStoredRun(),
      id: 'run-2',
      savedAtMs: Date.UTC(2026, 2, 29, 11, 0, 0),
      notes: 'Second run',
    };
    await storage.saveRuns([fallbackRun, selectedRun]);

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.pull_my_sync_records')) {
        return new Response(JSON.stringify({
          message: {
            records: [],
            has_more: false,
            next_cursor: '',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await settleAsyncWork();

    document.querySelector('[data-history-action="load"][data-run-id="run-1"]').click();
    await settleAsyncWork();
    await storage.saveRuns([fallbackRun]);

    window.dispatchEvent(new CustomEvent('vatioboard:cloud-sync-applied', {
      detail: {
        entityType: 'accel_run',
        recordId: 'run-1',
        deleted: true,
      },
    }));
    await settleAsyncWork();

    expect(
      document.querySelector('.accel-history-btn[aria-pressed="true"]')?.getAttribute('data-run-id')
    ).toBe('run-2');
    expect(document.getElementById('resultNotesValue').textContent).toBe('Second run');
  });

  it('restores a requested remote accel run instead of sticking to a local fallback run', async () => {
    const storage = await import('../../src/accel/storage.js');
    const localRun = createStoredRun();
    const remoteRun = {
      ...createStoredRun(),
      id: 'run-remote',
      savedAtMs: Date.UTC(2026, 2, 29, 12, 0, 0),
      notes: 'Remote run',
      startPlace: { label: 'Hoboken' },
      endPlace: { label: 'Jersey City' },
    };
    await storage.saveRuns([localRun]);
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'accel_run:run-remote': {
          name: 'sync-run-remote',
          entity_type: 'accel_run',
          client_record_id: 'run-remote',
          device_id: 'device-remote',
          record_title: '0-60-mph',
          content_hash: 'hash-run-remote',
          client_updated_at_ms: String(remoteRun.savedAtMs),
          deleted_at_ms: '',
          server_version: 1,
          payload_size: 256,
          modified: '2026-04-05 04:15:00.000000',
        },
      },
    }));
    window.history.replaceState({}, '', 'https://vatioboard.com/accel.html?run=run-remote');

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      if (url.includes('vatiolibre.vatiolibre.feature_access.get_my_feature_access')) {
        return createCloudSyncFeatureAccessResponse();
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload')) {
        return new Response(JSON.stringify({
          message: {
            payload: remoteRun,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.pull_my_sync_records')) {
        return new Response(JSON.stringify({
          message: {
            records: [],
            has_more: false,
            next_cursor: '',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await settleAsyncWork();

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload'),
      expect.any(Object)
    );
    expect(
      document.querySelector('.accel-history-btn[aria-pressed="true"]')?.getAttribute('data-run-id')
    ).toBe('run-remote');
    expect(document.getElementById('resultNotesValue').textContent).toBe('Remote run');
  });

  it('opens the results panel from the toolbar results button when runs exist', async () => {
    const storage = await import('../../src/accel/storage.js');
    await storage.saveRuns([createStoredRun()]);

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await flushTasks();

    expect(document.getElementById('accelToolbarResults').disabled).toBe(false);
    document.getElementById('accelToolbarResults').click();
    await flushTasks();

    expect(document.getElementById('resultsPanel').hidden).toBe(false);
    expect(document.getElementById('resultReplayMapShell').hidden).toBe(false);
    expect(fakeMaps).toHaveLength(1);
    expect(fakeMaps[0].jumpTo).toHaveBeenCalledTimes(1);
    expect(fakeMaps[0].fitBounds).not.toHaveBeenCalled();
    document.getElementById('closeResultsPanel').click();
    await flushTasks();
    expect(document.activeElement).toBe(document.getElementById('accelToolbarResults'));
  });

  it('tears down results replay state when switching from results to setup', async () => {
    const storage = await import('../../src/accel/storage.js');
    await storage.saveRuns([createStoredRun()]);

    const accelPage = await import('../../src/accel/accel.js');
    await accelPage.initPromise;
    await flushTasks();

    document.getElementById('accelToolbarResults').click();
    await flushTasks();
    document.getElementById('resultReplayChartsBtn').click();
    await flushTasks();

    expect(document.getElementById('resultsPanel').hidden).toBe(false);
    expect(document.getElementById('resultReplayChartSheet').hidden).toBe(false);
    expect(fakeMaps).toHaveLength(1);

    document.getElementById('accelToolbarSetup').click();
    await flushTasks();

    expect(document.getElementById('resultsPanel').hidden).toBe(true);
    expect(document.getElementById('setupPanel').hidden).toBe(false);
    expect(document.getElementById('resultReplayChartSheet').hidden).toBe(true);
    expect(fakeMaps[0].remove).toHaveBeenCalledTimes(1);
  });

  it("keeps the Player launcher available for guests and after login", async () => {
    await import("../../src/accel/accel.js");
    await settleAsyncWork();

    const btn = document.querySelector("#accelToolsMenuList [data-player-toggle]");
    expect(btn).toBeTruthy();
    expect(btn.hidden).toBe(false);
    expect(btn.className).toBe("btn-with-icon");
    expect(btn.querySelector(".btn-icon[aria-hidden='true'] svg")).toBeTruthy();
    expect(btn.querySelector("[data-i18n='audioPlayer']")).toBeTruthy();
    const fab = document.querySelector(".player-fab");
    expect(fab).toBeTruthy();
    expect(fab.hidden).toBe(false);

    // Log in → launcher stays available.
    const authForm = document.querySelector("#accelToolsMenuList [data-backend-auth]");
    const authUser = authForm.querySelector("[data-backend-auth-user]");
    const authPassword = authForm.querySelector("[data-backend-auth-password]");
    authUser.value = "test@vatiolibre.com";
    authPassword.value = "secret123";
    authForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settleAsyncWork();

    expect(btn.hidden).toBe(false);
    expect(fab.hidden).toBe(false);
  });
});
