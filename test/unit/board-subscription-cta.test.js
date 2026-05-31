import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushTasks } from "../helpers/page-smoke.js";

const backendAuthMocks = vi.hoisted(() => ({
  deleteBoardDocumentFromBackend: vi.fn(),
  getBackendFeatureAccessState: vi.fn(),
  getBackendSessionState: vi.fn(),
  initBackendAuthControllers: vi.fn(),
  saveBoardDocumentToBackend: vi.fn(),
  startSubscriptionSso: vi.fn(() => true),
  updateBoardDocumentInBackend: vi.fn(),
}));

const boardStorageMocks = vi.hoisted(() => ({
  clearCurrentBoardDocumentMeta: vi.fn(),
  consumePendingBoardDocumentOpen: vi.fn(() => null),
  hasBoardDrawingContent: vi.fn(() => false),
  loadBoardDrawing: vi.fn(async () => ({
    commands: [],
    redoCommands: [],
    updatedAtMs: 0,
  })),
  loadCurrentBoardDocumentMeta: vi.fn(() => null),
  saveBoardDrawing: vi.fn(async () => {}),
  saveCurrentBoardDocumentMeta: vi.fn(),
}));

vi.mock("../../src/shared/backend-auth.js", async () => {
  const actual = await vi.importActual("../../src/shared/backend-auth.js");
  return {
    ...actual,
    deleteBoardDocumentFromBackend: backendAuthMocks.deleteBoardDocumentFromBackend,
    getBackendFeatureAccessState: backendAuthMocks.getBackendFeatureAccessState,
    getBackendSessionState: backendAuthMocks.getBackendSessionState,
    initBackendAuthControllers: backendAuthMocks.initBackendAuthControllers,
    saveBoardDocumentToBackend: backendAuthMocks.saveBoardDocumentToBackend,
    startSubscriptionSso: backendAuthMocks.startSubscriptionSso,
    updateBoardDocumentInBackend: backendAuthMocks.updateBoardDocumentInBackend,
  };
});

vi.mock("../../src/board/storage.js", () => boardStorageMocks);

vi.mock("../../src/shared/cloud-sync.js", () => ({
  CLOUD_SYNC_APPLIED_EVENT: "vatioboard:cloud-sync-applied",
  CLOUD_SYNC_ENTITY_TYPES: {
    accelRun: "accel_run",
    boardDrawing: "board_drawing",
    replaySession: "replay_session",
  },
  queueCloudSyncChange: vi.fn(async () => true),
}));

vi.mock("../../src/shared/cloud-library-resources.js", () => ({
  CLOUD_LIBRARY_TAB_KEYS: {
    boardDocuments: "board_documents",
  },
  cloudLibraryResources: {
    board_documents: {
      resource: {
        invalidateList: vi.fn(),
      },
    },
  },
}));

async function settle(iterations = 12) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

async function mountBoard() {
  const { mount } = await import("../../src/app/views/BoardView.js");
  const root = document.getElementById("root");
  const mounted = await mount(root, {
    routeSignal: new AbortController().signal,
  });
  await settle();
  return { mounted, root };
}

function setAuthenticatedSession() {
  backendAuthMocks.getBackendSessionState.mockResolvedValue({
    authenticated: true,
    isGuest: false,
    ok: true,
    status: 200,
  });
}

