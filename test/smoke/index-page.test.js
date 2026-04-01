import { beforeEach, describe, expect, it, vi } from "vitest";
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

async function flushBoardTasks(iterations = 8) {
  for (let index = 0; index < iterations; index += 1) {
    await flushTasks();
  }
}

describe("index.html smoke", () => {
  let sessionUser;
  let hasActiveSubscription;
  let savedDrawingsEnabled;
  let savedDrawingsReason;
  let csrfToken;

  beforeEach(async () => {
    vi.resetModules();

    sessionUser = "Guest";
    hasActiveSubscription = false;
    savedDrawingsEnabled = false;
    savedDrawingsReason = "";
    csrfToken = "csrf-test-token";

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
              saved_drawings: {
                enabled: savedDrawingsEnabled,
                reason: savedDrawingsReason,
              },
            },
            csrf_token: csrfToken,
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.endsWith("/api/method/vatiolibre.vatiolibre.drawings.save_my_saved_drawing")) {
        if (sessionUser === "Guest") {
          return new Response(JSON.stringify({ message: "Guest" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({
          message: {
            drawing: {
              name: "DRAW-0001",
            },
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
    expect(document.getElementById("clear").getAttribute("aria-label")).toBe("Clear");
    expect(document.querySelector("#clear .btn-icon svg")).toBeTruthy();
    expect(document.getElementById("save").getAttribute("aria-label")).toBe("Save to VatioLibre");
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

  it("guides guests to log in before saving", async () => {
    await import("../../src/board/board.js");
    await flushBoardTasks();

    document.getElementById("toolsMenuBtn").click();
    expect(document.getElementById("toolsMenuList").hidden).toBe(true);

    document.getElementById("save").click();
    await flushBoardTasks();

    expect(document.getElementById("toolsMenuList").hidden).toBe(false);
    expect(document.getElementById("status").textContent).toBe("Log in to save drawings to VatioLibre.");
    expect(window.fetch).not.toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.feature_access.get_my_feature_access",
      expect.anything()
    );
  });

  it("blocks save for signed-in users without the saved drawings feature", async () => {
    sessionUser = "member@vatiolibre.com";
    hasActiveSubscription = false;
    savedDrawingsEnabled = false;
    savedDrawingsReason = "Saved drawings need an active VatioLibre subscription.";

    await import("../../src/board/board.js");
    await flushBoardTasks();

    document.getElementById("save").click();
    await flushBoardTasks();

    expect(document.getElementById("status").textContent).toBe("Saved drawings need an active VatioLibre subscription.");
    expect(window.fetch).toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.feature_access.get_my_feature_access",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      })
    );
    expect(window.fetch).not.toHaveBeenCalledWith(
      "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.drawings.save_my_saved_drawing",
      expect.anything()
    );
  });

  it("saves drawings to the backend for active subscribers", async () => {
    sessionUser = "member@vatiolibre.com";
    hasActiveSubscription = true;
    savedDrawingsEnabled = true;
    savedDrawingsReason = "";
    csrfToken = "csrf-active-token";

    await import("../../src/board/board.js");
    await flushBoardTasks();

    document.getElementById("save").click();
    await flushBoardTasks();

    expect(document.getElementById("status").textContent).toBe("Saved to VatioLibre");
    const saveCall = window.fetch.mock.calls.find(([url]) =>
      url === "https://api.vatioboard.com/api/method/vatiolibre.vatiolibre.drawings.save_my_saved_drawing"
    );

    expect(saveCall).toBeTruthy();

    const [, saveRequest] = saveCall;
    expect(saveRequest).toEqual(expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({
        "X-Frappe-CSRF-Token": "csrf-active-token",
      }),
    }));
    expect(saveRequest.headers["Content-Type"]).toBeUndefined();
    expect(saveRequest.body).toBeInstanceOf(FormData);
    expect(saveRequest.body.get("image_width")).toBe("320");
    expect(saveRequest.body.get("image_height")).toBe("320");

    const uploadedFile = saveRequest.body.get("file");
    expect(uploadedFile).toBeInstanceOf(File);
    expect(uploadedFile.name).toBe("drawing.png");
    expect(uploadedFile.type).toBe("image/png");
  });
});
