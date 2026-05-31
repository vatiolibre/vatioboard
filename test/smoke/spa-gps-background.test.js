import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitGeolocationSuccess, getBrowserMocks } from '../helpers/browser-mocks.js';
import { bootHtmlPage, flushTasks } from '../helpers/page-smoke.js';

const WELCOME_CONSENT_KEY = 'vatioboard.welcome_consent.v1';
const SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS = 300000;

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

async function yieldTask() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function waitForAsyncCondition(condition, iterations = 40) {
  for (let index = 0; index < iterations; index += 1) {
    if (condition()) return true;
    await flushTasks();
    await yieldTask();
  }
  return Boolean(condition());
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

function createPromptActivationEvent(type, properties = {}) {
  return {
    type,
    isTrusted: true,
    preventDefault: vi.fn(),
    ...properties,
  };
}

function createTrustedPointerEvent(type, properties = {}) {
  return createPromptActivationEvent(type, {
    button: 0,
    isPrimary: true,
    ...properties,
  });
}

function seedWelcomeConsent() {
  localStorage.setItem(
    WELCOME_CONSENT_KEY,
    JSON.stringify({
      accepted: true,
      acceptedAtMs: Date.now(),
      locationChoice: 'enabled',
      version: 1,
    })
  );
}

function createTouchEndEvent() {
  return new Event('touchend', { bubbles: true, cancelable: true });
}

function createTrustedClickEvent() {
  return createPromptActivationEvent('click');
}

function getLatestMediaSessionActionHandler(action) {
  const calls = getBrowserMocks().mediaSession.setActionHandler.mock.calls;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const [registeredAction, handler] = calls[index];
    if (registeredAction === action) return handler;
  }
  return null;
}

