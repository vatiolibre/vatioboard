import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AUTH_REQUEST_EVENT = "vatioboard:backend-auth-request";
const AUTH_STATE_EVENT = "vatioboard:backend-auth-state";

async function loadAccountPanel({ backendAuthDebugControlsEnabled = false } = {}) {
  vi.resetModules();
  const createBackendAuthController = vi.fn(() => ({ destroy: vi.fn() }));
  vi.doMock("../../src/shared/backend-auth.js", () => ({
    BACKEND_AUTH_REQUEST_EVENT: AUTH_REQUEST_EVENT,
    BACKEND_AUTH_STATE_EVENT: AUTH_STATE_EVENT,
    createBackendAuthController,
    getBackendAuthStateSnapshot: vi.fn(() => ({
      authenticated: false,
      busy: false,
      isGuest: true,
      pendingLogout: false,
      user: null,
    })),
  }));
  vi.doMock("../../src/shared/environment.js", () => ({
    getEnvironmentConfig: vi.fn(() => ({
      backendAuthDebugControlsEnabled,
    })),
  }));
  const [accountPanel, shellWindowManager] = await Promise.all([
    import("../../src/shared/account-panel.js"),
    import("../../src/shared/shell-window-manager.js"),
  ]);
  return { ...accountPanel, ...shellWindowManager, createBackendAuthController };
}

describe("account panel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps backend auth debug controls disabled by default", async () => {
    const { createBackendAuthController, createShellWindowManager, initAccountPanel } = await loadAccountPanel();
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const accountPanel = initAccountPanel({
      mount: document.body,
      shellManager,
    });

    expect(createBackendAuthController.mock.calls[0]?.[0]?.ssoUi).toBeUndefined();

    accountPanel.destroy();
    shellManager.destroy();
  });

  it("enables backend auth debug controls when requested by environment", async () => {
    const { createBackendAuthController, createShellWindowManager, initAccountPanel } = await loadAccountPanel({
      backendAuthDebugControlsEnabled: true,
    });
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const accountPanel = initAccountPanel({
      mount: document.body,
      shellManager,
    });

    expect(createBackendAuthController.mock.calls[0]?.[0]?.ssoUi).toEqual({
      showGuestSsoLogin: true,
      showAuthenticatedCrossOpenActions: true,
    });

    accountPanel.destroy();
    shellManager.destroy();
  });

  it("queues automatic auth requests behind the welcome gate without focusing the username field", async () => {
    const { createShellWindowManager, initAccountPanel } = await loadAccountPanel();
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    let releaseGate;
    const authRequestGate = new Promise((resolve) => {
      releaseGate = resolve;
    });
    const accountPanel = initAccountPanel({
      mount: document.body,
      shellManager,
      authRequestGate,
      gatedAuthRequestFocus: false,
    });
    const panel = accountPanel.getElement();
    const usernameInput = panel.querySelector("[data-backend-auth-user]");

    window.dispatchEvent(new CustomEvent(AUTH_REQUEST_EVENT, {
      detail: {
        blockedByAuth: true,
        featureKey: "cloud-sync",
        source: "protected-feature",
      },
    }));

    expect(panel.hidden).toBe(true);
    expect(shellManager.getWindow("account")?.state).not.toBe("open");

    releaseGate();
    await Promise.resolve();
    await Promise.resolve();

    expect(panel.hidden).toBe(false);
    expect(shellManager.getWindow("account")?.state).toBe("open");
    expect(document.activeElement).not.toBe(usernameInput);

    accountPanel.destroy();
    shellManager.destroy();
  });

  it("keeps manual account panel opens immediate while a gate is pending", async () => {
    const { createShellWindowManager, initAccountPanel } = await loadAccountPanel();
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const authRequestGate = new Promise(() => {});
    const accountPanel = initAccountPanel({
      mount: document.body,
      shellManager,
      authRequestGate,
    });

    accountPanel.open({ focus: false, source: "taskbar-account" });

    expect(accountPanel.getElement().hidden).toBe(false);
    expect(shellManager.getWindow("account")?.state).toBe("open");

    accountPanel.destroy();
    shellManager.destroy();
  });

  it("does not focus auth fields when opened by shell restore lifecycle", async () => {
    const { createShellWindowManager, initAccountPanel } = await loadAccountPanel();
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const accountPanel = initAccountPanel({
      mount: document.body,
      shellManager,
    });
    const panel = accountPanel.getElement();
    const usernameInput = panel.querySelector("[data-backend-auth-user]");

    shellManager.openWindow("account");
    await Promise.resolve();

    expect(panel.hidden).toBe(false);
    expect(document.activeElement).not.toBe(usernameInput);

    accountPanel.destroy();
    shellManager.destroy();
  });
});
