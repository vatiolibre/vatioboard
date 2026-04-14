import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitGeolocationSuccess, getBrowserMocks } from '../helpers/browser-mocks.js';
import { bootHtmlPage, expectPageSeo, flushTasks } from '../helpers/page-smoke.js';

const archiveReplaySessionSpy = vi.fn();
const reversePlaceSpy = vi.fn(async () => ({ place: null, data: null, meta: null }));
const saveActiveReplaySessionSpy = vi.fn();

async function settleAsyncWork(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
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

vi.mock('../../src/replay/session.js', async () => {
  const actual = await vi.importActual('../../src/replay/session.js');
  archiveReplaySessionSpy.mockImplementation(actual.archiveReplaySession);
  saveActiveReplaySessionSpy.mockImplementation(actual.saveActiveReplaySession);
  return {
    ...actual,
    archiveReplaySession: archiveReplaySessionSpy,
    saveActiveReplaySession: saveActiveReplaySessionSpy,
  };
});

vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor() {
      this.handlers = {};
      this.sources = new Map();
      this.scrollZoom = { disable: vi.fn() };
      this.boxZoom = { disable: vi.fn() };
      this.doubleClickZoom = { disable: vi.fn() };
      this.keyboard = { disable: vi.fn() };
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
    jumpTo() {}
    easeTo() {}
    remove() {}
  }

  class FakeAttributionControl {}

  return {
    default: {
      Map: FakeMap,
      AttributionControl: FakeAttributionControl,
    },
  };
});

