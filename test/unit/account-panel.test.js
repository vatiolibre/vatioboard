import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AUTH_REQUEST_EVENT = "vatioboard:backend-auth-request";
const AUTH_STATE_EVENT = "vatioboard:backend-auth-state";

function readProjectFile(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

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

  it("keeps guest account links side by side by default", () => {
    const css = readProjectFile("src/styles/account-panel.less");

    expect(css).toMatch(
      /\.vb-account-panel-auth \.backend-auth-links\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    );
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
    expect(shellManager.getWindow("account").capabilities).toMatchObject({
      resizable: false,
      minWidth: 320,
      minHeight: 400,
      maxWidth: 380,
    });
    expect(accountPanel.getElement().style.minWidth).toBe("320px");
    expect(accountPanel.getElement().style.minHeight).toBe("400px");

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

  it("restores the account panel after a simulated shell reload", async () => {
    const { createShellWindowManager, initAccountPanel } = await loadAccountPanel();
    const shellManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const accountPanel = initAccountPanel({
      mount: document.body,
      shellManager,
    });

    accountPanel.open({ focus: false, source: "test" });
    shellManager.updateWindowBounds("account", { left: 144, top: 72, width: 380, height: 420 }, { flush: true });
    accountPanel.destroy();
    shellManager.destroy();

    document.body.innerHTML = "";
    const nextManager = createShellWindowManager({
      root: document.body,
      storeOptions: { storage: localStorage, migrateLegacy: false },
    });
    const nextAccountPanel = initAccountPanel({
      mount: document.body,
      shellManager: nextManager,
    });
    nextManager.restoreShellLayout();

    const panel = nextAccountPanel.getElement();
    const usernameInput = panel.querySelector("[data-backend-auth-user]");
    expect(panel.hidden).toBe(false);
    expect(panel.style.left).toBe("144px");
    expect(panel.style.top).toBe("72px");
    expect(document.activeElement).not.toBe(usernameInput);

    nextAccountPanel.destroy();
    nextManager.destroy();
  });
});
