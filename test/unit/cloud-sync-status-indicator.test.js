import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const INDICATOR_MODULE = "../../src/shared/cloud-sync-status-indicator.js";
const I18N_MODULE = "../../src/i18n.js";
const BACKEND_AUTH_MODULE = "../../src/shared/backend-auth.js";
const CLOUD_SYNC_MODULE = "../../src/shared/cloud-sync.js";

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
      return {
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
    vi.doMock(BACKEND_AUTH_MODULE, () => ({
      BACKEND_AUTH_SIGNUP_URL: "https://example.com/signup",
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
});
