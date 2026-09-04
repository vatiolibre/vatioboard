import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootHtmlPage, expectPageSeo, flushTasks } from "../helpers/page-smoke.js";

const WELCOME_CONSENT_KEY = "vatioboard.welcome_consent.v1";

const routeState = vi.hoisted(() => ({
  mounted: [],
  unmounted: [],
  events: [],
  deferredLoads: new Map(),
  createPlayerWidget: vi.fn(() => ({
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    restoreVisibility: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock("../../src/app/routes.js", () => ({
  routes: ["/", "/library", "/accel"].map((path) => {
    const name = path === "/" ? "speed" : path.slice(1);
    const loadedRoute = {
      mount(root) {
        routeState.mounted.push(name);
        routeState.events.push(`mount:${name}`);
        const view = document.createElement("section");
        view.dataset.mockView = name;
        view.textContent = name;
        root.replaceChildren(view);
        return {
          unmount() {
            routeState.unmounted.push(name);
            routeState.events.push(`unmount:${name}`);
            root.replaceChildren();
          },
        };
      },
    };
    return {
      path,
      aliases: path === "/" ? ["/speed"] : [],
      load: () => routeState.deferredLoads.get(path)?.promise.then(() => loadedRoute) || Promise.resolve(loadedRoute),
    };
  }),
}));

vi.mock("../../src/player/player-widget.js", () => ({
  createPlayerWidget: routeState.createPlayerWidget,
}));

vi.mock("../../src/shared/backend-auth.js", () => ({
  BACKEND_AUTH_REQUEST_EVENT: "vatioboard:backend-auth-request",
  BACKEND_AUTH_STATE_EVENT: "vatioboard:backend-auth-state",
  createBackendAuthController: vi.fn(() => ({ refreshSession: vi.fn(), destroy: vi.fn() })),
  getBackendAuthStateSnapshot: vi.fn(() => ({
    authenticated: false,
    busy: false,
    isGuest: true,
    pendingLogout: false,
    user: null,
  })),
  initBackendAuthControllers: vi.fn(),
}));

vi.mock("../../src/shared/cloud-sync.js", () => ({
  startCloudSyncLoop: vi.fn(),
}));

vi.mock("../../src/shared/single-tab.js", () => ({
  ensureSingleTabOwnership: vi.fn(() => Promise.resolve(true)),
}));

async function bootSpa() {
  seedWelcomeConsent();
  await bootHtmlPage("index.html");
  await import("../../src/app/main.js");
  for (let index = 0; index < 8; index += 1) {
    await flushTasks();
  }
}

async function navigateSpa(path) {
  const { navigateToAppRoute } = await import("../../src/app/router.js");
  navigateToAppRoute(path);
  for (let index = 0; index < 8; index += 1) await flushTasks();
}

function seedWelcomeConsent(locationChoice = "enabled") {
  localStorage.setItem(
    WELCOME_CONSENT_KEY,
    JSON.stringify({
      accepted: true,
      acceptedAtMs: Date.now(),
      locationChoice,
      version: 1,
    }),
  );
}

async function acceptWelcomeWithoutLocation() {
  const checkbox = document.querySelector(".vb-welcome-checkbox-input");
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector(".vb-welcome-skip")?.click();
  for (let index = 0; index < 8; index += 1) {
    await flushTasks();
  }
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("index.html SPA shell", () => {
  beforeEach(() => {
    window.__vatioboardRouter?.destroy?.();
    delete window.__vatioboardRouter;
    delete window.__vatioboardFloatingTools;
    delete window.__vatioboardPlayerWidget;
    vi.resetModules();
    routeState.mounted = [];
    routeState.unmounted = [];
    routeState.events = [];
    routeState.deferredLoads.clear();
    routeState.createPlayerWidget.mockClear();
    localStorage.clear();
  });

  it("boots the clean-URL app with Speed as the default route", async () => {
    await bootSpa();

    expectPageSeo({
      title: "VatioLibre Driving Tools",
      canonical: "https://vatioboard.com/",
    });
    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toBe("");
    expect(document.getElementById("app-view")).toBeTruthy();
    expect(document.getElementById("app-persistent-layer")).toBeTruthy();
    expect(document.querySelector("[data-mock-view='speed']")).toBeTruthy();
    expect(document.querySelector(".floating-dock")).toBeNull();
    expect(document.querySelector("[data-vb-shell-taskbar]")).toBeTruthy();
    expect(document.querySelector("[data-vb-shell-taskbar-favorites]")).toBeTruthy();
    expect(document.querySelector("[data-vb-shell-start-button]")).toBeTruthy();
    expect(document.querySelector("[data-vb-shell-account-button]")).toBeTruthy();
    expect(document.querySelector("[data-vb-account-panel]")).toBeTruthy();
    expect(window.__vatioboardFloatingTools).toBeTruthy();
    expect(routeState.createPlayerWidget).toHaveBeenCalledWith(
      expect.objectContaining({
        floating: false,
        preload: "immediate",
        persistVisibility: true,
        restoreVisibility: true,
      }),
    );
  }, 40000);

  it("shows the first-run welcome modal and does not request GPS before consent", async () => {
    await bootHtmlPage("index.html");
    const nativeWatchPosition = navigator.geolocation.watchPosition;
    await import("../../src/app/main.js");
    for (let index = 0; index < 8; index += 1) {
      await flushTasks();
    }

    expect(document.querySelector(".vb-welcome-backdrop [role='dialog']")).toBeTruthy();
    expect(document.querySelector("[data-mock-view='speed']")).toBeNull();
    expect(nativeWatchPosition).not.toHaveBeenCalled();

    await acceptWelcomeWithoutLocation();

    expect(document.querySelector(".vb-welcome-backdrop")).toBeNull();
    expect(document.querySelector("[data-mock-view='speed']")).toBeTruthy();
    expect(document.querySelector("[data-vb-shell-taskbar]")).toBeTruthy();
    expect(document.querySelector("[data-vb-shell-start-button]")).toBeTruthy();
    expect(document.querySelector("[data-vb-shell-account-button]")).toBeTruthy();
    expect(nativeWatchPosition).not.toHaveBeenCalled();
  }, 40000);

  it("switches clean routes without reloading the document", async () => {
    await bootSpa();
    const originalBody = document.body;

    await navigateSpa("/library?tab=media");

    expect(document.body).toBe(originalBody);
    expect(document.querySelector("[data-mock-view='library']")).toBeTruthy();
    expect(routeState.unmounted).toContain("speed");
    expect(routeState.events.indexOf("unmount:speed")).toBeLessThan(
      routeState.events.indexOf("mount:library"),
    );

    await navigateSpa("/accel");

    expect(document.querySelector("[data-mock-view='accel']")).toBeTruthy();
    expect(routeState.unmounted).toContain("library");
    expect(routeState.unmounted.filter((name) => name === "library")).toHaveLength(1);
    expect(routeState.createPlayerWidget).toHaveBeenCalledTimes(1);
  }, 40000);

  it("prevents a stale delayed route import from mounting after a newer route wins", async () => {
    const delayedSpeed = createDeferred();
    routeState.deferredLoads.set("/", delayedSpeed);

    seedWelcomeConsent();
    await bootHtmlPage("index.html");
    await import("../../src/app/main.js");
    await flushTasks();

    await navigateSpa("/library");

    expect(document.querySelector("[data-mock-view='library']")).toBeTruthy();
    expect(routeState.mounted).toEqual(["library"]);

    delayedSpeed.resolve();
    for (let index = 0; index < 8; index += 1) {
      await flushTasks();
    }

    expect(routeState.mounted).toEqual(["library"]);
    expect(document.querySelector("[data-mock-view='speed']")).toBeNull();
  }, 40000);

  it("opens the full shared start menu from the shell taskbar Start button", async () => {
    await bootSpa();

    const startButton = document.querySelector("[data-vb-shell-start-button]");
    expect(startButton).toBeTruthy();
    expect(startButton.getAttribute("aria-controls")).toBe("appStartMenuList");
    startButton.click();

    const sharedList = document.getElementById("appStartMenuList");
    expect(sharedList).toBeTruthy();
    expect(sharedList.hidden).toBe(false);
    expect(sharedList.querySelector("[data-start-route]")?.dataset.startRoute).toBe("/");
    expect(sharedList.querySelector("[data-start-route='/board']")).toBeTruthy();
    expect(sharedList.querySelector("[data-start-route='/replay']")).toBeTruthy();
    expect(sharedList.querySelector("[data-start-action='speed-alerts']")).toBeTruthy();
    expect(sharedList.querySelector("[data-backend-auth]")).toBeNull();
    expect(sharedList.querySelector("[data-player-toggle]")).toBeNull();
    expect(sharedList.classList.contains("vb-app-launcher")).toBe(true);
    expect(sharedList.querySelector(".vb-app-launcher-search-input")).toBeTruthy();
    expect(sharedList.querySelector("[data-launcher-search-open]")).toBeTruthy();
    expect(sharedList.querySelector("[data-launcher-search-panel]").hidden).toBe(true);
    expect(document.activeElement).not.toBe(sharedList.querySelector(".vb-app-launcher-search-input"));
    expect(sharedList.querySelector(".vb-app-launcher-favorites")).toBeNull();
    expect(sharedList.querySelector(".vb-app-launcher-rail")).toBeNull();
    expect(sharedList.querySelector("[data-launcher-view]")).toBeNull();
    expect(sharedList.querySelector(".vb-app-launcher-grid")).toBeTruthy();
    expect(sharedList.querySelector(".vb-app-launcher-manage")).toBeNull();
    expect(sharedList.querySelector(".vb-app-launcher-page-button")).toBeNull();
    expect(sharedList.querySelector("[aria-label='Edit launcher']")).toBeNull();
    expect(sharedList.querySelector("[aria-label='Manage apps']")).toBeNull();

    const brand = sharedList.querySelector(".app-start-menu-brand");
    expect(brand.closest(".vb-app-launcher-header")).toBeTruthy();

    const accountButton = document.querySelector("[data-vb-shell-account-button]");
    accountButton.click();
    const accountPanel = document.querySelector("[data-vb-account-panel]");
    const authForm = accountPanel.querySelector("[data-backend-auth]");
    expect(accountPanel.hidden).toBe(false);
    expect(authForm).toBeTruthy();
    expect(authForm.querySelector(".backend-auth-logout-button svg")).toBeTruthy();
    expect(authForm.querySelector("[data-backend-auth-signup]")?.getAttribute("target")).toBe("_blank");
    expect(authForm.querySelector("[data-backend-auth-forgot]")?.getAttribute("target")).toBe("_blank");
    expect(authForm.querySelector("[data-backend-auth-signup]")?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(authForm.querySelector("[data-backend-auth-forgot]")?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(authForm.querySelector(".backend-auth-sso-button")).toBeNull();
    expect(authForm.querySelector(".backend-auth-open-libre-button")).toBeNull();
    expect(authForm.querySelector(".backend-auth-open-board-button")).toBeNull();

    window.__vatioboardStartMenu.close();
    expect(sharedList.hidden).toBe(true);
  });

  it("opens the shared start menu navigation without a local GPS Lab item", async () => {
    await bootSpa();

    const sharedList = document.getElementById("appStartMenuList");
    expect(sharedList.textContent).not.toContain("GPS Lab");
    expect(sharedList.querySelector("[data-start-route='/library']")).toBeTruthy();
  });

  it("keeps calculator, energy, and speed alerts panels in the persistent layer across routes", async () => {
    await bootSpa();

    const persistentLayer = document.getElementById("app-persistent-layer");
    const calcPanel = persistentLayer.querySelector(".calc-panel");
    const energyPanel = persistentLayer.querySelector(".energy-panel");
    const speedAlertsPanel = persistentLayer.querySelector(".speed-alert-window");

    expect(calcPanel.hidden).toBe(true);
    expect(energyPanel.hidden).toBe(true);
    expect(speedAlertsPanel.hidden).toBe(true);

    window.__vatioboardFloatingTools.openCalculator();
    window.__vatioboardFloatingTools.openEnergy();
    window.__vatioboardFloatingTools.openSpeedAlerts();

    expect(calcPanel.hidden).toBe(false);
    expect(energyPanel.hidden).toBe(false);
    expect(speedAlertsPanel.hidden).toBe(false);
    expect(persistentLayer.querySelector("[data-vb-shell-taskbar-item='calculator']")).toBeTruthy();
    expect(persistentLayer.querySelector("[data-vb-shell-taskbar-item='energy']")).toBeTruthy();
    expect(persistentLayer.querySelector("[data-vb-shell-taskbar-item='speed-alerts']")).toBeTruthy();
    expect(localStorage.getItem("vatioboard.calc_panel.visible_v1")).toBe("open");
    expect(localStorage.getItem("vatioboard.energy_panel.visible_v1")).toBe("open");
    expect(localStorage.getItem("vatioboard.speed_alerts_panel.visible_v1")).toBe("open");

    await navigateSpa("/library");

    expect(document.querySelector("[data-mock-view='library']")).toBeTruthy();
    expect(persistentLayer.querySelector(".calc-panel")).toBe(calcPanel);
    expect(persistentLayer.querySelector(".energy-panel")).toBe(energyPanel);
    expect(persistentLayer.querySelector(".speed-alert-window")).toBe(speedAlertsPanel);
    expect(calcPanel.hidden).toBe(false);
    expect(energyPanel.hidden).toBe(false);
    expect(speedAlertsPanel.hidden).toBe(false);
  });

  it("restores persisted calculator, energy, and speed alerts visibility on boot", async () => {
    localStorage.setItem("vatioboard.calc_panel.visible_v1", "open");
    localStorage.setItem("vatioboard.energy_panel.visible_v1", "open");
    localStorage.setItem("vatioboard.speed_alerts_panel.visible_v1", "open");

    await bootSpa();

    expect(document.querySelector(".calc-panel")?.hidden).toBe(false);
    expect(document.querySelector(".energy-panel")?.hidden).toBe(false);
    expect(document.querySelector(".speed-alert-window")?.hidden).toBe(false);
  });
});
