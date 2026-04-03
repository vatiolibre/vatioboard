import { t } from "../i18n.js";
import { BACKEND_AUTH_SIGNUP_URL } from "./backend-auth.js";
import {
  CLOUD_SYNC_STATUS_EVENT,
  CLOUD_SYNC_STATUS_STATES,
  getCloudSyncStatus,
} from "./cloud-sync.js";

const CLOUD_SYNC_LABEL_KEYS = Object.freeze({
  [CLOUD_SYNC_STATUS_STATES.failed]: "cloudSyncFailed",
  [CLOUD_SYNC_STATUS_STATES.localOnly]: "cloudSyncLocalOnly",
  [CLOUD_SYNC_STATUS_STATES.paused]: "cloudSyncPaused",
  [CLOUD_SYNC_STATUS_STATES.synced]: "cloudSyncSynced",
  [CLOUD_SYNC_STATUS_STATES.syncing]: "cloudSyncSyncing",
});

const CLOUD_SYNC_HELP_KEYS = Object.freeze({
  [CLOUD_SYNC_STATUS_STATES.failed]: "cloudSyncHelpFailed",
  [CLOUD_SYNC_STATUS_STATES.localOnly]: "cloudSyncHelpLocalOnly",
  [CLOUD_SYNC_STATUS_STATES.paused]: "cloudSyncHelpPaused",
  [CLOUD_SYNC_STATUS_STATES.synced]: "cloudSyncHelpSynced",
  [CLOUD_SYNC_STATUS_STATES.syncing]: "cloudSyncHelpSyncing",
});

function normalizeCloudSyncState(value) {
  return Object.values(CLOUD_SYNC_STATUS_STATES).includes(value)
    ? value
    : CLOUD_SYNC_STATUS_STATES.localOnly;
}

function setHidden(element, isHidden) {
  if (!element) return;
  element.hidden = isHidden;
}

function stopEventPropagation(event) {
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}

function bindPanelAction(element, closePanel, handler = null, { allowDefault = false } = {}) {
  if (!element) return;

  element.addEventListener("click", (event) => {
    if (!allowDefault) {
      event.preventDefault();
    }
    stopEventPropagation(event);
    closePanel?.();
    handler?.();
  });
}

export function initCloudSyncStatusIndicator({
  mount,
  alignEnd = false,
  openLauncher,
} = {}) {
  if (!mount || typeof document === "undefined") return null;

  const root = document.createElement("div");
  root.className = "cloud-sync-indicator";
  if (alignEnd) {
    root.classList.add("cloud-sync-indicator-end");
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cloud-sync-indicator-btn";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");

  const panel = document.createElement("section");
  panel.className = "cloud-sync-indicator-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.hidden = true;

  const message = document.createElement("p");
  message.className = "cloud-sync-indicator-copy";

  const actions = document.createElement("div");
  actions.className = "cloud-sync-indicator-actions";

  const subscribeLink = document.createElement("a");
  subscribeLink.className = "cloud-sync-indicator-link";
  subscribeLink.href = BACKEND_AUTH_SIGNUP_URL;
  subscribeLink.rel = "noreferrer";
  subscribeLink.target = "_blank";

  const loginButton = document.createElement("button");
  loginButton.type = "button";
  loginButton.className = "cloud-sync-indicator-action";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "cloud-sync-indicator-action cloud-sync-indicator-close";

  actions.append(subscribeLink, loginButton, closeButton);
  panel.append(message, actions);
  root.append(button, panel);
  mount.append(root);

  function closePanel() {
    root.classList.remove("is-open");
    setHidden(panel, true);
    button.setAttribute("aria-expanded", "false");
  }

  function togglePanel() {
    const nextOpen = panel.hidden;
    root.classList.toggle("is-open", nextOpen);
    setHidden(panel, !nextOpen);
    button.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  }

  function render() {
    const status = getCloudSyncStatus();
    const state = normalizeCloudSyncState(status.state);
    const labelKey = CLOUD_SYNC_LABEL_KEYS[state];
    const helpKey = CLOUD_SYNC_HELP_KEYS[state];
    const label = t(labelKey);

    root.dataset.state = state;
    button.dataset.state = state;
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.title = label;
    message.textContent = t(helpKey);
    subscribeLink.textContent = t("cloudSyncSubscribe");
    loginButton.textContent = t("authLogin");
    closeButton.textContent = t("close");
  }

  function isEventInsideRoot(event) {
    return Boolean(event?.target && root.contains(event.target));
  }

  function handleDocumentPointerDown(event) {
    if (panel.hidden || isEventInsideRoot(event)) return;
    closePanel();
  }

  function handleDocumentClick(event) {
    if (panel.hidden || isEventInsideRoot(event)) return;
    closePanel();
  }

  function handleRootClick(event) {
    stopEventPropagation(event);
  }

  function handleDocumentKeyDown(event) {
    if (event.key !== "Escape" || panel.hidden) return;
    closePanel();
  }

  function handleStatusChange() {
    render();
  }

  root.addEventListener("click", handleRootClick);
  button.addEventListener("click", (event) => {
    stopEventPropagation(event);
    togglePanel();
  });
  bindPanelAction(subscribeLink, closePanel, null, { allowDefault: true });
  bindPanelAction(loginButton, closePanel, () => {
    queueMicrotask(() => {
      openLauncher?.();
    });
  });
  bindPanelAction(closeButton, closePanel);
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeyDown);
  document.addEventListener("i18n:change", handleStatusChange);
  window.addEventListener(CLOUD_SYNC_STATUS_EVENT, handleStatusChange);

  render();

  return {
    destroy() {
      closePanel();
      root.remove();
      root.removeEventListener("click", handleRootClick);
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleDocumentKeyDown);
      document.removeEventListener("i18n:change", handleStatusChange);
      window.removeEventListener(CLOUD_SYNC_STATUS_EVENT, handleStatusChange);
    },
  };
}
