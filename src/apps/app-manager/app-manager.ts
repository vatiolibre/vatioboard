import "./app-manager.less";

import {
  appControl,
  appRegistry,
  applyAppIconTheme,
  clearAppPrivateStorage,
  createAppLauncher,
  estimateAppPrivateStorage,
  exportAppPrivateStorage,
  importAppPrivateStorage,
  listAppPrivateStorageKeys,
} from "../../app-platform/index.js";
import type { RouteMountContext } from "../../types/route";
import type { ShellRuntime } from "../../types/shell";
import { showConfirmDialog } from "../../shared/ui/confirm-dialog.js";
import type {
  ShellAppRuntimeManager,
  VatioAppControlState,
  VatioAppManifest,
  VatioAppPermission,
  VatioAppRuntime,
  VatioAppSurface,
  VatioBackgroundServiceManager,
  VatioRunningApp,
} from "../../app-platform/types";

type AppManagerRouteContext = RouteMountContext & {
  context: RouteMountContext["context"] & {
    shellManager?: ShellRuntime;
    shellAppRuntimeManager?: ShellAppRuntimeManager;
    backgroundServiceManager?: VatioBackgroundServiceManager;
  };
};

interface AppManagerFilters {
  search: string;
  surface: string;
  kind: string;
  status: string;
  permission: string;
}

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

function createButton(text: string, className = "vb-app-manager-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  return button;
}

