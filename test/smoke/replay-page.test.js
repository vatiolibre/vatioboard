import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootHtmlPage, expectPageSeo, flushTasks } from '../helpers/page-smoke.js';

const fakeMaps = [];
const originalIndexedDb = globalThis.indexedDB;

async function settleAsyncWork(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

async function waitForRecordingButton(recordingId, iterations = 60) {
  for (let index = 0; index < iterations; index += 1) {
    const button = document.querySelector(`button[data-recording-id="${recordingId}"]`);
    if (button) return button;
    await flushTasks();
  }

  return null;
}

vi.mock('chart.js/auto', () => ({
  default: class FakeChart {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.ctx = canvas.getContext('2d');
      this.chartArea = {
        top: 0,
        left: 0,
        right: 300,
        bottom: 220,
      };
      this.scales = {
        x: {
          getPixelForValue: (value) => value,
          getValueForPixel: (value) => value,
          min: config?.options?.scales?.x?.min ?? 0,
          max: config?.options?.scales?.x?.max ?? 300,
        },
      };
    }

    destroy() {}
    draw() {}
    update() {}
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
      this.resize = vi.fn();
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

describe('replay.html smoke', () => {
  beforeEach(async () => {
    fakeMaps.length = 0;
    localStorage.clear();
    localStorage.setItem(
      'vatio_speed_replay_active_v1',
      JSON.stringify({
        id: 'active-session',
        version: 1,
        source: 'speed',
        unit: 'kmh',
        distanceUnit: 'm',
        startedAtMs: 1000,
        updatedAtMs: 4000,
        endedAtMs: 4000,
        maxSpeedMs: 15,
        totalDistanceM: 680,
        minAltitudeM: 10,
        maxAltitudeM: 20,
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
        samples: [
          {
            timestampMs: 1000,
            latitude: 40.7128,
            longitude: -74.006,
            speedMs: 0,
            altitudeM: 10,
            accuracyM: 5,
            headingDeg: 180,
            totalDistanceM: 500,
          },
          {
            timestampMs: 2500,
            latitude: 40.7138,
            longitude: -74.005,
            speedMs: 10,
            altitudeM: 15,
            accuracyM: 4,
            headingDeg: 182,
            totalDistanceM: 580,
          },
          {
            timestampMs: 4000,
            latitude: 40.7148,
            longitude: -74.004,
            speedMs: 15,
            altitudeM: 20,
            accuracyM: 4,
            headingDeg: 184,
            totalDistanceM: 680,
          },
        ],
      })
    );
    localStorage.setItem(
      'vatio_speed_replay_library_v1',
      JSON.stringify([
        {
          id: 'saved-session',
          version: 1,
          source: 'speed',
          unit: 'kmh',
          distanceUnit: 'm',
          startedAtMs: 5000,
          updatedAtMs: 7000,
          endedAtMs: 7000,
          maxSpeedMs: 11,
          totalDistanceM: 520,
          minAltitudeM: 8,
          maxAltitudeM: 18,
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
            label: 'West New York',
            locality: 'West New York',
            state: 'New Jersey',
            stateCode: 'NJ',
            houseNumber: '119',
            road: '58th Street',
            countryCode: 'us',
          },
          recordingState: 'stopped',
          samples: [
            {
              timestampMs: 5000,
              latitude: 40.72,
              longitude: -74.01,
              speedMs: 0,
              altitudeM: 8,
              accuracyM: 5,
              headingDeg: 160,
              totalDistanceM: 400,
            },
            {
              timestampMs: 7000,
              latitude: 40.721,
              longitude: -74.009,
              speedMs: 11,
              altitudeM: 18,
              accuracyM: 5,
              headingDeg: 170,
              totalDistanceM: 520,
            },
          ],
        },
      ])
    );
    window.confirm = vi.fn(() => true);

    vi.resetModules();
    await bootHtmlPage('replay.html');
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: originalIndexedDb,
    });
  });

  it('boots the replay page and renders the stored session', async () => {
    const replayPage = await import('../../src/replay/replay.js');
    expect(document.getElementById('replayEmptyState').hidden).toBe(true);
    expect(document.getElementById('replayShell').hidden).toBe(true);
    await replayPage.initPromise;
    await flushTasks();

    expectPageSeo({
      titleIncludes: 'Vatio Drive Replay',
      canonical: 'https://vatioboard.com/replay.html',
    });
    expect(document.getElementById('replayEmptyState').hidden).toBe(true);
    expect(document.getElementById('replayShell').hidden).toBe(false);
    expect(document.getElementById('replaySessionChip').textContent).toBe('Active session');
    expect(document.getElementById('replaySampleCountValue').textContent).toBe('3');
    expect(document.getElementById('replayPeakSpeedValue').textContent).toContain('54 km/h');
    expect(document.getElementById('replayRouteValue').textContent).toBe(
      '6312 Hilltop Ct Fort Lee NJ -> 123 Anderson Ave'
    );
    expect(['Local only', 'Syncing']).toContain(
      document.querySelector('.cloud-sync-indicator-btn')?.textContent
    );
    expect(document.querySelector('#replayAxisTime .btn-icon svg')).toBeTruthy();
    expect(document.querySelector('#replayAxisDistance .btn-icon svg')).toBeTruthy();
    expect(document.getElementById('replayToolsMenuBtn').getAttribute('aria-label')).toBe('Pages');
    expect(document.querySelector('#replayToolsMenuBtn .btn-icon svg')).toBeTruthy();
    document.getElementById('replayToolsMenuBtn').click();
    await flushTasks();
    expect(document.getElementById('replayToolsMenuList').hidden).toBe(false);
    expect(document.getElementById('replayLangToggleMenu').textContent).toBe('EN');
    expect(document.querySelector('#replayToolsMenuList [data-backend-auth]')).toBeTruthy();
    expect(
      document
        .querySelector('#replayToolsMenuList [data-backend-auth-signup]')
        ?.getAttribute('href')
    ).toBe('https://www.vatiolibre.com/login#signup');
    expect(
      document
        .querySelector('#replayToolsMenuList [data-backend-auth-forgot]')
        ?.getAttribute('href')
    ).toBe('https://www.vatiolibre.com/login#forgot');
    expect(document.querySelector('#replayPlayPause .replay-action-icon svg')).toBeTruthy();
    expect(document.getElementById('replayPlayPause').getAttribute('aria-label')).toBe('Play');
    expect(document.querySelector('#replayRestart .replay-action-icon svg')).toBeTruthy();
    expect(document.querySelector('#replayApproach .replay-action-icon svg')).toBeTruthy();
    expect(document.getElementById('replayRestart').disabled).toBe(false);
    expect(document.getElementById('replayApproach').disabled).toBe(false);
    expect(
      document.querySelectorAll('#replayRecordingsList button[data-recording-id]')
    ).toHaveLength(2);
    expect(
      document.querySelectorAll('#replayRecordingsList .replay-recording-detail-text')
    ).toHaveLength(2);
    expect(
      document.querySelectorAll('#replayRecordingsList button[data-delete-recording-id]')
    ).toHaveLength(1);
    expect(document.getElementById('replayRecordingsList').textContent).toContain(
      '6312 Hilltop Ct Fort Lee NJ -> 119 58th St West New York NJ'
    );
    expect(document.getElementById('replayGraphHeadingCurrent').textContent).toContain('180');
    expect(document.querySelector('.replay-live-grid')).toBeNull();
    expect(document.querySelector('.replay-map-head')).toBeNull();
    expect(document.getElementById('replayMap').hasAttribute('aria-hidden')).toBe(false);
    expect(document.getElementById('replayAxisTime').getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('replayProgress').max).toBe('3000');
    expect(document.querySelectorAll('.replay-rate-btn')).toHaveLength(5);
    expect(fakeMaps[0]?.fitBounds).not.toHaveBeenCalled();
    expect(fakeMaps[0]?.jumpTo).toHaveBeenCalledTimes(1);
    expect(fakeMaps[0]?.resize).toHaveBeenCalledTimes(1);

    document.getElementById('replayApproach').click();
    await flushTasks();

    expect(fakeMaps[0]?.jumpTo).toHaveBeenCalledTimes(1);

    document.getElementById('replayAxisDistance').click();
    await flushTasks();

    expect(document.getElementById('replayAxisDistance').getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('replayDurationValue').textContent).toBe('180 m');
    expect(document.getElementById('replayProgress').max).toBe('180');

    document.querySelector('.replay-rate-btn[data-rate="1000"]').click();
    await flushTasks();

    expect(
      document.querySelector('.replay-rate-btn[data-rate="1000"]')?.getAttribute('aria-pressed')
    ).toBe('true');

    document.getElementById('replayProgress').value = '80';
    document.getElementById('replayProgress').dispatchEvent(new Event('input', { bubbles: true }));
    await flushTasks();

    expect(document.getElementById('replayElapsedValue').textContent).toBe('80 m');
    expect(fakeMaps[0]?.stop).toHaveBeenCalledTimes(2);

    document.getElementById('replayRestart').click();
    await flushTasks();

    expect(document.getElementById('replayElapsedValue').textContent).toBe('0 m');

    fakeMaps[0]?.stop.mockClear();
    fakeMaps[0]?.jumpTo.mockClear();

    document.getElementById('replayApproach').click();
    await flushTasks();

    expect(fakeMaps[0]?.stop).toHaveBeenCalledTimes(1);
    expect(fakeMaps[0]?.jumpTo).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first local session when a requested replay is missing in degraded storage', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: {
        open: vi.fn(() => {
          const request = {
            error: new Error('IndexedDB blocked'),
            onblocked: null,
            onerror: null,
            onsuccess: null,
            onupgradeneeded: null,
            result: null,
          };
          queueMicrotask(() => {
            request.onblocked?.({ target: request });
          });
          return request;
        }),
      },
    });
    window.history.replaceState({}, '', '/replay.html?record=missing-replay');

    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await settleAsyncWork();

    expect(document.getElementById('replayShell').hidden).toBe(false);
    expect(document.getElementById('replaySessionChip').textContent).toBe('Active session');
    expect(document.getElementById('replaySampleCountValue').textContent).toBe('3');
  });

  it('opens the expanded graph sheet with stacked charts and a dual-range filter', async () => {
    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await flushTasks();

    document.querySelector('[data-graph-metric="headingDeg"]').click();
    await flushTasks();

    expect(document.getElementById('replayGraphSheet').hidden).toBe(false);
    expect(document.getElementById('replayGraphSheetTitle').textContent).toBe('Explore charts');
    expect(document.getElementById('replayExpandedSpeedCurrent').textContent).toContain('0');
    expect(document.getElementById('replayExpandedAltitudeCurrent').textContent).toContain('10');
    expect(document.getElementById('replayExpandedHeadingCurrent').textContent).toContain('180');
    expect(
      document.querySelector('.replay-graph-sheet-header .replay-sheet-axis-group')
    ).toBeTruthy();
    expect(
      document.querySelector('.replay-graph-sheet-controls .replay-sheet-axis-group')
    ).toBeNull();
    expect(
      document.querySelector('.replay-sheet-axis-group .replay-sheet-axis-label')?.textContent
    ).toBe('Time');
    expect(
      document.querySelectorAll('.replay-sheet-axis-group .replay-sheet-axis-label')
    ).toHaveLength(2);
    expect(document.querySelector('.replay-filter-row')).toBeTruthy();
    expect(document.querySelector('.replay-filter-row #replayFilterSlider')).toBeTruthy();
    expect(document.getElementById('replayFilterStart')).toBeTruthy();
    expect(document.getElementById('replayFilterEnd')).toBeTruthy();

    document.getElementById('replayFilterStart').value = '250';
    document
      .getElementById('replayFilterStart')
      .dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('replayFilterEnd').value = '750';
    document.getElementById('replayFilterEnd').dispatchEvent(new Event('input', { bubbles: true }));
    await flushTasks();

    expect(document.getElementById('replayFilterStartValue').textContent).toBe('00:01');
    expect(document.getElementById('replayFilterEndValue').textContent).toBe('00:02');

    document.getElementById('closeReplayGraphSheet').click();
    await flushTasks();

    expect(document.getElementById('replayGraphSheet').hidden).toBe(true);
  });

  it('cancels the intro when the user switches recordings mid-approach', async () => {
    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await flushTasks();

    expect(fakeMaps[0]?.stop).toHaveBeenCalledTimes(1);

    document.querySelector('button[data-recording-id="saved-session"]').click();
    await replayPage.waitForReplaySelection();
    await flushTasks();

    expect(fakeMaps[0]?.stop).toHaveBeenCalledTimes(2);
    expect(document.getElementById('replaySessionChip').textContent).toBe('Saved session');
  });

  it('lets the user delete saved recordings while keeping the active session', async () => {
    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    const { loadReplayLibrary } = await import('../../src/replay/session.js');
    await flushTasks();

    document
      .querySelector('#replayRecordingsList button[data-delete-recording-id="saved-session"]')
      .click();
    await replayPage.waitForReplaySelection();
    await loadReplayLibrary();
    await flushTasks();

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(
      document.querySelectorAll('#replayRecordingsList button[data-recording-id]')
    ).toHaveLength(1);
    expect(
      document.querySelector(
        '#replayRecordingsList button[data-delete-recording-id="saved-session"]'
      )
    ).toBeNull();
    expect(await loadReplayLibrary()).toEqual([]);
  });

  it('boots cleanly into the empty state when there are no replay recordings', async () => {
    localStorage.clear();
    vi.resetModules();
    await bootHtmlPage('replay.html');

    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await flushTasks();

    expect(document.getElementById('replayEmptyState').hidden).toBe(false);
    expect(document.getElementById('replayShell').hidden).toBe(true);
  });

  it('keeps replay boot non-blocking while a background restore is still downloading', async () => {
    localStorage.clear();
    const summarySession = {
      id: 'saved-session',
      version: 1,
      source: 'speed',
      unit: 'kmh',
      distanceUnit: 'm',
      startedAtMs: 5000,
      updatedAtMs: 7000,
      endedAtMs: 7000,
      maxSpeedMs: 11,
      totalDistanceM: 520,
      minAltitudeM: 8,
      maxAltitudeM: 18,
      sampleCount: 2,
      startPlace: { label: 'Fort Lee' },
      endPlace: { label: 'West New York' },
      recordingState: 'stopped',
      samples: [],
    };
    localStorage.setItem('vatio_speed_replay_library_v1', JSON.stringify([summarySession]));
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'replay_session:saved-session': {
          name: 'sync-saved-session-slow',
          entity_type: 'replay_session',
          client_record_id: 'saved-session',
          device_id: 'device-b',
          record_title: 'saved-session',
          content_hash: 'hash-saved-session-slow',
          client_updated_at_ms: String(summarySession.updatedAtMs),
          deleted_at_ms: '',
          server_version: 1,
          payload_size: 256,
          modified: '2026-04-05 03:30:00.000000',
        },
      },
    }));

    let resolveDownload;
    const downloadPending = new Promise((resolve) => {
      resolveDownload = resolve;
    });
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

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

    vi.resetModules();
    await bootHtmlPage('replay.html');

    const replayPage = await import('../../src/replay/replay.js');
    let initResolved = false;
    replayPage.initPromise.then(() => {
      initResolved = true;
    });
    await settleAsyncWork();

    expect(initResolved).toBe(true);
    expect(document.getElementById('replayShell').hidden).toBe(false);

    resolveDownload(new Response(JSON.stringify({
      message: {
        payload: {
          ...summarySession,
          samples: [
            {
              timestampMs: 5000,
              latitude: 40.72,
              longitude: -74.01,
              speedMs: 0,
              altitudeM: 8,
              accuracyM: 5,
              headingDeg: 160,
              totalDistanceM: 400,
            },
            {
              timestampMs: 7000,
              latitude: 40.721,
              longitude: -74.009,
              speedMs: 11,
              altitudeM: 18,
              accuracyM: 5,
              headingDeg: 170,
              totalDistanceM: 520,
            },
          ],
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await settleAsyncWork();
  });

  it('does not let a stale replay restore snap selection back to an older recording', async () => {
    localStorage.clear();
    const activeSession = {
      id: 'active-session',
      version: 1,
      source: 'speed',
      unit: 'kmh',
      distanceUnit: 'm',
      startedAtMs: 1000,
      updatedAtMs: 4000,
      endedAtMs: 4000,
      maxSpeedMs: 15,
      totalDistanceM: 680,
      minAltitudeM: 10,
      maxAltitudeM: 20,
      startPlace: { label: 'Fort Lee' },
      endPlace: { label: 'Anderson Ave' },
      samples: [
        {
          timestampMs: 1000,
          latitude: 40.7128,
          longitude: -74.006,
          speedMs: 0,
          altitudeM: 10,
          accuracyM: 5,
          headingDeg: 180,
          totalDistanceM: 500,
        },
        {
          timestampMs: 4000,
          latitude: 40.7148,
          longitude: -74.004,
          speedMs: 15,
          altitudeM: 20,
          accuracyM: 4,
          headingDeg: 184,
          totalDistanceM: 680,
        },
      ],
    };
    const summarySession = {
      id: 'saved-session',
      version: 1,
      source: 'speed',
      unit: 'kmh',
      distanceUnit: 'm',
      startedAtMs: 5000,
      updatedAtMs: 7000,
      endedAtMs: 7000,
      maxSpeedMs: 11,
      totalDistanceM: 520,
      minAltitudeM: 8,
      maxAltitudeM: 18,
      sampleCount: 2,
      startPlace: { label: 'Fort Lee' },
      endPlace: { label: 'West New York' },
      recordingState: 'stopped',
      samples: [],
    };
    localStorage.setItem('vatio_speed_replay_active_v1', JSON.stringify(activeSession));
    localStorage.setItem('vatio_speed_replay_library_v1', JSON.stringify([summarySession]));
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'replay_session:saved-session': {
          name: 'sync-saved-session-race',
          entity_type: 'replay_session',
          client_record_id: 'saved-session',
          device_id: 'device-b',
          record_title: 'saved-session',
          content_hash: 'hash-saved-session-race',
          client_updated_at_ms: String(summarySession.updatedAtMs),
          deleted_at_ms: '',
          server_version: 1,
          payload_size: 256,
          modified: '2026-04-05 03:35:00.000000',
        },
      },
    }));

    let resolveDownload;
    const delayedDownload = new Promise((resolve) => {
      resolveDownload = resolve;
    });
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload')) {
        return delayedDownload;
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

    vi.resetModules();
    await bootHtmlPage('replay.html');

    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await settleAsyncWork();

    document.querySelector('button[data-recording-id="saved-session"]').click();
    await replayPage.waitForReplaySelection();
    document.querySelector('button[data-recording-id="active-session"]').click();
    await replayPage.waitForReplaySelection();

    resolveDownload(new Response(JSON.stringify({
      message: {
        payload: {
          ...summarySession,
          samples: [
            {
              timestampMs: 5000,
              latitude: 40.72,
              longitude: -74.01,
              speedMs: 0,
              altitudeM: 8,
              accuracyM: 5,
              headingDeg: 160,
              totalDistanceM: 400,
            },
            {
              timestampMs: 7000,
              latitude: 40.721,
              longitude: -74.009,
              speedMs: 11,
              altitudeM: 18,
              accuracyM: 5,
              headingDeg: 170,
              totalDistanceM: 520,
            },
          ],
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await settleAsyncWork();

    expect(document.getElementById('replaySessionChip').textContent).toBe('Active session');
  });

  it('falls back to an available local replay when a requested remote recording never materializes', async () => {
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {},
    }));
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

    vi.resetModules();
    await bootHtmlPage('replay.html');
    window.history.replaceState({}, '', 'https://vatioboard.com/replay.html?record=missing-session');

    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await settleAsyncWork();

    expect(
      document.querySelector('button[data-recording-id="active-session"]')?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(document.getElementById('replaySessionChip').textContent).toBe('Active session');
  });

  it('falls back to an available replay after cloud sync deletes the selected recording', async () => {
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

    vi.resetModules();
    await bootHtmlPage('replay.html');

    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await settleAsyncWork();

    document.querySelector('button[data-recording-id="saved-session"]').click();
    await replayPage.waitForReplaySelection();
    localStorage.setItem('vatio_speed_replay_library_v1', JSON.stringify([]));

    window.dispatchEvent(new CustomEvent('vatioboard:cloud-sync-applied', {
      detail: {
        entityType: 'replay_session',
        recordId: 'saved-session',
        deleted: true,
      },
    }));
    await settleAsyncWork();

    expect(
      document.querySelector('button[data-recording-id="active-session"]')?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(document.getElementById('replaySessionChip').textContent).toBe('Active session');
  });

  it('selects a newly synced replay when the page is currently empty', async () => {
    localStorage.clear();
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

    vi.resetModules();
    await bootHtmlPage('replay.html');

    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await settleAsyncWork();

    expect(document.getElementById('replayShell').hidden).toBe(true);

    localStorage.setItem('vatio_speed_replay_library_v1', JSON.stringify([
      {
        id: 'synced-session',
        version: 1,
        source: 'speed',
        unit: 'kmh',
        distanceUnit: 'm',
        startedAtMs: 8000,
        updatedAtMs: 12000,
        endedAtMs: 12000,
        maxSpeedMs: 18,
        totalDistanceM: 940,
        minAltitudeM: 12,
        maxAltitudeM: 24,
        startPlace: { label: 'Hoboken' },
        endPlace: { label: 'Jersey City' },
        samples: [
          {
            timestampMs: 8000,
            latitude: 40.739,
            longitude: -74.03,
            speedMs: 0,
            altitudeM: 12,
            accuracyM: 5,
            headingDeg: 160,
            totalDistanceM: 700,
          },
          {
            timestampMs: 12000,
            latitude: 40.733,
            longitude: -74.029,
            speedMs: 18,
            altitudeM: 24,
            accuracyM: 4,
            headingDeg: 172,
            totalDistanceM: 940,
          },
        ],
      },
    ]));

    window.dispatchEvent(new CustomEvent('vatioboard:cloud-sync-applied', {
      detail: {
        entityType: 'replay_session',
        recordId: 'synced-session',
      },
    }));
    await settleAsyncWork();

    const syncedButton = await waitForRecordingButton('synced-session');
    expect(syncedButton?.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('replayShell').hidden).toBe(false);
  });

  it('keeps a newly synced replay selected while recovering from a missing deep link', async () => {
    const remoteSession = {
      id: 'remote-session-sync',
      version: 1,
      source: 'speed',
      unit: 'kmh',
      distanceUnit: 'm',
      startedAtMs: 9000,
      updatedAtMs: 13000,
      endedAtMs: 13000,
      maxSpeedMs: 20,
      totalDistanceM: 980,
      minAltitudeM: 9,
      maxAltitudeM: 21,
      startPlace: { label: 'Union City' },
      endPlace: { label: 'Jersey City' },
      samples: [
        {
          timestampMs: 9000,
          latitude: 40.77,
          longitude: -74.03,
          speedMs: 0,
          altitudeM: 9,
          accuracyM: 5,
          headingDeg: 150,
          totalDistanceM: 800,
        },
        {
          timestampMs: 13000,
          latitude: 40.771,
          longitude: -74.028,
          speedMs: 20,
          altitudeM: 21,
          accuracyM: 4,
          headingDeg: 162,
          totalDistanceM: 980,
        },
      ],
    };

    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      if (url.includes('vatiolibre.services.tesla_connection_status')) {
        return new Response(JSON.stringify({
          message: {
            is_guest: false,
          },
        }), {
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
            records: [
              {
                name: 'sync-remote-session-sync',
                entity_type: 'replay_session',
                client_record_id: 'remote-session-sync',
                device_id: 'device-remote',
                record_title: 'remote-session-sync',
                content_hash: 'hash-remote-session-sync',
                client_updated_at_ms: String(remoteSession.updatedAtMs),
                deleted_at_ms: '',
                server_version: 1,
                payload_size: 256,
                modified: '2026-04-05 04:30:00.000000',
              },
            ],
            has_more: false,
            next_cursor: '',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload')) {
        return new Response(JSON.stringify({
          message: {
            payload: remoteSession,
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

    vi.resetModules();
    await bootHtmlPage('replay.html');
    window.history.replaceState({}, '', 'https://vatioboard.com/replay.html?record=missing-session');

    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await settleAsyncWork();

    const remoteButton = await waitForRecordingButton('remote-session-sync');
    expect(remoteButton?.getAttribute('aria-pressed')).toBe('true');
    expect(
      document.querySelector('button[data-recording-id="active-session"]')?.getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('restores a requested remote replay instead of falling back to a different local session', async () => {
    const remoteSession = {
      id: 'remote-session',
      version: 1,
      source: 'speed',
      unit: 'kmh',
      distanceUnit: 'm',
      startedAtMs: 8000,
      updatedAtMs: 12000,
      endedAtMs: 12000,
      maxSpeedMs: 18,
      totalDistanceM: 940,
      minAltitudeM: 12,
      maxAltitudeM: 24,
      sampleCount: 2,
      startPlace: { label: 'Hoboken' },
      endPlace: { label: 'Jersey City' },
      recordingState: 'stopped',
      samples: [
        {
          timestampMs: 8000,
          latitude: 40.739,
          longitude: -74.03,
          speedMs: 0,
          altitudeM: 12,
          accuracyM: 5,
          headingDeg: 160,
          totalDistanceM: 700,
        },
        {
          timestampMs: 12000,
          latitude: 40.733,
          longitude: -74.029,
          speedMs: 18,
          altitudeM: 24,
          accuracyM: 4,
          headingDeg: 172,
          totalDistanceM: 940,
        },
      ],
    };
    localStorage.setItem('vatioboard.cloud_sync.state', JSON.stringify({
      cursor: '',
      bootstrapVersion: 2,
      records: {
        'replay_session:remote-session': {
          name: 'sync-remote-session',
          entity_type: 'replay_session',
          client_record_id: 'remote-session',
          device_id: 'device-remote',
          record_title: 'remote-session',
          content_hash: 'hash-remote-session',
          client_updated_at_ms: String(remoteSession.updatedAtMs),
          deleted_at_ms: '',
          server_version: 1,
          payload_size: 256,
          modified: '2026-04-05 04:10:00.000000',
        },
      },
    }));
    window.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');

      if (url.includes('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload')) {
        return new Response(JSON.stringify({
          message: {
            payload: remoteSession,
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

    vi.resetModules();
    await bootHtmlPage('replay.html');
    window.history.replaceState({}, '', 'https://vatioboard.com/replay.html?record=remote-session');

    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await settleAsyncWork();

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining('vatiolibre.vatiolibre.cloud_sync.download_my_sync_payload'),
      expect.any(Object)
    );
    const remoteButton = await waitForRecordingButton('remote-session');
    expect(
      remoteButton?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      document.querySelector('button[data-recording-id="active-session"]')?.getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('reveals the replay shell when single-tab ownership hangs past the timeout', async () => {
    vi.useFakeTimers();

    vi.doMock('../../src/shared/single-tab.js', () => ({
      ensureSingleTabOwnership: vi.fn(() => new Promise(() => {})),
      releaseSingleTabOwnership: vi.fn(),
      hasSingleTabOwnership: vi.fn(() => false),
      SINGLE_TAB_OWNERSHIP_EVENT: 'vatioboard:single-tab-ownership',
    }));

    vi.resetModules();
    await bootHtmlPage('replay.html');

    const replayPage = await import('../../src/replay/replay.js');

    expect(document.getElementById('replayEmptyState').hidden).toBe(true);
    expect(document.getElementById('replayShell').hidden).toBe(true);

    await vi.advanceTimersByTimeAsync(3500);
    for (let index = 0; index < 30; index += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(document.getElementById('replayShell').hidden).toBe(false);
    expect(document.getElementById('replayEmptyState').hidden).toBe(true);
    expect(document.getElementById('replaySessionChip').textContent).toBe('Active session');

    vi.useRealTimers();
    vi.doUnmock('../../src/shared/single-tab.js');
  });

  it('reveals the empty state when ownership hangs and no replay data exists', async () => {
    localStorage.clear();
    vi.useFakeTimers();

    vi.doMock('../../src/shared/single-tab.js', () => ({
      ensureSingleTabOwnership: vi.fn(() => new Promise(() => {})),
      releaseSingleTabOwnership: vi.fn(),
      hasSingleTabOwnership: vi.fn(() => false),
      SINGLE_TAB_OWNERSHIP_EVENT: 'vatioboard:single-tab-ownership',
    }));

    vi.resetModules();
    await bootHtmlPage('replay.html');

    const replayPage = await import('../../src/replay/replay.js');

    expect(document.getElementById('replayEmptyState').hidden).toBe(true);
    expect(document.getElementById('replayShell').hidden).toBe(true);

    await vi.advanceTimersByTimeAsync(3500);
    for (let index = 0; index < 30; index += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(document.getElementById('replayEmptyState').hidden).toBe(false);
    expect(document.getElementById('replayShell').hidden).toBe(true);

    vi.useRealTimers();
    vi.doUnmock('../../src/shared/single-tab.js');
  });

  it('reveals the replay shell when single-tab ownership rejects', async () => {
    vi.doMock('../../src/shared/single-tab.js', () => ({
      ensureSingleTabOwnership: vi.fn(() => Promise.reject(new Error('ownership failure'))),
      releaseSingleTabOwnership: vi.fn(),
      hasSingleTabOwnership: vi.fn(() => false),
      SINGLE_TAB_OWNERSHIP_EVENT: 'vatioboard:single-tab-ownership',
    }));

    vi.resetModules();
    await bootHtmlPage('replay.html');

    const replayPage = await import('../../src/replay/replay.js');
    await replayPage.initPromise;
    await settleAsyncWork();

    expect(document.getElementById('replayShell').hidden).toBe(false);
    expect(document.getElementById('replayEmptyState').hidden).toBe(true);
    expect(document.getElementById('replaySessionChip').textContent).toBe('Active session');

    vi.doUnmock('../../src/shared/single-tab.js');
  });

  it('does not block startup on backend auth when ownership is degraded', async () => {
    vi.useFakeTimers();

    vi.doMock('../../src/shared/backend-auth.js', async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        initBackendAuthControllers: vi.fn(() => new Promise(() => {})),
      };
    });
    vi.doMock('../../src/shared/single-tab.js', () => ({
      ensureSingleTabOwnership: vi.fn(() => new Promise(() => {})),
      releaseSingleTabOwnership: vi.fn(),
      hasSingleTabOwnership: vi.fn(() => false),
      SINGLE_TAB_OWNERSHIP_EVENT: 'vatioboard:single-tab-ownership',
    }));

    vi.resetModules();
    await bootHtmlPage('replay.html');

    const replayPage = await import('../../src/replay/replay.js');

    await vi.advanceTimersByTimeAsync(3500);
    for (let index = 0; index < 30; index += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(document.getElementById('replayShell').hidden).toBe(false);

    vi.useRealTimers();
    vi.doUnmock('../../src/shared/single-tab.js');
    vi.doUnmock('../../src/shared/backend-auth.js');
  });

  it('reveals the replay shell when IndexedDB open hangs silently (Safari IDB stall)', async () => {
    vi.useFakeTimers();

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: {
        open: vi.fn(() => ({
          result: null,
          error: null,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          onblocked: null,
        })),
      },
    });

    vi.resetModules();
    await bootHtmlPage('replay.html');

    const replayPage = await import('../../src/replay/replay.js');

    expect(document.getElementById('replayEmptyState').hidden).toBe(true);
    expect(document.getElementById('replayShell').hidden).toBe(true);

    await vi.advanceTimersByTimeAsync(4000);
    for (let index = 0; index < 40; index += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(4000);
    for (let index = 0; index < 40; index += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(document.getElementById('replayShell').hidden).toBe(false);
    expect(document.getElementById('replayEmptyState').hidden).toBe(true);
    expect(document.getElementById('replaySessionChip').textContent).toBe('Active session');

    vi.useRealTimers();
  });

  it("injects a Player toggle into the tools menu", async () => {
    await import("../../src/replay/replay.js");
    await settleAsyncWork();

    const btn = document.querySelector("#replayToolsMenuList [data-player-toggle]");
    expect(btn).toBeTruthy();
    expect(btn.querySelector(".btn-icon svg")).toBeTruthy();
    expect(btn.textContent).toContain("player");
  });
});
