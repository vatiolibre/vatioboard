import "./app-manager.less";

import { appRegistry, createAppLauncher } from "../../app-platform/index.js";
import type { RouteMountContext } from "../../types/route";
import type { ShellRuntime } from "../../types/shell";
import type { VatioAppManifest, VatioAppSurface } from "../../app-platform/types";

type AppManagerRouteContext = RouteMountContext & {
  context: RouteMountContext["context"] & {
    shellManager?: ShellRuntime;
  };
};

function formatToken(value: string) {
  return String(value || "")
    .split(/[-.]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createChip(text: string, className = "vb-app-manager-chip") {
  const chip = document.createElement("span");
  chip.className = className;
  chip.textContent = text;
  return chip;
}

function createDiagnosticLine(label: string, value: string) {
  const row = document.createElement("div");
  row.className = "vb-app-manager-line";

  const labelEl = document.createElement("span");
  labelEl.className = "vb-app-manager-line-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("span");
  valueEl.className = "vb-app-manager-line-value";
  valueEl.textContent = value;

  row.append(labelEl, valueEl);
  return row;
}

function getPrimaryLaunchText(app: VatioAppManifest) {
  if (app.route) return "Launch";
  if (app.window?.shellWindowId) return "Open";
  return "Unavailable";
}

function getSurfaceInfo(app: VatioAppManifest) {
  if (app.route) return `Route ${app.route}`;
  if (app.window?.shellWindowId) return `Window ${app.window.shellWindowId}`;
  return "No v1 surface";
}

function appMatchesFilter(app: VatioAppManifest, search: string, surface: string) {
  const normalizedSearch = search.trim().toLowerCase();
  const searchable = [
    app.title,
    app.shortTitle,
    app.id,
    app.kind,
    app.status,
    app.route || "",
    app.window?.shellWindowId || "",
    ...(app.tags || []),
  ].join(" ").toLowerCase();

  const searchOk = !normalizedSearch || searchable.includes(normalizedSearch);
  const surfaceOk = surface === "all" || app.surfaces.includes(surface as VatioAppSurface);
  return searchOk && surfaceOk;
}

function createAppCard({
  app,
  launchApp,
}: {
  app: VatioAppManifest;
  launchApp: (app: VatioAppManifest) => void;
}) {
  const card = document.createElement("article");
  card.className = "vb-app-manager-card";
  card.dataset.appId = app.id;

  const header = document.createElement("header");
  header.className = "vb-app-manager-card-header";

  const icon = document.createElement("span");
  icon.className = "vb-app-manager-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = app.icon;

  const titleBlock = document.createElement("div");
  titleBlock.className = "vb-app-manager-card-title";

  const title = document.createElement("h2");
  title.textContent = app.title;

  const appId = document.createElement("p");
  appId.textContent = app.id;

  titleBlock.append(title, appId);
  header.append(icon, titleBlock);

  const badges = document.createElement("div");
  badges.className = "vb-app-manager-badges";
  badges.append(
    createChip(formatToken(app.status), "vb-app-manager-chip is-status"),
    createChip(app.localFirst ? "Local-first" : "Online"),
    createChip(app.offlineCapable ? "Offline" : "Network"),
    createChip(app.teslaOptimized ? "Tesla" : "Desktop"),
  );

  const surfaces = document.createElement("div");
  surfaces.className = "vb-app-manager-surfaces";
  for (const surface of app.surfaces) surfaces.append(createChip(formatToken(surface)));

  const diagnostics = document.createElement("div");
  diagnostics.className = "vb-app-manager-diagnostics";
  diagnostics.append(
    createDiagnosticLine("Kind", formatToken(app.kind)),
    createDiagnosticLine("Surface", getSurfaceInfo(app)),
    createDiagnosticLine("Version", app.version),
  );

  const details = document.createElement("details");
  details.className = "vb-app-manager-permissions";
  const summary = document.createElement("summary");
  summary.textContent = `Permissions (${app.permissions.length})`;
  const permissionList = document.createElement("ul");
  for (const permission of app.permissions) {
    const item = document.createElement("li");
    item.textContent = permission;
    permissionList.append(item);
  }
  details.append(summary, permissionList);

  const actions = document.createElement("div");
  actions.className = "vb-app-manager-actions";
  const launchButton = document.createElement("button");
  launchButton.type = "button";
  launchButton.className = "vb-app-manager-launch";
  launchButton.textContent = getPrimaryLaunchText(app);
  launchButton.disabled = !app.route && !app.window?.shellWindowId;
  launchButton.setAttribute("aria-label", `${launchButton.textContent} ${app.title}`);
  launchButton.addEventListener("click", () => launchApp(app));
  actions.append(launchButton);

  card.append(header, badges, surfaces, diagnostics, details, actions);
  return card;
}

export function mountAppsRoute(routeContext: AppManagerRouteContext) {
  const root = routeContext.root;
  const appRoot = root.querySelector("[data-vb-app-manager]");
  if (!appRoot) return null;

  const list = appRoot.querySelector("[data-app-list]");
  const count = appRoot.querySelector("[data-app-count]");
  const searchInput = appRoot.querySelector("[data-app-search]") as HTMLInputElement | null;
  const surfaceFilter = appRoot.querySelector("[data-app-surface-filter]") as HTMLSelectElement | null;
  const runtime = routeContext.context.appRuntime;
  const launcher = createAppLauncher({
    shellManager: routeContext.context.shellManager,
    navigate: routeContext.context.navigate,
    getCurrentRoute: () => routeContext.context.route || null,
  });

  const launchApp = (app: VatioAppManifest) => {
    const launched = runtime?.shell.openApp(app.id) || launcher.openApp(app.id);
    if (launched) return;
    runtime?.logger.warn(`App Manager could not launch ${app.id}.`);
  };

  function render() {
    if (!list) return;
    const search = searchInput?.value || "";
    const surface = surfaceFilter?.value || "all";
    const apps = appRegistry.listApps().filter((app) => appMatchesFilter(app, search, surface));

    list.replaceChildren(...apps.map((app) => createAppCard({ app, launchApp })));
    if (count) {
      count.textContent = `${apps.length} / ${appRegistry.listApps().length}`;
    }
    runtime?.i18n.apply(appRoot);
  }

  routeContext.cleanup.addEventListener(searchInput, "input", render);
  routeContext.cleanup.addEventListener(surfaceFilter, "change", render);
  const unsubscribeI18n = runtime?.i18n.subscribe(() => runtime.i18n.apply(appRoot));
  routeContext.cleanup.add(unsubscribeI18n);

  render();
  return {
    unmount() {},
  };
}

export function unmountAppsRoute() {}
