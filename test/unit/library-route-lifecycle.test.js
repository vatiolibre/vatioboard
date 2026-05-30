import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushTasks } from "../helpers/page-smoke.js";

const backendAuthMocks = vi.hoisted(() => ({
  getBackendSessionState: vi.fn(async () => ({
    authenticated: false,
    isGuest: true,
    ok: false,
    status: 0,
  })),
  fetchBackendLoggedUser: vi.fn(async () => null),
  getBackendFeatureAccessState: vi.fn(async () => ({ ok: false })),
  initBackendAuthControllers: vi.fn(),
  startSubscriptionSso: vi.fn(() => false),
  buildMediaBffUrl: vi.fn(() => ""),
  deleteBoardDocumentFromBackend: vi.fn(async () => ({ ok: true })),
  deleteMediaAssetFromBackend: vi.fn(async () => ({ ok: true })),
  deleteSyncRecordFromBackend: vi.fn(async () => ({ ok: true })),
  fetchBackendMediaAssetBlob: vi.fn(async () => new Response("", { status: 404 })),
  getBackendMediaAssetAccess: vi.fn(async () => ({ access: null })),
  getProtectedMediaRequestGate: vi.fn(async () => ({
    allowed: false,
    cleanup: vi.fn(),
    signal: new AbortController().signal,
  })),
  updateBoardDocumentInBackend: vi.fn(async () => ({ ok: true })),
  updateMediaAssetInBackend: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../src/shared/backend-auth.js", () => ({
  BACKEND_AUTH_SIGNUP_URL: "https://www.vatiolibre.com/login#signup",
  BACKEND_AUTH_STATE_EVENT: "vatioboard:backend-auth-state",
  getSsoSubscribeUrl: vi.fn(() => "https://www.vatiolibre.com/subscribe"),
  getVatioLibreSubscribeUrl: vi.fn(() => "https://www.vatiolibre.com/subscribe"),
  ...backendAuthMocks,
}));

async function settleLibraryTasks(iterations = 8) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

function selectedTab() {
  return document.querySelector(".library-tab[aria-selected='true']")?.dataset.tab || "";
}

async function mountLibraryWithRuntime({ hash = "#/library", runtimeTab = "" } = {}) {
  window.history.replaceState({}, "", `https://vatioboard.com/${hash}`);
  const { appRegistry, createAppRuntime } = await import("../../src/app-platform/index.js");
  const { mount } = await import("../../src/app/views/LibraryView.js");
  const manifest = appRegistry.getApp("vatio.library");
  const runtime = createAppRuntime({ manifest, baseContext: {} });
  if (runtimeTab) runtime.services.settings.set("activeTab", runtimeTab);
  const root = document.getElementById("root");

  const mounted = await mount(root, {
    appRuntime: runtime,
    appManifest: manifest,
    routeSignal: new AbortController().signal,
  });
  await settleLibraryTasks();

  return { mounted, runtime };
}

describe("Library route lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.head.innerHTML = '<meta name="description" content="Library test">';
    document.body.innerHTML = '<main id="root"></main>';
    window.__vatioboardSpa = true;
    backendAuthMocks.getBackendSessionState.mockClear();
    backendAuthMocks.fetchBackendLoggedUser.mockClear();
    backendAuthMocks.getBackendFeatureAccessState.mockClear();
  });

  it("keeps the route query tab canonical while mirroring to runtime settings", async () => {
    const { mounted } = await mountLibraryWithRuntime({
      hash: "#/library?tab=speed",
      runtimeTab: "media",
    });

    expect(selectedTab()).toBe("speed");
    expect(localStorage.getItem("vatioboard.app.vatio.library.settings.activeTab")).toBe("speed");

    mounted.unmount();
  }, 40000);

  it("seeds the active tab from runtime settings only when no route query tab exists", async () => {
    const { mounted } = await mountLibraryWithRuntime({
      hash: "#/library",
      runtimeTab: "media",
    });

    expect(selectedTab()).toBe("media");
    expect(localStorage.getItem("vatioboard.app.vatio.library.settings.activeTab")).toBe("media");

    mounted.unmount();
  }, 40000);

  it("preserves direct route callers without runtime settings", async () => {
    window.history.replaceState({}, "", "https://vatioboard.com/#/library?tab=board_documents");
    const { mount } = await import("../../src/app/views/LibraryView.js");
    const root = document.getElementById("root");

    const mounted = await mount(root, {
      routeSignal: new AbortController().signal,
    });
    await settleLibraryTasks();

    expect(selectedTab()).toBe("board_documents");
    expect(localStorage.getItem("vatioboard.app.vatio.library.settings.activeTab")).toBeNull();

    mounted.unmount();
  }, 40000);
});