function installControllableAudio({ blocked = false, canPlay = null } = {}) {
  const audioInstances = [];

  class ControllableAudio extends EventTarget {
    static blockPlayback = blocked;
    static canPlay = canPlay;

    constructor(src = '') {
      super();
      this.src = src;
      this.loop = false;
      this.preload = 'auto';
      this.playsInline = true;
      this.currentTime = 0;
      this.duration = 0.5;
      this.paused = true;
      this.muted = false;
      this.volume = 1;
      this.playCalls = 0;
      audioInstances.push(this);
    }

    play() {
      this.playCalls += 1;
      if (
        ControllableAudio.blockPlayback ||
        (typeof ControllableAudio.canPlay === 'function' && !ControllableAudio.canPlay(this))
      ) {
        return Promise.reject(new DOMException('Audio requires user interaction', 'NotAllowedError'));
      }
      this.paused = false;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }

    load() {}
  }

  Object.defineProperty(window, 'Audio', {
    configurable: true,
    writable: true,
    value: ControllableAudio,
  });
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    writable: true,
    value: ControllableAudio,
  });

  return { AudioClass: ControllableAudio, audioInstances };
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
    seedWelcomeConsent();
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
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();

    expect(nativeWatchPosition).toHaveBeenCalledTimes(1);
    const serviceWatchPosition = navigator.geolocation.watchPosition.bind(navigator.geolocation);
    let accelGpsCallbackCount = 0;
    const accelGpsErrors = [];
    const accelWatchSpy = vi.spyOn(navigator.geolocation, 'watchPosition').mockImplementation((success, error, options) =>
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
    const accelWatchCallBaseline = accelWatchSpy.mock.calls.length;
    const serviceClearWatch = vi.spyOn(navigator.geolocation, 'clearWatch');

    document.getElementById('toggleRecording').click();
    await settleAsyncWork();
    expect(document.querySelector('[data-activity-id="speed.recording"]')).toBeTruthy();
    expect(document.querySelector('[data-activity-id="speed.alerts"]')).toBeFalsy();
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(false);
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
    await waitForAsyncCondition(
      () => accelWatchSpy.mock.calls.length > accelWatchCallBaseline
    );

    expect(nativeClearWatch).not.toHaveBeenCalled();
    expect(serviceClearWatch).not.toHaveBeenCalled();
    expect(nativeWatchPosition).toHaveBeenCalledTimes(1);
    expect(accelWatchSpy.mock.calls.length).toBeGreaterThan(accelWatchCallBaseline);

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
    expect(document.querySelector('[data-activity-id="speed.alerts"]')).toBeFalsy();
    expect(document.querySelector('[data-activity-id="accel.run"]')).toBeTruthy();
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);

    window.confirm.mockClear();
    await navigateHash('#/board');

    expect(window.confirm).not.toHaveBeenCalled();
    expect(document.querySelector('[data-activity-id="speed.recording"]')).toBeTruthy();
    expect(document.querySelector('[data-activity-id="speed.alerts"]')).toBeFalsy();
    expect(document.querySelector('[data-activity-id="accel.run"]')).toBeTruthy();
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
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
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('shows speed alert activity only after alert audio is explicitly armed', async () => {
    await bootHtmlPage('index.html');
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();

    document.getElementById('toggleRecording').click();
    await settleAsyncWork();

    expect(document.querySelector('[data-activity-id="speed.recording"]')).toBeTruthy();
    expect(document.querySelector('[data-activity-id="speed.alerts"]')).toBeFalsy();
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(false);

    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork();
    expect(document.querySelector('[data-activity-id="speed.alerts"]')).toBeFalsy();

    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork();

    expect(document.querySelector('[data-activity-id="speed.alerts"]')).toBeTruthy();
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);
    expect(audioSystem.getBackgroundAudioLeaseCount()).toBe(2);
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('keeps GPS recording and silent leases alive across media-session pause and stop', async () => {
    await bootHtmlPage('index.html');
    const geolocation = getBrowserMocks().geolocation;
    const nativeClearWatch = geolocation.clearWatch;
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();

    document.getElementById('toggleRecording').click();
    await settleAsyncWork();
    emitGeolocationSuccess({
      timestamp: 220000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 4,
      },
    });
    await settleAsyncWork();
    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork();
    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork(40);

    const before = speedModule.__testGetSpeedStateSnapshot();
    nativeClearWatch.mockClear();
    expect(before.recordingState).toBe('recording');
    expect(before.recordingKeepAliveIntended).toBe(true);
    expect(before.watchId).not.toBeNull();
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);

    getLatestMediaSessionActionHandler('pause')();
    getLatestMediaSessionActionHandler('stop')();
    await settleAsyncWork(40);
    emitGeolocationSuccess({
      timestamp: 221000,
      coords: {
        latitude: 40.713,
        longitude: -74.0058,
        speed: 5,
      },
    });
    await settleAsyncWork();

    const after = speedModule.__testGetSpeedStateSnapshot();
    expect(after.recordingState).toBe('recording');
    expect(after.recordingKeepAliveIntended).toBe(true);
    expect(after.recordingKeepAliveSuppressed).toBe(false);
    expect(after.backgroundAudioSuppressed).toBe(false);
    expect(after.watchId).toBe(before.watchId);
    expect(after.sampleCount).toBeGreaterThan(before.sampleCount);
    expect(nativeClearWatch).not.toHaveBeenCalled();
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);
    expect(document.querySelector('.vb-confirm-card[role="alertdialog"]')).toBeNull();
    expect(document.getElementById('drivingAudioPrompt').hidden).toBe(true);
    expect(document.getElementById('drivingAudioPrompt').textContent).not.toContain(
      'Rearm keep-alive audio'
    );
    expect(document.querySelector('[data-activity-id="speed.recording"]')?.textContent).not.toContain(
      'Needs rearm'
    );
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('does not stop GPS recording on media-session stop, while explicit app stop still stops', async () => {
    await bootHtmlPage('index.html');
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();

    document.getElementById('toggleRecording').click();
    await settleAsyncWork();
    emitGeolocationSuccess({
      timestamp: 230000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 5,
      },
    });
    await settleAsyncWork();

    const before = speedModule.__testGetSpeedStateSnapshot();
    getLatestMediaSessionActionHandler('stop')();
    await settleAsyncWork(40);

    const afterMediaStop = speedModule.__testGetSpeedStateSnapshot();
    expect(afterMediaStop.recordingState).toBe('recording');
    expect(afterMediaStop.recordingKeepAliveIntended).toBe(true);
    expect(afterMediaStop.watchId).toBe(before.watchId);
    expect(afterMediaStop.replaySessionId).toBe(before.replaySessionId);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(afterMediaStop.recordingKeepAliveSuppressed).toBe(false);

    document.getElementById('stopRecording').click();
    await settleAsyncWork(40);

    const afterExplicitStop = speedModule.__testGetSpeedStateSnapshot();
    expect(afterExplicitStop.recordingState).toBe('stopped');
    expect(afterExplicitStop.recordingKeepAliveIntended).toBe(false);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(false);
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('retains GPS recording while hidden after recording keep-alive interruption', async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const advanceClock = (ms = 1000) => {
      now += ms;
    };

    await bootHtmlPage('index.html');
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();

    document.getElementById('toggleRecording').click();
    await settleAsyncWork();
    emitGeolocationSuccess({
      timestamp: 240000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 5,
      },
    });
    await settleAsyncWork();
    advanceClock();

    const before = speedModule.__testGetSpeedStateSnapshot();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      writable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    getLatestMediaSessionActionHandler('pause')();
    audioSystem.releaseBackgroundAudioLease(audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE);
    await settleAsyncWork();

    emitGeolocationSuccess({
      timestamp: 241000,
      coords: {
        latitude: 40.713,
        longitude: -74.0058,
        speed: 7,
      },
    });
    await settleAsyncWork();
    advanceClock();

    const hiddenSnapshot = speedModule.__testGetSpeedStateSnapshot();
    expect(hiddenSnapshot.recordingState).toBe('recording');
    expect(hiddenSnapshot.recordingKeepAliveIntended).toBe(true);
    expect(hiddenSnapshot.watchId).toBe(before.watchId);
    expect(hiddenSnapshot.sampleCount).toBeGreaterThanOrEqual(before.sampleCount);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      writable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    await settleAsyncWork(40);

    const prompt = document.getElementById('drivingAudioPrompt');
    expect(document.querySelector('.vb-confirm-card[role="alertdialog"]')).toBeNull();
    expect(prompt.hidden).toBe(false);
    expect(prompt.textContent).toContain('Rearm keep-alive audio');

    speedModule.__testRunDrivingAudioPromptPrimaryFromTrustedGesture(
      createTrustedPointerEvent('pointerdown'),
      'driving-audio-prompt-pointerdown'
    );
    await settleAsyncWork(40);

    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(document.getElementById('drivingAudioPrompt').hidden).toBe(true);
    expect(speedModule.__testGetSpeedStateSnapshot().sampleCount).toBeGreaterThanOrEqual(
      before.sampleCount
    );
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('keeps speed alert and recording keep-alive leases independent', async () => {
    await bootHtmlPage('index.html');
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();

    document.getElementById('toggleRecording').click();
    await settleAsyncWork();
    emitGeolocationSuccess({
      timestamp: 250000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 4,
      },
    });
    await settleAsyncWork();
    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork();
    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork(40);

    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);

    getLatestMediaSessionActionHandler('pause')();
    getLatestMediaSessionActionHandler('stop')();
    await settleAsyncWork(40);

    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);
    expect(speedModule.__testGetSpeedStateSnapshot().recordingKeepAliveSuppressed).toBe(false);
    expect(speedModule.__testGetSpeedStateSnapshot().backgroundAudioSuppressed).toBe(false);

    audioSystem.releaseBackgroundAudioLease(audioModule.SPEED_BACKGROUND_AUDIO_LEASE);
    await settleAsyncWork();

    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(false);

    speedModule.__testMaybeArmDrivingAudioFromTrustedGesture({
      isTrusted: true,
      target: document.getElementById('speedValue'),
    });
    await settleAsyncWork(40);

    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)).toBe(true);
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('shows a first-run driving alerts prompt when alert audio is blocked', async () => {
    installControllableAudio({ blocked: true });

    await bootHtmlPage('index.html');
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    await settleAsyncWork();
    emitGeolocationSuccess({
      timestamp: 300000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 0,
      },
    });
    await settleAsyncWork();

    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork();
    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork(40);

    const alertActivity = document.querySelector('[data-activity-id="speed.alerts"]');
    const prompt = document.getElementById('drivingAudioPrompt');

    expect(alertActivity?.textContent).toContain('Alert audio blocked');
    expect(alertActivity?.textContent).toContain('Audio requires user action');
    expect(prompt.hidden).toBe(false);
    expect(prompt.textContent).toContain('Enable driving alerts');
    expect(prompt.textContent).toContain('Enable alerts');
    expect(prompt.textContent).toContain('Keep alerts off');

    document.getElementById('drivingAudioPromptSecondary').click();
    await settleAsyncWork();

    expect(document.getElementById('drivingAudioPrompt').hidden).toBe(true);
    expect(document.querySelector('[data-activity-id="speed.alerts"]')).toBeFalsy();
    expect(document.getElementById('quickAudioToggle').getAttribute('aria-label')).toBe(
      'Unmute alert audio'
    );
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('uses the prompt primary pointerdown itself to arm background alert audio', async () => {
    let pointerActivationOpen = false;
    installControllableAudio({
      canPlay: () => pointerActivationOpen,
    });

    await bootHtmlPage('index.html');
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();
    emitGeolocationSuccess({
      timestamp: 305000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 0,
      },
    });
    await settleAsyncWork();

    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork();
    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork(40);

    expect(document.getElementById('drivingAudioPrompt').hidden).toBe(false);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)
    ).toBe(false);

    pointerActivationOpen = true;
    speedModule.__testRunDrivingAudioPromptPrimaryFromTrustedGesture(
      createTrustedPointerEvent('pointerdown'),
      'driving-audio-prompt-pointerdown'
    );
    pointerActivationOpen = false;
    await settleAsyncWork(40);

    expect(
      audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)
    ).toBe(true);
    expect(document.getElementById('drivingAudioPrompt').hidden).toBe(true);
    expect(document.querySelector('[data-activity-id="speed.alerts"]')?.textContent).not.toContain(
      'Alert audio blocked'
    );
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('does not duplicate prompt arming across pointer, touch, and click follow-up events', async () => {
    let pointerActivationOpen = false;
    const { audioInstances } = installControllableAudio({
      canPlay: () => pointerActivationOpen,
    });

    await bootHtmlPage('index.html');
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();
    emitGeolocationSuccess({
      timestamp: 307000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 0,
      },
    });
    await settleAsyncWork();

    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork();
    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork(40);

    const primary = document.getElementById('drivingAudioPromptPrimary');
    const playCallsBeforePromptTap = audioInstances.reduce(
      (sum, audio) => sum + audio.playCalls,
      0
    );

    pointerActivationOpen = true;
    speedModule.__testRunDrivingAudioPromptPrimaryFromTrustedGesture(
      createTrustedPointerEvent('pointerdown'),
      'driving-audio-prompt-pointerdown'
    );
    pointerActivationOpen = false;
    await settleAsyncWork(40);
    const playCallsAfterPointerDown = audioInstances.reduce(
      (sum, audio) => sum + audio.playCalls,
      0
    );

    primary.dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }));
    primary.dispatchEvent(createTouchEndEvent());
    speedModule.__testRunDrivingAudioPromptPrimaryFromTrustedGesture(
      createTrustedClickEvent(),
      'driving-audio-prompt-click'
    );
    await settleAsyncWork(40);

    const playCallsAfterPromptTap = audioInstances.reduce(
      (sum, audio) => sum + audio.playCalls,
      0
    );
    expect(playCallsAfterPointerDown).toBeGreaterThan(playCallsBeforePromptTap);
    expect(playCallsAfterPromptTap).toBe(playCallsAfterPointerDown);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)
    ).toBe(true);
    expect(document.getElementById('drivingAudioPrompt').hidden).toBe(true);
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('arms blocked alert audio from the explicit prompt and from a trusted shell gesture', async () => {
    const { AudioClass, audioInstances } = installControllableAudio({ blocked: true });

    await bootHtmlPage('index.html');
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();
    emitGeolocationSuccess({
      timestamp: 310000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 0,
      },
    });
    await settleAsyncWork();

    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork();
    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork(40);

    expect(document.getElementById('drivingAudioPrompt').hidden).toBe(false);

    AudioClass.blockPlayback = false;
    speedModule.__testRunDrivingAudioPromptPrimaryFromTrustedGesture(
      createTrustedPointerEvent('pointerdown'),
      'driving-audio-prompt-pointerdown'
    );
    await settleAsyncWork(40);

    expect(
      audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)
    ).toBe(true);
    expect(document.querySelector('[data-activity-id="speed.alerts"]')?.textContent).toContain(
      'Alerts armed'
    );
    expect(document.getElementById('drivingAudioPrompt').hidden).toBe(true);

    audioSystem.releaseBackgroundAudioLease(audioModule.SPEED_BACKGROUND_AUDIO_LEASE);
    await settleAsyncWork();
    expect(
      audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)
    ).toBe(false);

    const ignoredPromptGesture = speedModule.__testMaybeArmDrivingAudioFromTrustedGesture({
      isTrusted: true,
      target: document.getElementById('drivingAudioPromptPrimary'),
    });
    await settleAsyncWork();
    expect(ignoredPromptGesture).toBe(false);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)
    ).toBe(false);

    const armedFromSynthetic = speedModule.__testMaybeArmDrivingAudioFromTrustedGesture({
      isTrusted: false,
      target: document.getElementById('speedValue'),
    });
    await settleAsyncWork();
    expect(armedFromSynthetic).toBe(false);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)
    ).toBe(false);

    const armedFromTrusted = speedModule.__testMaybeArmDrivingAudioFromTrustedGesture({
      isTrusted: true,
      target: document.getElementById('speedValue'),
    });
    await settleAsyncWork(40);

    const alertAudioPlayCalls = audioInstances
      .filter((audio) =>
        audio.src.includes('/audio/overspeed_notification.m4a') ||
        audio.src.includes('/audio/near_camera_notification.m4a')
      )
      .reduce((sum, audio) => sum + audio.playCalls, 0);

    expect(armedFromTrusted).toBe(true);
    expect(alertAudioPlayCalls).toBeGreaterThan(0);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)
    ).toBe(true);
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('does not opportunistically arm alert audio while alerts are muted', async () => {
    await bootHtmlPage('index.html');
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();

    document.getElementById('quickAudioToggle').click();
    await settleAsyncWork();

    const armed = speedModule.__testMaybeArmDrivingAudioFromTrustedGesture({
      isTrusted: true,
      target: document.getElementById('speedValue'),
    });
    await settleAsyncWork();

    expect(armed).toBe(false);
    expect(
      audioSystem.isBackgroundAudioLeaseActive(audioModule.SPEED_BACKGROUND_AUDIO_LEASE)
    ).toBe(false);
    expect(document.getElementById('quickAudioToggle').getAttribute('aria-label')).toBe(
      'Unmute alert audio'
    );
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('keeps Speed to Board to Speed keep-alive-only recovery inline while GPS is fresh', async () => {
    await bootHtmlPage('index.html');
    const geolocation = getBrowserMocks().geolocation;
    const nativeClearWatch = geolocation.clearWatch;
    const nativeWatchPosition = geolocation.watchPosition;
    await import('../../src/app/main.js');
    await settleAsyncWork();
    const speedModule = await import('../../src/speed/speed.js');
    await speedModule.initPromise;
    const audioSystem = await import('../../src/shared/audio-system.js');
    const audioModule = await import('../../src/speed/audio.js');
    await settleAsyncWork();

    document.getElementById('toggleRecording').click();
    await settleAsyncWork();
    emitGeolocationSuccess({
      timestamp: 320000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 5,
      },
    });
    await settleAsyncWork();

    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);

    await navigateHash('#/board');
    emitGeolocationSuccess({
      timestamp: 321000,
      coords: {
        latitude: 40.7129,
        longitude: -74.0059,
        speed: 6,
      },
    });
    audioSystem.releaseBackgroundAudioLease(audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE);
    await settleAsyncWork();

    await navigateHash('#/speed');
    await settleAsyncWork(40);

    const prompt = document.getElementById('drivingAudioPrompt');
    expect(document.querySelector('.vb-confirm-card[role="alertdialog"]')).toBeNull();
    expect(prompt.hidden).toBe(false);
    expect(prompt.textContent).toContain('Rearm keep-alive audio');
    expect(document.querySelector('[data-activity-id="speed.recording"]')?.textContent).toContain(
      'Needs rearm'
    );
    expect(nativeClearWatch).not.toHaveBeenCalled();
    expect(nativeWatchPosition).toHaveBeenCalledTimes(1);

    speedModule.__testRunDrivingAudioPromptPrimaryFromTrustedGesture(
      createTrustedPointerEvent('pointerdown'),
      'driving-audio-prompt-pointerdown'
    );
    await settleAsyncWork(40);

    expect(
      audioSystem.isBackgroundAudioLeaseActive(
        audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE
      )
    ).toBe(true);
    expect(document.getElementById('drivingAudioPrompt').hidden).toBe(true);
    expect(nativeClearWatch).not.toHaveBeenCalled();
    expect(nativeWatchPosition).toHaveBeenCalledTimes(1);
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('shows the recording recovery modal after Speed to Board to Speed when GPS is stale', async () => {
    vi.useFakeTimers();
    try {
      await bootHtmlPage('index.html');
      await import('../../src/app/main.js');
      await settleAsyncWork();
      await import('../../src/speed/speed.js').then((module) => module.initPromise);
      const audioSystem = await import('../../src/shared/audio-system.js');
      const audioModule = await import('../../src/speed/audio.js');
      await settleAsyncWork();

      document.getElementById('toggleRecording').click();
      await settleAsyncWork();
      emitGeolocationSuccess({
        timestamp: 330000,
        coords: {
          latitude: 40.7128,
          longitude: -74.006,
          speed: 5,
        },
      });
      await settleAsyncWork();

      await navigateHash('#/board');
      audioSystem.releaseBackgroundAudioLease(audioModule.SPEED_RECORDING_BACKGROUND_AUDIO_LEASE);
      await vi.advanceTimersByTimeAsync(13000);

      await navigateHash('#/speed');
      await vi.advanceTimersByTimeAsync(2500);
      await settleAsyncWork();

      const dialog = document.querySelector('.vb-confirm-card[role="alertdialog"]');
      expect(dialog?.textContent).toContain('Resume driving tools?');
      expect(dialog?.textContent).toContain('background keep-alive may need to be resumed');
      expect(document.getElementById('drivingAudioPrompt').hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);

  it('keeps an active accel run subscribed across board remounts without duplicating GPS watchers', async () => {
    await bootHtmlPage('index.html');
    const geolocation = getBrowserMocks().geolocation;
    const nativeWatchPosition = geolocation.watchPosition;
    const nativeClearWatch = geolocation.clearWatch;

    await import('../../src/app/main.js');
    await settleAsyncWork();

    await navigateHash('#/accel');
    await import('../../src/accel/accel.js').then((module) => module.initPromise);
    await settleAsyncWork();

    expect(nativeWatchPosition).toHaveBeenCalledTimes(1);

    emitGeolocationSuccess({
      timestamp: 200000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 0,
      },
    });
    await settleAsyncWork();

    const armRun = document.getElementById('armRun');
    expect(armRun.disabled).toBe(false);
    armRun.click();
    await settleAsyncWork();
    expect(document.querySelector('[data-activity-id="accel.run"]')).toBeTruthy();

    window.confirm.mockClear();
    await navigateHash('#/board');

    expect(window.confirm).not.toHaveBeenCalled();
    expect(document.querySelector('[data-activity-id="accel.run"]')).toBeTruthy();
    expect(nativeClearWatch).not.toHaveBeenCalled();
    expect(nativeWatchPosition).toHaveBeenCalledTimes(1);

    emitGeolocationSuccess({
      timestamp: 201000,
      coords: {
        latitude: 40.713,
        longitude: -74.0058,
        speed: 22,
      },
    });
    await settleAsyncWork();

    await navigateHash('#/accel');
    await settleAsyncWork();

    expect(nativeWatchPosition).toHaveBeenCalledTimes(1);
    expect(getNumericText(document.getElementById('statusSpeedValue'))).toBeGreaterThan(0);
    expect(
      getNumericText(document.getElementById('diagnosticSamplesValue'))
    ).toBeGreaterThanOrEqual(1);

    document.getElementById('armRun').click();
    await settleAsyncWork();
    expect(document.querySelector('[data-activity-id="accel.run"]')).toBeFalsy();

    const clearCallsBeforeIdleUnmount = nativeClearWatch.mock.calls.length;
    await navigateHash('#/board');

    expect(nativeClearWatch.mock.calls.length).toBeGreaterThan(clearCallsBeforeIdleUnmount);
  }, SPA_GPS_BACKGROUND_SMOKE_TIMEOUT_MS);
});