function createToggleButton({
  text,
  pressed,
  disabled = false,
  onClick,
}: {
  text: string;
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const button = createButton(text, "vb-app-manager-toggle");
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function getPrimaryLaunchText(app: VatioAppManifest) {
  if (app.kind === "background-service") return "Background";
  if (app.route) return "Launch";
  if (app.window?.shellWindowId) return "Open";
  return "Unavailable";
}

function getSurfaceInfo(app: VatioAppManifest) {
  if (app.route) return `Route ${app.route}`;
  if (app.window?.shellWindowId) return `Window ${app.window.shellWindowId}`;
  if (app.kind === "background-service") return "Background service";
  return "No v1 surface";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function appMatchesFilter(app: VatioAppManifest, filters: AppManagerFilters) {
  const normalizedSearch = filters.search.trim().toLowerCase();
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
  const surfaceOk = filters.surface === "all" || app.surfaces.includes(filters.surface as VatioAppSurface);
  const kindOk = filters.kind === "all" || app.kind === filters.kind;
  const statusOk = filters.status === "all" || app.status === filters.status;
  const permissionOk = filters.permission === "all" || app.permissions.includes(filters.permission as VatioAppPermission);
  return searchOk && surfaceOk && kindOk && statusOk && permissionOk;
}

function compareAppManagerApps(a: VatioAppManifest, b: VatioAppManifest) {
  const aState = appControl.getState(a.id);
  const bState = appControl.getState(b.id);
  if (aState.pinned !== bState.pinned) return aState.pinned ? -1 : 1;
  if (aState.favorite !== bState.favorite) return aState.favorite ? -1 : 1;
  return (a.order - b.order) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

function getRuntimeForApp({
  app,
  routeContext,
}: {
  app: VatioAppManifest;
  routeContext: AppManagerRouteContext;
}): VatioAppRuntime | null {
  if (routeContext.context.appRuntime?.appId === app.id) return routeContext.context.appRuntime;
  if (app.window?.shellWindowId) {
    return routeContext.context.shellAppRuntimeManager?.getRuntime(app.id) || null;
  }
  if (app.kind === "background-service") {
    return routeContext.context.backgroundServiceManager?.getRuntime(app.id) || null;
  }
  return null;
}

function getRunningRecord(app: VatioAppManifest, runningApps: VatioRunningApp[]) {
  return runningApps.find((runningApp) => runningApp.appId === app.id) || null;
}

function getServiceSummary(runtime: VatioAppRuntime | null) {
  if (!runtime) return "No runtime";
  const services = Object.entries(runtime.services)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);
  return services.length ? services.join(", ") : "No exposed services";
}

function getDeclaredServiceSummary(app: VatioAppManifest) {
  return app.services.length ? app.services.join(", ") : "None";
}

function getPermissionGrantSummary(app: VatioAppManifest) {
  const granted = app.permissions.filter((permission) => appControl.hasGrantedPermission(app.id, permission));
  return `${granted.length}/${app.permissions.length} granted`;
}

function createAppCard({
  app,
  state,
  runtime,
  runningRecord,
  backgroundServiceManager,
  launchApp,
  closeApp,
  rerender,
}: {
  app: VatioAppManifest;
  state: VatioAppControlState;
  runtime: VatioAppRuntime | null;
  runningRecord: VatioRunningApp | null;
  backgroundServiceManager?: VatioBackgroundServiceManager | null;
  launchApp: (app: VatioAppManifest) => void;
  closeApp: (app: VatioAppManifest) => void;
  rerender: () => void;
}) {
  const card = document.createElement("article");
  card.className = "vb-app-manager-card";
  card.dataset.appId = app.id;
  card.dataset.enabled = state.enabled ? "true" : "false";
  applyAppIconTheme(card, app);

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
    createChip(state.enabled ? "Enabled" : "Disabled", state.enabled ? "vb-app-manager-chip is-enabled" : "vb-app-manager-chip is-disabled"),
    createChip(runningRecord ? `Running: ${formatToken(runningRecord.state)}` : "Stopped"),
    createChip(app.localFirst ? "Local-first" : "Online"),
    createChip(app.offlineCapable ? "Offline" : "Network"),
    createChip(app.teslaOptimized ? "Tesla" : "Desktop"),
  );
  if (state.pinned) badges.append(createChip("Pinned"));
  if (state.favorite) badges.append(createChip("Favorite"));
  if (state.hiddenFromStartMenu) badges.append(createChip("Hidden from Start"));

  const surfaces = document.createElement("div");
  surfaces.className = "vb-app-manager-surfaces";
  for (const surface of app.surfaces) surfaces.append(createChip(formatToken(surface)));

  const diagnostics = document.createElement("div");
  diagnostics.className = "vb-app-manager-diagnostics";
  diagnostics.append(
    createDiagnosticLine("Kind", formatToken(app.kind)),
    createDiagnosticLine("Surface", getSurfaceInfo(app)),
    createDiagnosticLine("Version", app.version),
    createDiagnosticLine("Launcher opens", String(state.openCount || 0)),
    createDiagnosticLine("Runtime", runtime?.lifecycle.getState() || "not running"),
    createDiagnosticLine("Declared services", getDeclaredServiceSummary(app)),
    createDiagnosticLine("Services", getServiceSummary(runtime)),
    createDiagnosticLine("Permissions", getPermissionGrantSummary(app)),
  );
  if (app.kind === "background-service") {
    diagnostics.append(createDiagnosticLine("Background", runningRecord ? formatToken(runningRecord.state) : "stopped"));
  }

  const storageUsage = estimateAppPrivateStorage(app.id);
  const storageKeys = listAppPrivateStorageKeys(app.id);
  const storageDetails = document.createElement("details");
  storageDetails.className = "vb-app-manager-storage";
  const storageSummary = document.createElement("summary");
  storageSummary.textContent = `App-private storage ${formatBytes(storageUsage.bytes)} (${storageUsage.keyCount})`;
  const storageList = document.createElement("ul");
  if (storageKeys.length) {
    for (const key of storageKeys) {
      const item = document.createElement("li");
      item.textContent = key;
      storageList.append(item);
    }
  } else {
    const item = document.createElement("li");
    item.textContent = "No app-private keys";
    storageList.append(item);
  }

  const storageJson = document.createElement("textarea");
  storageJson.className = "vb-app-manager-storage-json";
  storageJson.rows = 4;
  storageJson.spellcheck = false;
  storageJson.placeholder = "App-private storage JSON";
  const storageNote = document.createElement("p");
  storageNote.className = "vb-app-manager-note";
  storageNote.textContent = "Legacy app data such as drawings, replay sessions, media cache, player queues, and shell layout are not cleared here.";
  const storageActions = document.createElement("div");
  storageActions.className = "vb-app-manager-inline-actions";
  const exportButton = createButton("Export");
  exportButton.addEventListener("click", () => {
    storageJson.value = JSON.stringify(exportAppPrivateStorage(app.id), null, 2);
  });
  const importButton = createButton("Import");
  importButton.addEventListener("click", () => {
    try {
      const parsed = JSON.parse(storageJson.value || "{}");
      importAppPrivateStorage(app.id, parsed);
      rerender();
    } catch {
      storageJson.setCustomValidity("Invalid JSON");
      storageJson.reportValidity();
      storageJson.setCustomValidity("");
    }
  });
  const resetStorageButton = createButton("Reset app-private storage", "vb-app-manager-button is-danger");
  resetStorageButton.addEventListener("click", async () => {
    const confirmed = await showConfirmDialog({
      title: "Reset app-private storage?",
      message: `Clear app-private keys for ${app.title}?`,
      description: "Legacy app data such as drawings, replay sessions, media cache, player queues, and shell layout are not cleared here.",
      confirmLabel: "Reset app-private storage",
      cancelLabel: "Cancel",
      destructive: true,
      onConfirm: () => {
        clearAppPrivateStorage(app.id);
      },
    });
    if (confirmed) rerender();
  });
  storageActions.append(exportButton, importButton, resetStorageButton);
  storageDetails.append(storageSummary, storageList, storageNote, storageJson, storageActions);

  const details = document.createElement("details");
  details.className = "vb-app-manager-permissions";
  const summary = document.createElement("summary");
  summary.textContent = `Permissions (${app.permissions.length})`;
  const permissionList = document.createElement("ul");
  for (const permission of app.permissions) {
    const item = document.createElement("li");
    const granted = appControl.hasGrantedPermission(app.id, permission);
    const protectedPermission = appControl.isProtectedPermission(app.id, permission);
    const label = document.createElement("span");
    label.textContent = permission;
    const toggle = createButton(
      protectedPermission ? "Required" : granted ? "Revoke" : "Grant",
      "vb-app-manager-mini-button",
    );
    toggle.disabled = protectedPermission;
    if (protectedPermission) {
      toggle.title = "Required for this protected app.";
      item.dataset.protectedPermission = "true";
    }
    toggle.addEventListener("click", () => {
      if (protectedPermission) return;
      if (granted) appControl.revokePermission(app.id, permission);
      else appControl.grantPermission(app.id, permission);
      rerender();
    });
    item.dataset.granted = granted ? "true" : "false";
    item.append(
      label,
      createChip(
        protectedPermission ? "Protected" : granted ? "Granted" : "Revoked",
        protectedPermission || granted ? "vb-app-manager-chip is-enabled" : "vb-app-manager-chip is-disabled",
      ),
      toggle,
    );
    permissionList.append(item);
  }
  details.append(summary, permissionList);

  const lifecycleDetails = document.createElement("details");
  lifecycleDetails.className = "vb-app-manager-lifecycle";
  const lifecycleSummary = document.createElement("summary");
  lifecycleSummary.textContent = "Lifecycle";
  const lifecycleList = document.createElement("ul");
  const lifecycleLog = runtime?.lifecycle.getLog() || [];
  if (lifecycleLog.length) {
    for (const entry of lifecycleLog.slice(-8).reverse()) {
      const item = document.createElement("li");
      item.textContent = `${formatToken(entry.state)} ${entry.at}`;
      lifecycleList.append(item);
    }
  } else {
    const item = document.createElement("li");
    item.textContent = "No lifecycle activity";
    lifecycleList.append(item);
  }
  lifecycleDetails.append(lifecycleSummary, lifecycleList);

  const secondaryDetails = document.createElement("details");
  secondaryDetails.className = "vb-app-manager-card-details";
  const secondarySummary = document.createElement("summary");
  secondarySummary.dataset.i18n = "appManagerDetails";
  secondarySummary.textContent = "Details";
  const secondaryBody = document.createElement("div");
  secondaryBody.className = "vb-app-manager-card-details-body";
  secondaryBody.append(diagnostics, details, storageDetails, lifecycleDetails);
  secondaryDetails.append(secondarySummary, secondaryBody);

  const actions = document.createElement("div");
  actions.className = "vb-app-manager-actions";
  const launchButton = createButton(getPrimaryLaunchText(app), "vb-app-manager-launch");
  launchButton.textContent = getPrimaryLaunchText(app);
  launchButton.disabled = !state.enabled || app.kind === "background-service" || (!app.route && !app.window?.shellWindowId);
  launchButton.setAttribute("aria-label", `${launchButton.textContent} ${app.title}`);
  launchButton.addEventListener("click", () => launchApp(app));
  const closeButton = createButton("Close");
  closeButton.disabled = !app.window?.shellWindowId || !runningRecord;
  closeButton.addEventListener("click", () => closeApp(app));
  const enableButton = createToggleButton({
    text: state.enabled ? "Enabled" : "Disabled",
    pressed: state.enabled,
    disabled: appControl.isProtected(app.id),
    onClick: () => {
      if (appControl.setEnabled(app.id, !state.enabled)) {
        if (state.enabled) closeApp(app);
        rerender();
      }
    },
  });
  const pinButton = createToggleButton({
    text: state.pinned ? "Pinned" : "Pin",
    pressed: state.pinned === true,
    onClick: () => {
      appControl.setPinned(app.id, !state.pinned);
      rerender();
    },
  });
  const favoriteButton = createToggleButton({
    text: state.favorite ? "Favorite" : "Favorite",
    pressed: state.favorite === true,
    onClick: () => {
      appControl.setFavorite(app.id, !state.favorite);
      rerender();
    },
  });
  const hiddenButton = createToggleButton({
    text: state.hiddenFromStartMenu ? "Start hidden" : "Start visible",
    pressed: state.hiddenFromStartMenu === true,
    disabled: appControl.isProtected(app.id),
    onClick: () => {
      appControl.setHiddenFromStartMenu(app.id, !state.hiddenFromStartMenu);
      rerender();
    },
  });
  const resetControlButton = createButton("Reset control");
  resetControlButton.addEventListener("click", () => {
    appControl.resetAppControlState(app.id);
    rerender();
  });
  actions.append(launchButton, closeButton);
  if (app.kind === "background-service") {
    const backgroundState = runtime?.lifecycle.getState() || "stopped";
    const backgroundStartButton = createButton("Start");
    backgroundStartButton.disabled = !state.enabled || !backgroundServiceManager || backgroundState === "active";
    backgroundStartButton.addEventListener("click", () => {
      backgroundServiceManager?.start(app.id);
      rerender();
    });
    const backgroundSuspendButton = createButton("Suspend");
    backgroundSuspendButton.disabled = !backgroundServiceManager || backgroundState !== "active";
    backgroundSuspendButton.addEventListener("click", () => {
      backgroundServiceManager?.suspend(app.id);
      rerender();
    });
    const backgroundResumeButton = createButton("Resume");
    backgroundResumeButton.disabled = !backgroundServiceManager || backgroundState !== "suspended";
    backgroundResumeButton.addEventListener("click", () => {
      backgroundServiceManager?.resume(app.id);
      rerender();
    });
    const backgroundStopButton = createButton("Stop");
    backgroundStopButton.disabled = !backgroundServiceManager || !runtime;
    backgroundStopButton.addEventListener("click", () => {
      backgroundServiceManager?.stop(app.id);
      rerender();
    });
    actions.append(backgroundStartButton, backgroundSuspendButton, backgroundResumeButton, backgroundStopButton);
  }
  actions.append(enableButton, pinButton, favoriteButton, hiddenButton, resetControlButton);

  if (appControl.isProtected(app.id)) {
    const protectedNote = document.createElement("p");
    protectedNote.className = "vb-app-manager-note";
    protectedNote.textContent = "Protected system app; disabling, hiding, and critical permission revocation are blocked.";
    secondaryBody.prepend(protectedNote);
    card.append(header, badges, surfaces, secondaryDetails, actions);
    return card;
  }

  card.append(header, badges, surfaces, secondaryDetails, actions);
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
  const kindFilter = appRoot.querySelector("[data-app-kind-filter]") as HTMLSelectElement | null;
  const statusFilter = appRoot.querySelector("[data-app-status-filter]") as HTMLSelectElement | null;
  const permissionFilter = appRoot.querySelector("[data-app-permission-filter]") as HTMLSelectElement | null;
  const runtime = routeContext.context.appRuntime;
  const launcher = createAppLauncher({
    shellManager: routeContext.context.shellManager,
    navigate: routeContext.context.navigate,
    getCurrentRoute: () => routeContext.context.route || null,
    shellAppRuntimeManager: routeContext.context.shellAppRuntimeManager,
  });

  const launchApp = (app: VatioAppManifest) => {
    const launched = runtime?.shell.openApp(app.id) || launcher.openApp(app.id);
    if (launched) return;
    runtime?.logger.warn(`App Manager could not launch ${app.id}.`);
  };

  const closeApp = (app: VatioAppManifest) => {
    if (!launcher.closeApp(app.id)) {
      runtime?.shell.closeApp(app.id);
    }
    render();
  };

  function render() {
    if (!list) return;
    const filters: AppManagerFilters = {
      search: searchInput?.value || "",
      surface: surfaceFilter?.value || "all",
      kind: kindFilter?.value || "all",
      status: statusFilter?.value || "all",
      permission: permissionFilter?.value || "all",
    };
    const apps = appRegistry.listApps()
      .filter((app) => appMatchesFilter(app, filters))
      .sort(compareAppManagerApps);
    const backgroundRunning = (routeContext.context.backgroundServiceManager?.listServices() || []).map((record) => ({
      appId: record.appId,
      title: record.title,
      surface: "background" as const,
      state: record.state,
    }));
    const runningApps = [
      ...launcher.getRunningApps(),
      ...backgroundRunning,
    ];

    list.replaceChildren(...apps.map((app) => createAppCard({
      app,
      state: appControl.getState(app.id),
      runtime: getRuntimeForApp({ app, routeContext }),
      runningRecord: getRunningRecord(app, runningApps),
      backgroundServiceManager: routeContext.context.backgroundServiceManager || null,
      launchApp,
      closeApp,
      rerender: render,
    })));
    if (count) {
      count.textContent = `${apps.length} / ${appRegistry.listApps().length} apps · ${runningApps.length} running`;
    }
    runtime?.i18n.apply(appRoot);
  }

  routeContext.cleanup.addEventListener(searchInput, "input", render);
  routeContext.cleanup.addEventListener(surfaceFilter, "change", render);
  routeContext.cleanup.addEventListener(kindFilter, "change", render);
  routeContext.cleanup.addEventListener(statusFilter, "change", render);
  routeContext.cleanup.addEventListener(permissionFilter, "change", render);
  const unsubscribeControl = appControl.subscribe?.(() => render());
  routeContext.cleanup.add(unsubscribeControl);
  const unsubscribeI18n = runtime?.i18n.subscribe(() => runtime.i18n.apply(appRoot));
  routeContext.cleanup.add(unsubscribeI18n);

  render();
  return {
    unmount() {},
  };
}

export function unmountAppsRoute() {}
