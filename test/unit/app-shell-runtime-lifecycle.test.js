import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lifecycle: {
    mount: vi.fn(() => "mounted"),
    activate: vi.fn(() => "active"),
    deactivate: vi.fn(() => "inactive"),
    unmount: vi.fn(() => "unmounted"),
  },
  mountError: new Error("route mount failed"),
  routeChangeResult: null,
}));

const mockedModules = [
  "../../src/app-platform/index.js",
  "../../src/player/player-widget.js",
  "../../src/shared/backend-auth.js",
  "../../src/shared/account-panel.js",
  "../../src/shared/cloud-sync.js",
  "../../src/shared/activity-indicator.js",
  "../../src/shared/floating-tools.js",
  "../../src/shared/start-menu.js",
  "../../src/shared/single-tab.js",
  "../../src/shared/shell-window-manager.js",
  "../../src/shared/shell-taskbar.js",
  "../../src/shared/shell-keyboard.js",
  "../../src/app/runtime-context.js",
  "../../src/app/welcome-consent.js",
  "../../src/app/routes.js",
  "../../src/app/router.js",
];

describe("app shell route app runtime lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    state.lifecycle.mount.mockClear();
    state.lifecycle.activate.mockClear();
    state.lifecycle.deactivate.mockClear();
    state.lifecycle.unmount.mockClear();
    state.mountError = new Error("route mount failed");
    state.routeChangeResult = null;
    document.body.innerHTML = '<main id="app-view"></main><div id="app-persistent-layer"></div>';
  });

  afterEach(() => {
    for (const moduleId of mockedModules) vi.doUnmock(moduleId);
    vi.resetModules();
  });

  it("deactivates and unmounts a route app runtime when route mount throws", async () => {
    const routeConfig = {
      path: "/",
      title: "Broken",
      load: vi.fn(async () => ({
        mount: vi.fn(async () => {
          throw state.mountError;
        }),
      })),
    };
    const route = {
      path: "/",
      requestedPath: "/",
      hash: "#/",
      query: new URLSearchParams(),
      config: routeConfig,
    };

    vi.doMock("../../src/app-platform/index.js", () => ({
      appControl: {
        isEnabled: vi.fn(() => true),
        subscribe: vi.fn(() => vi.fn()),
      },
      appRegistry: {
        getAppByRoute: vi.fn(() => ({
          id: "test.broken",
          permissions: [],
          services: [],
        })),
      },
      createAppLauncher: vi.fn(() => ({
        openApp: vi.fn(),
        closeApp: vi.fn(),
        focusApp: vi.fn(),
        getInstalledApps: vi.fn(() => []),
        getRunningApps: vi.fn(() => []),
      })),
      createAppRuntime: vi.fn(() => ({
        lifecycle: state.lifecycle,
      })),
      createBackgroundServiceManager: vi.fn(() => ({
        destroy: vi.fn(),
        getRuntime: vi.fn(() => null),
        listServices: vi.fn(() => []),
        resume: vi.fn(() => false),
        start: vi.fn(() => false),
        startAsync: vi.fn(async () => false),
        startAutostartServices: vi.fn(() => []),
        stop: vi.fn(() => false),
        stopAsync: vi.fn(async () => false),
        suspend: vi.fn(() => false),
      })),
      createShellAppRuntimeManager: vi.fn(() => ({
        destroy: vi.fn(),
        ensureRuntime: vi.fn(),
        getRuntime: vi.fn(),
        getRuntimeForShellWindow: vi.fn(),
        listRuntimes: vi.fn(() => []),
        setLauncher: vi.fn(),
      })),
    }));
    vi.doMock("../../src/player/player-widget.js", () => ({
      createPlayerWidget: vi.fn(() => ({})),
    }));
    vi.doMock("../../src/shared/backend-auth.js", () => ({
      initBackendAuthControllers: vi.fn(),
    }));
    vi.doMock("../../src/shared/account-panel.js", () => ({
      initAccountPanel: vi.fn(() => ({ destroy: vi.fn(), open: vi.fn(), close: vi.fn(), toggle: vi.fn() })),
    }));
    vi.doMock("../../src/shared/cloud-sync.js", () => ({
      startCloudSyncLoop: vi.fn(),
    }));
    vi.doMock("../../src/shared/activity-indicator.js", () => ({
      initActivityIndicator: vi.fn(() => ({})),
    }));
    vi.doMock("../../src/shared/floating-tools.js", () => ({
      initFloatingTools: vi.fn(() => ({})),
    }));
    vi.doMock("../../src/shared/start-menu.js", () => ({
      initSharedStartMenu: vi.fn(() => ({})),
    }));
    vi.doMock("../../src/shared/single-tab.js", () => ({
      ensureSingleTabOwnership: vi.fn(),
    }));
    vi.doMock("../../src/shared/shell-window-manager.js", () => ({
      getDefaultShellWindowManager: vi.fn(() => ({
        restoreShellLayout: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
      })),
    }));
    vi.doMock("../../src/shared/shell-taskbar.js", () => ({
      createShellTaskbar: vi.fn(() => ({ destroy: vi.fn() })),
    }));
    vi.doMock("../../src/shared/shell-keyboard.js", () => ({
      installShellKeyboardShortcuts: vi.fn(() => ({ uninstall: vi.fn() })),
    }));
    vi.doMock("../../src/app/runtime-context.js", () => ({
      createRuntimeContext: vi.fn(() => ({
        audioRuntime: {},
        driveRecordingService: { destroy: vi.fn() },
        drivingAlertService: { destroy: vi.fn() },
        gpsService: {
          destroy: vi.fn(),
          getCurrentPosition: vi.fn(() => null),
          installGlobalShim: vi.fn(),
        },
      })),
    }));
    vi.doMock("../../src/app/welcome-consent.js", () => ({
      showWelcomeConsentIfNeeded: vi.fn(() => Promise.resolve({ accepted: true })),
    }));
    vi.doMock("../../src/app/routes.js", () => ({
      routes: [],
    }));
    vi.doMock("../../src/app/router.js", () => ({
      createHashRouter: vi.fn(({ onRouteChange }) => {
        state.routeChangeResult = onRouteChange(route).catch((error) => error);
        return {
          destroy: vi.fn(),
          getRoute: vi.fn(() => route),
        };
      }),
      emitRouteVisible: vi.fn(),
      navigateToAppRoute: vi.fn(() => true),
    }));

    const { startAppShell } = await import("../../src/app/app-shell.js");
    await startAppShell();
    await expect(state.routeChangeResult).resolves.toBe(state.mountError);

    expect(state.lifecycle.mount).toHaveBeenCalledTimes(1);
    expect(state.lifecycle.activate).toHaveBeenCalledTimes(1);
    expect(state.lifecycle.deactivate).toHaveBeenCalledTimes(1);
    expect(state.lifecycle.unmount).toHaveBeenCalledTimes(1);
  });
});
