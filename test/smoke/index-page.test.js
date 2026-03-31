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

describe("index.html smoke", () => {
  beforeEach(async () => {
    vi.resetModules();

    let sessionUser = "Guest";
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

      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await bootHtmlPage("index.html");
  });

  it("boots the board page and mounts its widgets", async () => {
    await import("../../src/board/board.js");
    await flushTasks();

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
    expect(document.getElementById("save").getAttribute("aria-label")).toBe("Save PNG");
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

    document.getElementById("sizePreview").click();
    expect(document.getElementById("colorPopup").hidden).toBe(false);
    document.getElementById("erase").click();
    expect(document.getElementById("erase").getAttribute("aria-pressed")).toBe("true");
    document.querySelector('#swatches .swatch')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.getElementById("pen").getAttribute("aria-pressed")).toBe("true");
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
    await flushTasks();
    await flushTasks();
    await flushTasks();
    await flushTasks();
    await flushTasks();
    await flushTasks();

    expect(document.querySelector("[data-backend-auth]").dataset.authState).toBe("authenticated");
    expect(document.querySelector("[data-backend-auth-status]").textContent).toBe("Signed in as test@vatiolibre.com");
    expect(document.querySelector("[data-backend-auth-user]").hidden).toBe(true);
    expect(document.querySelector("[data-backend-auth-logout]").hidden).toBe(false);
    expect(document.querySelector("[data-backend-auth-signup]").hidden).toBe(true);
    expect(document.querySelector("[data-backend-auth-forgot]").hidden).toBe(true);

    document.querySelector("[data-backend-auth-logout]").click();
    await flushTasks();
    await flushTasks();
    await flushTasks();
    await flushTasks();
    await flushTasks();
    await flushTasks();

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
});