describe('speed.html smoke', () => {
  beforeEach(async () => {
    vi.resetModules();
    archiveReplaySessionSpy.mockClear();
    reversePlaceSpy.mockReset();
    reversePlaceSpy.mockImplementation(async () => ({ place: null, data: null, meta: null }));
    saveActiveReplaySessionSpy.mockClear();
    await bootHtmlPage('speed.html');
  });

  afterEach(async () => {
    window.dispatchEvent(new Event('pagehide'));
    await settleAsyncWork(40);
  });

  it('boots the speedometer and reacts to a mocked geolocation fix', async () => {
    const speedPage = await import('../../src/speed/speed.js');
    await speedPage.initPromise;
    await settleAsyncWork();
    await flushTasks();

    expectPageSeo({
      titleIncludes: 'Vatio Speed',
      canonical: 'https://vatioboard.com/speed.html',
    });
    expect(getBrowserMocks().geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(document.getElementById('quickAlertConfig').getAttribute('aria-label')).toBe(
      'Configure alerts'
    );
    expect(document.querySelector('#quickAlertConfig .toolbar-recording-glyph svg')).toBeTruthy();
    expect(document.getElementById('resetTrip').getAttribute('aria-label')).toBe('Reset trip');
    expect(document.querySelector('#resetTrip .toolbar-recording-glyph svg')).toBeTruthy();
    expect(document.getElementById('toggleRecording').getAttribute('aria-label')).toBe(
      'Pause recording'
    );
    expect(document.querySelector('#toggleRecording .toolbar-recording-glyph')).toBeTruthy();
    expect(document.getElementById('openReplayQuick').getAttribute('aria-label')).toBe(
      'Drive Replay'
    );
    expect(document.querySelector('#openReplayQuick .toolbar-recording-glyph svg')).toBeTruthy();
    expect(document.querySelector('#stopRecording .toolbar-recording-glyph')).toBeTruthy();
    expect(document.getElementById('quickAudioToggle').getAttribute('aria-label')).toBe(
      'Mute alert audio'
    );
    expect(document.querySelector('#quickAudioToggle .toolbar-recording-glyph svg')).toBeTruthy();
    expect(document.getElementById('quickBackgroundAudioToggle').getAttribute('aria-label')).toBe(
      'Enable background audio'
    );
    expect(
      document.querySelector('#quickBackgroundAudioToggle .toolbar-recording-glyph svg')
    ).toBeTruthy();
    expect(document.getElementById('speedToolsMenuBtn').getAttribute('aria-label')).toBe('Pages');
    expect(document.querySelector('#speedToolsMenuBtn .btn-icon svg')).toBeTruthy();
    expect(document.getElementById('speedToolsMenuList').hidden).toBe(true);
    expect(['Local only', 'Syncing']).toContain(
      document.querySelector('.cloud-sync-indicator-btn')?.textContent
    );

    document.querySelector('.cloud-sync-indicator-btn')?.click();
    await flushTasks();

    expect(document.querySelector('.cloud-sync-indicator-panel')?.hidden).toBe(false);
    expect(document.querySelector('.cloud-sync-indicator-link')?.getAttribute('href')).toBe(
      'https://www.vatiolibre.com/login#signup'
    );
    document.querySelector('.cloud-sync-indicator-link')?.click();
    await flushTasks();
    expect(document.querySelector('.cloud-sync-indicator-panel')?.hidden).toBe(true);

    document.querySelector('.cloud-sync-indicator-btn')?.click();
    await flushTasks();
    document.querySelector('.cloud-sync-indicator-close')?.click();
    await flushTasks();
    expect(document.querySelector('.cloud-sync-indicator-panel')?.hidden).toBe(true);

    document.querySelector('.cloud-sync-indicator-btn')?.click();
    await flushTasks();
    document.querySelector('.cloud-sync-indicator-action')?.click();
    await settleAsyncWork();

    expect(document.getElementById('speedToolsMenuList').hidden).toBe(false);
    expect(document.getElementById('speedToolsMenuBtn').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(
      document.querySelector('#speedToolsMenuList [data-backend-auth-user]')
    );
    expect(document.getElementById('speedLangToggleMenu').textContent).toBe('EN');
    expect(document.querySelector('#speedToolsMenuList [data-backend-auth]')).toBeTruthy();
    expect(
      document.querySelector('#speedToolsMenuList [data-backend-auth-signup]')?.getAttribute('href')
    ).toBe('https://www.vatiolibre.com/login#signup');
    expect(
      document.querySelector('#speedToolsMenuList [data-backend-auth-forgot]')?.getAttribute('href')
    ).toBe('https://www.vatiolibre.com/login#forgot');
    document.getElementById('speedToolsMenuBtn').click();
    await flushTasks();
    expect(document.getElementById('speedToolsMenuList').hidden).toBe(true);
    document.getElementById('quickAlertConfig').click();
    await flushTasks();
    expect(document.getElementById('speedAlertPanel').hidden).toBe(false);
    expect(document.getElementById('quickAlertConfig').getAttribute('aria-pressed')).toBe('true');
    document.getElementById('quickAlertConfig').click();
    await flushTasks();
    expect(document.getElementById('speedAlertPanel').hidden).toBe(true);
    expect(document.getElementById('quickAlertConfig').getAttribute('aria-pressed')).toBe('false');

    emitGeolocationSuccess({
      coords: {
        speed: 10,
        accuracy: 5,
        altitude: 42,
      },
    });
    await flushTasks();

    expect(document.getElementById('speedValue').textContent).toBe('36');
    expect(document.getElementById('altitudeValue').textContent).toBe('42');
  });

  it('coalesces replay persistence under high-frequency recording bursts', async () => {
    const speedPage = await import('../../src/speed/speed.js');
    await speedPage.initPromise;
    await flushTasks();

    for (let index = 0; index < 205; index += 1) {
      emitGeolocationSuccess({
        timestamp: 1000 + index * 100,
        coords: {
          latitude: 40.7128 + index / 100000,
          longitude: -74.006 + index / 100000,
          speed: 10,
          accuracy: 5,
          altitude: 42,
        },
      });
    }

    await flushTasks();
    await flushTasks();
    await flushTasks();

    expect(saveActiveReplaySessionSpy.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('archives a stopped replay before reverse geocoding finishes', async () => {
    reversePlaceSpy.mockImplementation(() => new Promise(() => {}));

    const speedPage = await import('../../src/speed/speed.js');
    await speedPage.initPromise;
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 1000,
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        speed: 10,
        accuracy: 5,
        altitude: 42,
      },
    });
    await flushTasks();

    document.getElementById('stopRecording').click();
    await flushTasks();

    expect(archiveReplaySessionSpy).toHaveBeenCalledTimes(1);
    expect(archiveReplaySessionSpy.mock.calls[0]?.[0]).toMatchObject({
      sampleCount: 1,
      lastSample: {
        latitude: 40.7128,
        longitude: -74.006,
      },
    });
  });

  it('keeps distinct start and end places when the trip ends elsewhere', async () => {
    reversePlaceSpy.mockImplementation(async ({ latitude }) => {
      if (latitude > 40.82) {
        return {
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
        };
      }

      return {
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
      };
    });

    const speedPage = await import('../../src/speed/speed.js');
    await speedPage.initPromise;
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 1000,
      coords: {
        latitude: 40.8501,
        longitude: -73.97,
        speed: 5,
        accuracy: 5,
        altitude: 42,
      },
    });
    await flushTasks();

    emitGeolocationSuccess({
      timestamp: 2000,
      coords: {
        latitude: 40.787,
        longitude: -74.014,
        speed: 7,
        accuracy: 5,
        altitude: 41,
      },
    });
    await flushTasks();

    document.getElementById('stopRecording').click();
    let finalArchivedSession = archiveReplaySessionSpy.mock.calls.find(
      ([session]) =>
        session?.startPlace?.raw?.houseNumber === '6312' && session?.endPlace?.raw?.houseNumber === '119'
    )?.[0];
    for (let index = 0; index < 80; index += 1) {
      if (finalArchivedSession) {
        break;
      }
      await flushTasks();
      finalArchivedSession = archiveReplaySessionSpy.mock.calls.find(
        ([session]) =>
          session?.startPlace?.raw?.houseNumber === '6312' && session?.endPlace?.raw?.houseNumber === '119'
      )?.[0];
    }
    expect(finalArchivedSession).toMatchObject({
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
    expect(finalArchivedSession.startPlace).not.toEqual(finalArchivedSession.endPlace);
  });

  it("hides the Player launcher for guests and shows it after login", async () => {
    await import("../../src/speed/speed.js");
    await settleAsyncWork();

    // Guest: launcher hidden
    const btn = document.querySelector("#speedToolsMenuList [data-player-toggle]");
    expect(btn).toBeTruthy();
    expect(btn.hidden).toBe(true);
    expect(btn.className).toBe("btn-with-icon");
    expect(btn.querySelector(".btn-icon[aria-hidden='true'] svg")).toBeTruthy();
    expect(btn.querySelector("[data-i18n='audioPlayer']")).toBeTruthy();
    const fab = document.querySelector(".player-fab");
    expect(fab).toBeTruthy();
    expect(fab.hidden).toBe(true);

    // Log in → launcher appears
    const authForm = document.querySelector("#speedToolsMenuList [data-backend-auth]");
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
