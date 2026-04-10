import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOARD_CURRENT_DOCUMENT_KEY,
  BOARD_DRAWING_KEY,
  BOARD_PENDING_OPEN_DOCUMENT_KEY,
} from "../../src/board/storage.js";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

vi.mock("@jaames/iro", () => ({
  default: {
    ColorPicker: class {
      constructor() {
        this.color = { hexString: "#111111" };
      }

      on() {}
      off() {}
    },
  },
}));

async function flushBoardTasks(iterations = 16) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

function dispatchBoardStroke(canvas, pointerId, clientX, clientY) {
  const pointerDown = new MouseEvent("pointerdown", { bubbles: true, clientX, clientY });
  const pointerUp = new MouseEvent("pointerup", { bubbles: true, clientX, clientY });
  Object.defineProperty(pointerDown, "pointerId", { value: pointerId });
  Object.defineProperty(pointerUp, "pointerId", { value: pointerId });
  canvas.dispatchEvent(pointerDown);
  canvas.dispatchEvent(pointerUp);
}

describe("index.html smoke", () => {
  let sessionUser;
  let hasActiveSubscription;
  let cloudSyncEnabled;
  let mediaAssetsEnabled;
  let mediaAssetsReason;
  let csrfToken;
  let staleBoardDocumentNames;
  let savedBoardDocumentResponse;
  let updatedBoardDocumentResponse;

  beforeEach(async () => {
    vi.resetModules();

    sessionUser = "Guest";
    hasActiveSubscription = false;
    cloudSyncEnabled = false;
    mediaAssetsEnabled = false;
    mediaAssetsReason = "";
    csrfToken = "csrf-test-token";
    staleBoardDocumentNames = new Set();
    savedBoardDocumentResponse = {
      name: "BOARD-DOC-0001",
      title: "Autocross sketch",
      updated_at_ms: 1712163600000,
    };
    updatedBoardDocumentResponse = {
      name: "BOARD-DOC-0001",
      title: "Autocross sketch",
      updated_at_ms: 1712167200000,
    };

    window.fetch = vi.fn(async (input, init = {}) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");

      if (url.endsWith("/api/method/vatiolibre.services.tesla_connection_status")) {
        return new Response(JSON.stringify({
          message: sessionUser === "Guest"
            ? { connected: false, is_guest: true }
            : { connected: false },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/api/method/frappe.auth.get_logged_user")) {
        return new Response(JSON.stringify({ message: sessionUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/api/method/login")) {
        const body = String(init.body || "");
        if (body.includes("usr=test%40vatiolibre.com") && body.includes("pwd=secret123")) {
          sessionUser = "test@vatiolibre.com";
          return new Response(JSON.stringify({ message: "Logged In" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ message: "Invalid login" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/api/method/logout")) {
        sessionUser = "Guest";
        return new Response(JSON.stringify({ message: "Logged out" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/api/method/vatiolibre.vatiolibre.feature_access.get_my_feature_access")) {
        if (sessionUser === "Guest") {
          return new Response(JSON.stringify({ message: "Guest" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          message: {
            has_active_subscription: hasActiveSubscription,
            features: {
              cloud_sync: {
                enabled: cloudSyncEnabled,
              },
              media_assets: {
                enabled: mediaAssetsEnabled,
                reason: mediaAssetsReason,
              },
            },
            csrf_token: csrfToken,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/api/method/vatiolibre.vatiolibre.board_documents.save_my_board_document")) {
        return new Response(JSON.stringify({
          message: {
            document: savedBoardDocumentResponse,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/api/method/vatiolibre.vatiolibre.board_documents.update_my_board_document")) {
        const requestedName = String(init.body?.get?.("name") || "").trim();
        if (staleBoardDocumentNames.has(requestedName)) {
          return new Response(JSON.stringify({
            message: "Board document not found.",
          }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          message: {
            document: updatedBoardDocumentResponse,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await bootHtmlPage("index.html");
  });

  it("boots the board page and mounts its widgets", async () => {
    await import("../../src/board/board.js");
    await flushBoardTasks();

    expectPageSeo({
      title: "Vatio Board – Free Drawing Board + Calculator (Tesla-Friendly)",
      canonical: "https://vatioboard.com/",
    });
    expect(document.documentElement.lang).toBe("en");
    expect(document.getElementById("langToggleMenu").textContent).toBe("EN");
    expect(document.getElementById("pen").getAttribute("aria-label")).toBe("Pen");
    expect(document.querySelector("#pen .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("erase").getAttribute("aria-label")).toBe("Eraser");
    expect(document.querySelector("#erase .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("undo").getAttribute("aria-label")).toBe("Undo");
    expect(document.querySelector("#undo .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("redo").getAttribute("aria-label")).toBe("Redo");
    expect(document.querySelector("#redo .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("undo").disabled).toBe(true);
    expect(document.getElementById("redo").disabled).toBe(true);
    expect(document.getElementById("createNew").getAttribute("aria-label")).toBe("Create new");
    expect(document.querySelector("#createNew .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("save").getAttribute("aria-label")).toBe("Save board document");
    expect(document.querySelector("#deleteBoard .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("deleteBoard").getAttribute("aria-label")).toBe("Delete board document");
    expect(document.querySelector("#save .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("toolsMenuBtn").getAttribute("aria-label")).toBe("Pages");
    expect(document.querySelector("#toolsMenuBtn .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("toolsMenuList").hidden).toBe(false);
    expect(document.getElementById("toolsMenuBtn").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[data-backend-auth]")).toBeTruthy();
    expect(document.querySelector("[data-backend-auth-signup]").getAttribute("href")).toBe("https://www.vatiolibre.com/login#signup");
    expect(document.querySelector("[data-backend-auth-forgot]").getAttribute("href")).toBe("https://www.vatiolibre.com/login#forgot");
    expect(document.getElementById("sizeVal")).toBeNull();
    expect(document.getElementById("sizePreview")).toBeTruthy();
    expect(document.getElementById("colorChip")).toBeNull();
    const sizeLabel = document.querySelector(".size-label");
    expect(sizeLabel).toBeTruthy();
    expect(sizeLabel.tagName).toBe("DIV");
    expect(sizeLabel.getAttribute("role")).toBeNull();
    expect(sizeLabel.children).toHaveLength(3);
    expect(sizeLabel.children[0].id).toBe("sizePreview");
    expect(sizeLabel.children[1].id).toBe("size");
    expect(sizeLabel.children[2].id).toBe("swatches");
    expect(document.querySelector(".size-label #swatches")).toBeTruthy();
    expect(document.getElementById("sizePreview").style.getPropertyValue("--board-size-preview")).toBe("6px");
    expect(document.querySelector(".calc-panel")).toBeTruthy();
    expect(document.querySelector(".energy-panel")).toBeTruthy();
    expect(document.querySelector(".floating-dock")).toBeTruthy();
    expect(document.querySelector(".canvas-frame .board-canvas-meta")).toBeTruthy();
    expect(document.querySelector("header .board-canvas-meta")).toBeNull();
    expect(document.querySelector("[data-backend-auth]").dataset.authState).toBe("guest");
    expect(document.querySelector("[data-backend-auth-status]").textContent).toBe("Signed out");
    expect(document.querySelector("[data-backend-auth-logout]").hidden).toBe(true);
    expect(document.querySelector("[data-backend-auth-signup]").hidden).toBe(false);
    expect(document.querySelector("[data-backend-auth-forgot]").hidden).toBe(false);
    expect(window.fetch).not.toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/frappe.auth.get_logged_user",
      expect.anything()
    );

    document.getElementById("size").value = "12";
    document.getElementById("size").dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.getElementById("sizePreview").style.getPropertyValue("--board-size-preview")).toBe("12px");

    document.getElementById("erase").click();
    expect(document.getElementById("erase").getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("colorPopup").hidden).toBe(true);
    document.querySelector('#swatches .swatch')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("colorPopup").hidden).toBe(true);
    expect(document.getElementById("pen").getAttribute("aria-pressed")).toBe("true");

    document.getElementById("sizePreview").click();
    expect(document.getElementById("colorPopup").hidden).toBe(false);

    document.getElementById("erase").click();
    expect(document.getElementById("erase").getAttribute("aria-pressed")).toBe("true");
    document.getElementById("size").value = "10";
    document.getElementById("size").dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.getElementById("pen").getAttribute("aria-pressed")).toBe("true");

    const canvas = document.getElementById("pad");
    const pointerDown = new MouseEvent("pointerdown", { bubbles: true, clientX: 12, clientY: 12 });
    const pointerMove = new MouseEvent("pointermove", { bubbles: true, clientX: 42, clientY: 32 });
    const pointerUp = new MouseEvent("pointerup", { bubbles: true, clientX: 42, clientY: 32 });
    Object.defineProperty(pointerDown, "pointerId", { value: 1 });
    Object.defineProperty(pointerMove, "pointerId", { value: 1 });
    Object.defineProperty(pointerUp, "pointerId", { value: 1 });

    canvas.dispatchEvent(pointerDown);
    expect(document.getElementById("toolsMenuList").hidden).toBe(true);
    canvas.dispatchEvent(pointerMove);
    canvas.dispatchEvent(pointerUp);

    expect(document.getElementById("undo").disabled).toBe(false);
    expect(document.getElementById("redo").disabled).toBe(true);

    document.getElementById("undo").click();
    expect(document.getElementById("status").textContent).toBe("Undo");
    expect(document.getElementById("undo").disabled).toBe(true);
    expect(document.getElementById("redo").disabled).toBe(false);

    document.getElementById("redo").click();
    expect(document.getElementById("status").textContent).toBe("Redo");
    expect(document.getElementById("undo").disabled).toBe(false);
    expect(document.getElementById("redo").disabled).toBe(true);

    document.getElementById("openCalc").click();
    expect(document.querySelector(".calc-panel").hidden).toBe(false);

    const authUser = document.querySelector("[data-backend-auth-user]");
    const authPassword = document.querySelector("[data-backend-auth-password]");
    const authForm = document.querySelector("[data-backend-auth]");

    authUser.value = "test@vatiolibre.com";
    authPassword.value = "secret123";
    authForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushBoardTasks();

    expect(document.querySelector("[data-backend-auth]").dataset.authState).toBe("authenticated");
    expect(document.querySelector("[data-backend-auth-status]").textContent).toBe("Signed in as test@vatiolibre.com");
    expect(document.querySelector("[data-backend-auth-user]").hidden).toBe(true);
    expect(document.querySelector("[data-backend-auth-logout]").hidden).toBe(false);
    expect(document.querySelector("[data-backend-auth-signup]").hidden).toBe(true);
    expect(document.querySelector("[data-backend-auth-forgot]").hidden).toBe(true);

    document.querySelector("[data-backend-auth-logout]").click();
    await flushBoardTasks();

    expect(document.querySelector("[data-backend-auth]").dataset.authState).toBe("guest");
    expect(document.querySelector("[data-backend-auth-status]").textContent).toBe("Signed out");
    expect(document.querySelector("[data-backend-auth-user]").hidden).toBe(false);
    expect(window.fetch).toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: "usr=test%40vatiolibre.com&pwd=secret123",
      })
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );

    document.getElementById("langToggleMenu").click();
    expect(document.documentElement.lang).toBe("es");
    expect(document.getElementById("langToggle").textContent).toBe("ES");
    expect(document.getElementById("langToggleMenu").textContent).toBe("ES");
    expect(document.querySelector(".backend-auth-title").textContent).toBe("Cuenta de VatioLibre");
  });

  it("keeps drawing locked to one pointer and suppresses native selection", async () => {
    await import("../../src/board/board.js");
    await flushBoardTasks();

    const canvas = document.getElementById("pad");
    const ctx = canvas.getContext("2d");
    ctx.quadraticCurveTo.mockClear();

    const selectStart = new Event("selectstart", { bubbles: true, cancelable: true });
    expect(canvas.dispatchEvent(selectStart)).toBe(false);

    const pointerDown = new MouseEvent("pointerdown", { bubbles: true, clientX: 12, clientY: 12 });
    Object.defineProperty(pointerDown, "pointerId", { value: 1 });
    canvas.dispatchEvent(pointerDown);

    expect(document.body.classList.contains("board-is-drawing")).toBe(true);

    const foreignMove = new MouseEvent("pointermove", { bubbles: true, clientX: 60, clientY: 60 });
    Object.defineProperty(foreignMove, "pointerId", { value: 2 });
    canvas.dispatchEvent(foreignMove);
    expect(ctx.quadraticCurveTo).not.toHaveBeenCalled();

    const activeMove = new MouseEvent("pointermove", { bubbles: true, clientX: 42, clientY: 32 });
    Object.defineProperty(activeMove, "pointerId", { value: 1 });
    canvas.dispatchEvent(activeMove);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(1);

    const selectWhileDrawing = new Event("selectstart", { bubbles: true, cancelable: true });
    expect(document.dispatchEvent(selectWhileDrawing)).toBe(false);

    const lostCapture = new Event("lostpointercapture", { bubbles: true });
    Object.defineProperty(lostCapture, "pointerId", { value: 1 });
    canvas.dispatchEvent(lostCapture);

    expect(document.body.classList.contains("board-is-drawing")).toBe(false);
    expect(document.getElementById("undo").disabled).toBe(false);
  });

  it("cancels an active stroke before redoing history", async () => {
    await import("../../src/board/board.js");
    await flushBoardTasks();

    const canvas = document.getElementById("pad");
    dispatchBoardStroke(canvas, 1, 24, 24);

    document.getElementById("undo").click();
    await flushBoardTasks();
    expect(document.getElementById("redo").disabled).toBe(false);

    const pointerDown = new MouseEvent("pointerdown", { bubbles: true, clientX: 48, clientY: 48 });
    Object.defineProperty(pointerDown, "pointerId", { value: 2 });
    canvas.dispatchEvent(pointerDown);
    expect(document.body.classList.contains("board-is-drawing")).toBe(true);

    document.getElementById("redo").click();
    expect(document.body.classList.contains("board-is-drawing")).toBe(false);
    expect(document.getElementById("redo").disabled).toBe(true);

    const pointerUp = new MouseEvent("pointerup", { bubbles: true, clientX: 48, clientY: 48 });
    Object.defineProperty(pointerUp, "pointerId", { value: 2 });
    canvas.dispatchEvent(pointerUp);

    document.getElementById("undo").click();
    expect(document.getElementById("undo").disabled).toBe(true);
    expect(document.getElementById("redo").disabled).toBe(false);
  });

  it("restores large saved drafts after reload without dropping older strokes", async () => {
    await import("../../src/board/board.js");
    await flushBoardTasks();

    const canvas = document.getElementById("pad");
    const ctx = canvas.getContext("2d");
    ctx.fillRect.mockClear();
    ctx.drawImage.mockClear();

    for (let index = 0; index < 125; index += 1) {
      dispatchBoardStroke(canvas, index + 1, 12 + (index % 40), 18 + (index % 50));
    }

    await flushBoardTasks();

    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledTimes(125);

    const storedBeforeReload = JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY));
    expect(storedBeforeReload.commandCount).toBe(125);
    expect(storedBeforeReload.commands).toHaveLength(125);

    vi.resetModules();
    await bootHtmlPage("index.html");
    await import("../../src/board/board.js");
    await flushBoardTasks();

    expect(document.getElementById("undo").disabled).toBe(false);

    document.getElementById("undo").click();
    await flushBoardTasks();

    const storedAfterUndo = JSON.parse(localStorage.getItem(BOARD_DRAWING_KEY));
    expect(storedAfterUndo.commandCount).toBe(124);
    expect(storedAfterUndo.redoCount).toBe(1);
  });

  it("guides guests to log in before saving", async () => {
    await import("../../src/board/board.js");
    await flushBoardTasks();

    document.getElementById("toolsMenuBtn").click();
    expect(document.getElementById("toolsMenuList").hidden).toBe(true);

    document.getElementById("save").click();
    await flushBoardTasks();

    expect(document.getElementById("toolsMenuList").hidden).toBe(false);
    expect(document.getElementById("status").textContent).toBe("Log in to save board documents to VatioLibre.");
  });

  it("blocks save for signed-in users without cloud sync feature", async () => {
    sessionUser = "member@vatiolibre.com";
    hasActiveSubscription = false;
    cloudSyncEnabled = false;

    await import("../../src/board/board.js");
    await flushBoardTasks();

    document.getElementById("save").click();
    await flushBoardTasks();

    expect(window.fetch).toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.feature_access.get_my_feature_access",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      })
    );
    expect(window.fetch).not.toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.board_documents.save_my_board_document",
      expect.anything()
    );
  });

  it("blocks board save when media_assets is enabled but cloud_sync is not", async () => {
    sessionUser = "media-only@vatiolibre.com";
    hasActiveSubscription = true;
    cloudSyncEnabled = false;
    mediaAssetsEnabled = true;

    await import("../../src/board/board.js");
    await flushBoardTasks();

    document.getElementById("save").click();
    await flushBoardTasks();

    expect(window.fetch).not.toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.board_documents.save_my_board_document",
      expect.anything()
    );
  });

  it("saves a board document for active subscribers via the Save button", async () => {
    sessionUser = "member@vatiolibre.com";
    hasActiveSubscription = true;
    cloudSyncEnabled = true;
    mediaAssetsEnabled = true;
    csrfToken = "csrf-active-token";

    await import("../../src/board/board.js");
    await flushBoardTasks();

    // Click Save — triggers async access check then prompt dialog
    document.getElementById("save").click();

    // Wait for access check + dialog rendering
    for (let i = 0; i < 30; i += 1) await flushTasks();

    // Fill and confirm the prompt dialog
    const promptInput = document.querySelector(".vb-confirm-card input");
    const confirmBtn = document.querySelector(".vb-confirm-card .vb-confirm-btn--confirm");
    expect(promptInput).toBeTruthy();
    expect(confirmBtn).toBeTruthy();
    promptInput.value = "My board";
    promptInput.dispatchEvent(new Event("input", { bubbles: true }));
    confirmBtn.click();

    for (let i = 0; i < 30; i += 1) await flushTasks();

    expect(window.fetch).toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.board_documents.save_my_board_document",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });

  it("saves a new board document and updates it on the next save", async () => {
    sessionUser = "board-docs@vatiolibre.com";
    hasActiveSubscription = true;
    cloudSyncEnabled = true;
    mediaAssetsEnabled = true;

    await import("../../src/board/board.js");
    await flushBoardTasks();

    const canvas = document.getElementById("pad");
    dispatchBoardStroke(canvas, 7, 120, 160);
    await flushBoardTasks();

    // Click Save — triggers prompt dialog for title
    document.getElementById("save").click();
    for (let i = 0; i < 30; i += 1) await flushTasks();

    const promptInput = document.querySelector(".vb-confirm-card input");
    const confirmBtn = document.querySelector(".vb-confirm-card .vb-confirm-btn--confirm");
    expect(promptInput).toBeTruthy();
    expect(confirmBtn).toBeTruthy();
    promptInput.value = "Autocross sketch";
    promptInput.dispatchEvent(new Event("input", { bubbles: true }));
    confirmBtn.click();

    for (let i = 0; i < 30; i += 1) await flushTasks();

    expect(window.fetch).toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.board_documents.save_my_board_document",
      expect.anything()
    );
    expect(JSON.parse(localStorage.getItem("vatio_board_document_current_v1"))).toMatchObject({
      name: "BOARD-DOC-0001",
      title: "Autocross sketch",
    });

    dispatchBoardStroke(canvas, 8, 180, 210);
    await flushBoardTasks();

    // Second save — should update (no prompt needed since already named)
    document.getElementById("save").click();
    for (let i = 0; i < 30; i += 1) await flushTasks();

    expect(window.fetch).toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.board_documents.update_my_board_document",
      expect.anything()
    );
  });

  it("opens an empty pending cloud board document and keeps it current for updates", async () => {
    sessionUser = "board-docs@vatiolibre.com";
    hasActiveSubscription = true;
    cloudSyncEnabled = true;
    mediaAssetsEnabled = true;

    localStorage.setItem(BOARD_PENDING_OPEN_DOCUMENT_KEY, JSON.stringify({
      document: {
        name: "BOARD-DOC-EMPTY",
        title: "Blank sketch",
        updated_at_ms: 1712163600000,
      },
      payload: {
        updatedAtMs: 1712163600000,
        commands: [],
        redoCommands: [],
      },
    }));

    await import("../../src/board/board.js");
    await flushBoardTasks();

    expect(JSON.parse(localStorage.getItem(BOARD_CURRENT_DOCUMENT_KEY))).toMatchObject({
      name: "BOARD-DOC-EMPTY",
      title: "Blank sketch",
    });
    expect(document.getElementById("status").textContent).toBe('Opened board document "Blank sketch"');

    const pushCall = window.fetch.mock.calls.find(([url]) =>
      url === "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.cloud_sync.push_my_sync_changes"
    );
    expect(pushCall).toBeUndefined();

    // Save should update existing (no title prompt for named documents)
    document.getElementById("save").click();
    await flushBoardTasks();

    expect(window.fetch).toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.board_documents.update_my_board_document",
      expect.anything()
    );
  });

  it("falls back to creating a new board document when the stored remote document is stale", async () => {
    sessionUser = "board-docs@vatiolibre.com";
    hasActiveSubscription = true;
    cloudSyncEnabled = true;
    mediaAssetsEnabled = true;
    staleBoardDocumentNames.add("BOARD-DOC-STALE");
    savedBoardDocumentResponse = {
      name: "BOARD-DOC-0002",
      title: "Recovered sketch",
      updated_at_ms: 1712169000000,
    };

    localStorage.setItem(BOARD_CURRENT_DOCUMENT_KEY, JSON.stringify({
      name: "BOARD-DOC-STALE",
      title: "Recovered sketch",
      updatedAtMs: 1712163600000,
    }));

    await import("../../src/board/board.js");
    await flushBoardTasks();

    const canvas = document.getElementById("pad");
    dispatchBoardStroke(canvas, 9, 160, 190);
    await flushBoardTasks();

    document.getElementById("save").click();
    for (let i = 0; i < 30; i += 1) await flushTasks();

    expect(window.fetch).toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.board_documents.update_my_board_document",
      expect.anything()
    );
    expect(window.fetch).toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.board_documents.save_my_board_document",
      expect.anything()
    );
    expect(JSON.parse(localStorage.getItem(BOARD_CURRENT_DOCUMENT_KEY))).toMatchObject({
      name: "BOARD-DOC-0002",
      title: "Recovered sketch",
    });
  });
});