describe("Board subscription CTA", () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = '<meta name="description" content="Board subscription test">';
    document.body.innerHTML = '<main id="root"></main>';
    window.__vatioboardSpa = true;
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardStartMenu;

    Object.values(backendAuthMocks).forEach((mock) => mock.mockClear?.());
    backendAuthMocks.startSubscriptionSso.mockReturnValue(true);
    backendAuthMocks.updateBoardDocumentInBackend.mockResolvedValue({
      ok: true,
      status: 200,
      document: {
        name: "BOARD-1",
        title: "Saved board",
        updated_at_ms: Date.now(),
      },
    });
    backendAuthMocks.saveBoardDocumentToBackend.mockResolvedValue({
      ok: true,
      status: 200,
      document: {
        name: "BOARD-1",
        title: "Saved board",
        updated_at_ms: Date.now(),
      },
    });

    boardStorageMocks.clearCurrentBoardDocumentMeta.mockClear();
    boardStorageMocks.consumePendingBoardDocumentOpen.mockClear();
    boardStorageMocks.hasBoardDrawingContent.mockClear();
    boardStorageMocks.loadBoardDrawing.mockReset();
    boardStorageMocks.loadBoardDrawing.mockResolvedValue({
      commands: [],
      redoCommands: [],
      updatedAtMs: 0,
    });
    boardStorageMocks.loadCurrentBoardDocumentMeta.mockReset();
    boardStorageMocks.loadCurrentBoardDocumentMeta.mockReturnValue(null);
    boardStorageMocks.saveBoardDrawing.mockClear();
    boardStorageMocks.saveCurrentBoardDocumentMeta.mockClear();
  });

  it("keeps guest save attempts on the login/auth flow", async () => {
    const startMenuList = document.createElement("div");
    const authInput = document.createElement("input");
    authInput.dataset.backendAuthUser = "";
    startMenuList.append(authInput);
    document.body.append(startMenuList);
    window.__vatioboardStartMenu = {
      bindTrigger: vi.fn(),
      close: vi.fn(),
      list: startMenuList,
      setOpen: vi.fn(),
    };
    backendAuthMocks.getBackendSessionState.mockResolvedValue({
      authenticated: false,
      isGuest: true,
      ok: true,
      status: 200,
    });

    const { mounted, root } = await mountBoard();
    root.querySelector("#save").click();
    await settle();

    expect(root.querySelector("#status").textContent).toBe("Log in to save board documents to VatioLibre.");
    expect(root.querySelector("#subscriptionCta").hidden).toBe(true);
    expect(window.__vatioboardStartMenu.setOpen).toHaveBeenCalledWith(true);
    expect(document.activeElement).toBe(authInput);
    expect(backendAuthMocks.startSubscriptionSso).not.toHaveBeenCalled();

    mounted.unmount();
  });

  it("shows an activation CTA for authenticated users without an active subscription", async () => {
    setAuthenticatedSession();
    backendAuthMocks.getBackendFeatureAccessState.mockResolvedValue({
      cloudSyncCapability: {
        enabled: false,
        hasActiveSubscription: false,
        reason: "",
      },
      featureAccess: {
        has_active_subscription: false,
      },
      isGuest: false,
      ok: true,
      status: 200,
    });

    const { mounted, root } = await mountBoard();
    const cta = root.querySelector("#subscriptionCta");

    root.querySelector("#save").click();
    await settle();

    expect(root.querySelector("#status").textContent).toBe("Saving board documents requires an active subscription.");
    expect(cta.hidden).toBe(false);
    expect(cta.textContent.trim()).toBe("Activate subscription");

    cta.click();
    expect(backendAuthMocks.startSubscriptionSso).toHaveBeenCalledTimes(1);

    mounted.unmount();
  });

  it("does not show the activation CTA when active subscription access can save", async () => {
    boardStorageMocks.loadCurrentBoardDocumentMeta.mockReturnValue({
      name: "BOARD-1",
      title: "Saved board",
    });
    setAuthenticatedSession();
    backendAuthMocks.getBackendFeatureAccessState.mockResolvedValue({
      cloudSyncCapability: {
        csrfToken: "csrf-token",
        enabled: true,
        hasActiveSubscription: true,
        reason: "",
      },
      featureAccess: {
        has_active_subscription: true,
      },
      isGuest: false,
      ok: true,
      status: 200,
    });

    const { mounted, root } = await mountBoard();

    root.querySelector("#save").click();
    await settle(20);

    expect(root.querySelector("#subscriptionCta").hidden).toBe(true);
    expect(backendAuthMocks.updateBoardDocumentInBackend).toHaveBeenCalledTimes(1);
    expect(backendAuthMocks.startSubscriptionSso).not.toHaveBeenCalled();

    mounted.unmount();
  });

  it("does not show the activation CTA when backend feature access is unavailable", async () => {
    setAuthenticatedSession();
    backendAuthMocks.getBackendFeatureAccessState.mockResolvedValue({
      cloudSyncCapability: {
        enabled: false,
        hasActiveSubscription: false,
        reason: "subscription required",
      },
      featureAccess: null,
      isGuest: false,
      ok: false,
      status: 503,
    });

    const { mounted, root } = await mountBoard();

    root.querySelector("#save").click();
    await settle();

    expect(root.querySelector("#status").textContent).toBe("Could not verify save access (503)");
    expect(root.querySelector("#subscriptionCta").hidden).toBe(true);
    expect(backendAuthMocks.startSubscriptionSso).not.toHaveBeenCalled();

    mounted.unmount();
  });
});
