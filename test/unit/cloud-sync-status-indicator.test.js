import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const INDICATOR_MODULE = "../../src/shared/cloud-sync-status-indicator.js";
const I18N_MODULE = "../../src/i18n.js";
const BACKEND_AUTH_MODULE = "../../src/shared/backend-auth.js";
const CLOUD_SYNC_MODULE = "../../src/shared/cloud-sync.js";

let cloudSyncStatusMock;
let sessionStateMock;
let featureAccessStateMock;
let getBackendFeatureAccessStateMock;
let getBackendSessionStateMock;

function buildCloudSyncStateModule() {
  const CLOUD_SYNC_STATUS_STATES = Object.freeze({
    failed: "failed",
    localOnly: "localOnly",
    paused: "paused",
    synced: "synced",
    syncing: "syncing",
  });

  return {
    CLOUD_SYNC_STATUS_EVENT: "vatioboard:cloud-sync-status",
    CLOUD_SYNC_STATUS_STATES,
    getCloudSyncStatus() {
      return cloudSyncStatusMock || {
        state: CLOUD_SYNC_STATUS_STATES.localOnly,
      };
    },
  };
}

async function importIndicatorModule() {
  return import(INDICATOR_MODULE);
}

async function flushAsyncWork(turns = 4) {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

describe("cloud sync status indicator", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="mount"></div><button id="outside" type="button">Outside</button>';

    vi.doMock(I18N_MODULE, () => ({
      t(key) {
        return key;
      },
    }));
    cloudSyncStatusMock = {
      state: "localOnly",
      reason: "guest",
    };
    sessionStateMock = {
      authenticated: false,
      isGuest: true,
      ok: true,
      status: 200,
    };
    featureAccessStateMock = {
      cloudSyncCapability: {
        enabled: false,
        hasActiveSubscription: false,
        reason: "subscription required",
      },
      isGuest: true,
      ok: false,
      status: 403,
    };
    getBackendFeatureAccessStateMock = vi.fn(() => Promise.resolve(featureAccessStateMock));
    getBackendSessionStateMock = vi.fn(() => Promise.resolve(sessionStateMock));
    vi.doMock(BACKEND_AUTH_MODULE, () => ({
      BACKEND_AUTH_STATE_EVENT: "vatioboard:backend-auth-state",
      BACKEND_AUTH_SIGNUP_URL: "https://example.com/signup",
      BACKEND_SUBSCRIBE_URL: "https://example.com/subscribe",
      getBackendFeatureAccessState: getBackendFeatureAccessStateMock,
      getBackendSessionState: getBackendSessionStateMock,
    }));
    vi.doMock(CLOUD_SYNC_MODULE, () => buildCloudSyncStateModule());
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock(I18N_MODULE);
    vi.doUnmock(BACKEND_AUTH_MODULE);
    vi.doUnmock(CLOUD_SYNC_MODULE);
  });

  it("closes when clicking outside the panel", async () => {
    const { initCloudSyncStatusIndicator } = await importIndicatorModule();
    const mount = document.getElementById("mount");
    const indicator = initCloudSyncStatusIndicator({ mount });
    const toggle = mount.querySelector(".cloud-sync-indicator-btn");
    const panel = mount.querySelector(".cloud-sync-indicator-panel");

    toggle.click();
    expect(panel.hidden).toBe(false);

    document.getElementById("outside").click();

    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    indicator.destroy();
  });

  it("closes for subscribe, log in, and close actions", async () => {
    let launcherOpenCount = 0;
    const { initCloudSyncStatusIndicator } = await importIndicatorModule();
    const mount = document.getElementById("mount");
    const indicator = initCloudSyncStatusIndicator({
      mount,
      openLauncher() {
        launcherOpenCount += 1;
      },
    });
    const toggle = mount.querySelector(".cloud-sync-indicator-btn");
    const panel = mount.querySelector(".cloud-sync-indicator-panel");
    const subscribeLink = mount.querySelector(".cloud-sync-indicator-link");
    const loginButton = mount.querySelector(".cloud-sync-indicator-action");
    const closeButton = mount.querySelector(".cloud-sync-indicator-close");

    toggle.click();
    await flushAsyncWork();
    expect(subscribeLink.textContent).toBe("cloudSyncCreateAccount");
    expect(subscribeLink.getAttribute("href")).toBe("https://example.com/signup");
    expect(subscribeLink.getAttribute("target")).toBe("_blank");
    expect(subscribeLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(loginButton.hidden).toBe(false);
    expect(closeButton.parentElement).toBe(panel);
    expect(closeButton.classList.contains("cloud-sync-indicator-action")).toBe(false);
    expect(closeButton.querySelector("svg")).toBeTruthy();
    subscribeLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(panel.hidden).toBe(true);

    toggle.click();
    loginButton.click();
    await flushAsyncWork();
    expect(panel.hidden).toBe(true);
    expect(launcherOpenCount).toBe(1);

    toggle.click();
    closeButton.click();
    expect(panel.hidden).toBe(true);

    indicator.destroy();
  });

  it("shows subscription action without login for authenticated non-subscribers", async () => {
    cloudSyncStatusMock = {
      state: "localOnly",
      reason: "disabled",
    };
    sessionStateMock = {
      authenticated: true,
      isGuest: false,
      ok: true,
      status: 200,
    };
    featureAccessStateMock = {
      cloudSyncCapability: {
        enabled: false,
        hasActiveSubscription: false,
        reason: "An active subscription is required.",
      },
      isGuest: false,
      ok: true,
      status: 200,
    };

    const { initCloudSyncStatusIndicator } = await importIndicatorModule();
    const mount = document.getElementById("mount");
    const indicator = initCloudSyncStatusIndicator({ mount });
    const toggle = mount.querySelector(".cloud-sync-indicator-btn");
    const message = mount.querySelector(".cloud-sync-indicator-copy");
    const subscribeLink = mount.querySelector(".cloud-sync-indicator-link");
    const loginButton = mount.querySelector(".cloud-sync-indicator-action");

    toggle.click();
    await flushAsyncWork();

    expect(message.textContent).toBe("cloudSyncPanelNoSubscription");
    expect(subscribeLink.hidden).toBe(false);
    expect(subscribeLink.textContent).toBe("cloudSyncSubscribe");
    expect(subscribeLink.getAttribute("href")).toBe("https://example.com/subscribe");
    expect(subscribeLink.getAttribute("target")).toBe("_blank");
    expect(subscribeLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(loginButton.hidden).toBe(true);

    indicator.destroy();
  });

  it("shows subscriber status without auth prompts for active subscribers", async () => {
    cloudSyncStatusMock = {
      state: "synced",
      reason: "enabled",
    };
    sessionStateMock = {
      authenticated: true,
      isGuest: false,
      ok: true,
      status: 200,
    };
    featureAccessStateMock = {
      cloudSyncCapability: {
        enabled: true,
        hasActiveSubscription: true,
        reason: "",
      },
      isGuest: false,
      ok: true,
      status: 200,
    };

    const { initCloudSyncStatusIndicator } = await importIndicatorModule();
    const mount = document.getElementById("mount");
    const indicator = initCloudSyncStatusIndicator({ mount });
    const toggle = mount.querySelector(".cloud-sync-indicator-btn");
    const message = mount.querySelector(".cloud-sync-indicator-copy");
    const subscribeLink = mount.querySelector(".cloud-sync-indicator-link");
    const loginButton = mount.querySelector(".cloud-sync-indicator-action");

    toggle.click();
    await flushAsyncWork();

    expect(message.textContent).toBe("cloudSyncPanelSubscriberSynced");
    expect(subscribeLink.hidden).toBe(false);
    expect(subscribeLink.textContent).toBe("cloudSyncManageSubscription");
    expect(loginButton.hidden).toBe(true);
    expect(getBackendSessionStateMock).toHaveBeenCalledWith({ force: true });
    expect(getBackendFeatureAccessStateMock).toHaveBeenCalledWith({ force: true });

    indicator.destroy();
  });

  it("does not show login while authenticated subscriber access is still resolving", async () => {
    cloudSyncStatusMock = {
      state: "localOnly",
      reason: "guest",
    };
    sessionStateMock = {
      authenticated: true,
      isGuest: false,
      ok: true,
      status: 200,
    };
    featureAccessStateMock = {
      cloudSyncCapability: {
        enabled: true,
        hasActiveSubscription: true,
        reason: "",
      },
      isGuest: false,
      ok: true,
      status: 200,
    };

    const { initCloudSyncStatusIndicator } = await importIndicatorModule();
    const mount = document.getElementById("mount");
    const indicator = initCloudSyncStatusIndicator({ mount });
    const toggle = mount.querySelector(".cloud-sync-indicator-btn");
    const message = mount.querySelector(".cloud-sync-indicator-copy");
    const subscribeLink = mount.querySelector(".cloud-sync-indicator-link");
    const loginButton = mount.querySelector(".cloud-sync-indicator-action");

    window.dispatchEvent(
      new CustomEvent("vatioboard:backend-auth-state", {
        detail: {
          authenticated: true,
          isGuest: false,
        },
      })
    );
    toggle.click();

    expect(message.textContent).toBe("cloudSyncPanelChecking");
    expect(subscribeLink.hidden).toBe(true);
    expect(loginButton.hidden).toBe(true);

    await flushAsyncWork();

    expect(message.textContent).toBe("cloudSyncPanelSubscriberSynced");
    expect(loginButton.hidden).toBe(true);

    indicator.destroy();
  });
});
