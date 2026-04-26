import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitGeolocationSuccess, getBrowserMocks } from '../helpers/browser-mocks.js';
import { bootHtmlPage, flushTasks } from '../helpers/page-smoke.js';

const testDoubles = vi.hoisted(() => ({
  archiveReplaySessionSpy: vi.fn(),
  createPlayerWidget: vi.fn(() => ({
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    restoreVisibility: vi.fn(),
    destroy: vi.fn(),
  })),
  reversePlaceSpy: vi.fn(async () => ({ place: null, data: null, meta: null })),
}));

async function settleAsyncWork(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

async function navigateHash(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await settleAsyncWork();
}

function createFetchMock() {
  return vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? '');

    if (url.endsWith('.json')) {
      return new Response(JSON.stringify({ traps: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.endsWith('.kdbush')) {
      return new Response('', { status: 404 });
    }

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
      return new Response(
        JSON.stringify({
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
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (url.includes('vatiolibre.vatiolibre.cloud_sync.pull_my_sync_changes')) {
      return new Response(
        JSON.stringify({
          message: {
            records: [],
            has_more: false,
            next_cursor: '',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function getNumericText(element) {
  return Number(String(element?.textContent ?? '').replace(/[^\d.-]/g, '')) || 0;
}

vi.mock('../../src/shared/analog-speedometer.js', () => ({
  createAnalogSpeedometer: () => ({
    render: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  }),
}));

vi.mock('../../src/player/player-widget.js', () => ({
  createPlayerWidget: testDoubles.createPlayerWidget,
}));

vi.mock('../../src/shared/place-resolver.js', async () => {
  const actual = await vi.importActual('../../src/shared/place-resolver.js');
  return {
    ...actual,
    createPlaceResolver: () => ({
      reversePlace: testDoubles.reversePlaceSpy,
      reverseCountry: vi.fn(async () => ({ place: null, data: null, meta: null, countryCode: '' })),
    }),
  };
});

vi.mock('../../src/replay/session.js', async () => {
  const actual = await vi.importActual('../../src/replay/session.js');
  testDoubles.archiveReplaySessionSpy.mockImplementation(actual.archiveReplaySession);
  return {
    ...actual,
    archiveReplaySession: testDoubles.archiveReplaySessionSpy,
  };
});

vi.mock('../../src/app/views/BoardView.js', () => ({
  mount(root) {
    const view = document.createElement('section');
    view.dataset.mockView = 'board';
    root.replaceChildren(view);
    return {
      unmount() {
        root.replaceChildren();
      },
    };
  },
}));

vi.mock('chart.js/auto', () => ({
  default: class FakeChart {
    constructor(canvas, config) {
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

    destroy() {}
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
      queueMicrotask(() => {
        for (const handler of this.handlers.load ?? []) handler();
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

    getCenter() {
      return { lng: 0, lat: 0 };
    }

    resize() {}
  }

  class FakeAttributionControl {}

  return {
    default: {
      Map: FakeMap,
      AttributionControl: FakeAttributionControl,
    },
  };
});

describe('SPA GPS background runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    testDoubles.archiveReplaySessionSpy.mockClear();
    testDoubles.createPlayerWidget.mockClear();
    testDoubles.reversePlaceSpy.mockClear();
    delete window.__vatioboardRouter;
    delete window.__vatioboardSpa;
    window.fetch = createFetchMock();
  });

  it('keeps speed recording and an accel run subscribed across route changes', async () => {
    await bootHtmlPage('index.html');
    const geolocation = getBrowserMocks().geolocation;
    const nativeWatchPosition = geolocation.watchPosition;
    const nativeClearWatch = geolocation.clearWatch;
    await import('../../src/app/main.js');
    await settleAsyncWork();
    await import('../../src/speed/speed.js').then((module) => module.initPromise);
    await settleAsyncWork();

    expect(nativeWatchPosition).toHaveBeenCalledTimes(1);
    const serviceWatchPosition = navigator.geolocation.watchPosition.bind(navigator.geolocation);
    let accelGpsCallbackCount = 0;
    const accelGpsErrors = [];
    vi.spyOn(navigator.geolocation, 'watchPosition').mockImplementation((success, error, options) =>
      serviceWatchPosition(
        (position) => {
          accelGpsCallbackCount += 1;
          try {
            return success(position);
          } catch (caughtError) {
            accelGpsErrors.push(caughtError);
            throw caughtError;
          }
        },
        error,
        options
      )
    );
    const serviceClearWatch = vi.spyOn(navigator.geolocation, 'clearWatch');

    document.getElementById('toggleRecording').click();
    await settleAsyncWork();
    expect(document.querySelector('[data-activity-id="speed.recording"]')).toBeTruthy();
    emitGeolocationSuccess({
      timestamp: 100000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 5,
      },
    });
    await settleAsyncWork();

    await navigateHash('#/accel');
    await import('../../src/accel/accel.js').then((module) => module.initPromise);
    await settleAsyncWork();

    expect(nativeClearWatch).not.toHaveBeenCalled();
    expect(serviceClearWatch).not.toHaveBeenCalled();
    expect(nativeWatchPosition).toHaveBeenCalledTimes(1);

    emitGeolocationSuccess({
      timestamp: 101000,
      coords: {
        latitude: 40.7129,
        longitude: -74.0059,
        speed: 0,
      },
    });
    await settleAsyncWork();
    expect(accelGpsCallbackCount).toBe(1);
    expect(accelGpsErrors).toEqual([]);

    const samplesBeforeBackground = getNumericText(
      document.getElementById('diagnosticSamplesValue')
    );
    expect(samplesBeforeBackground).toBeGreaterThanOrEqual(1);

    const armRun = document.getElementById('armRun');
    expect(armRun.disabled).toBe(false);
    armRun.click();
    await settleAsyncWork();
    expect(armRun.getAttribute('aria-label')).toBe('Cancel test');
    expect(document.querySelector('[data-activity-id="speed.recording"]')).toBeTruthy();
    expect(document.querySelector('[data-activity-id="accel.run"]')).toBeTruthy();

    window.confirm.mockClear();
    await navigateHash('#/board');

    expect(window.confirm).not.toHaveBeenCalled();
    expect(document.querySelector('[data-activity-id="speed.recording"]')).toBeTruthy();
    expect(document.querySelector('[data-activity-id="accel.run"]')).toBeTruthy();
    expect(nativeClearWatch).not.toHaveBeenCalled();
    expect(serviceClearWatch).not.toHaveBeenCalled();
    expect(nativeWatchPosition).toHaveBeenCalledTimes(1);

    emitGeolocationSuccess({
      timestamp: 102000,
      coords: {
        latitude: 40.7132,
        longitude: -74.0056,
        speed: 20,
      },
    });
    await settleAsyncWork();
    expect(accelGpsCallbackCount).toBeGreaterThan(1);
    expect(accelGpsErrors).toEqual([]);

    await navigateHash('#/accel');
    await settleAsyncWork();

    expect(getNumericText(document.getElementById('statusSpeedValue'))).toBeGreaterThan(0);
    expect(
      getNumericText(document.getElementById('diagnosticSamplesValue'))
    ).toBeGreaterThanOrEqual(1);

    await navigateHash('#/');
    document.getElementById('stopRecording').click();
    await settleAsyncWork(40);

    const archivedSessions = testDoubles.archiveReplaySessionSpy.mock.calls
      .map(([session]) => session)
      .filter(Boolean);
    expect(
      archivedSessions.some((session) => {
        const sampleCount = Number(session.sampleCount) || 0;
        const embeddedCount = Array.isArray(session.samples) ? session.samples.length : 0;
        return Math.max(sampleCount, embeddedCount) >= 3;
      })
    ).toBe(true);
  });
});
