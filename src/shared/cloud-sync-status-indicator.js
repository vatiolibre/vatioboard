import { t } from "../i18n.js";
import { IconClose } from "../icons.js";
import {
  BACKEND_AUTH_SIGNUP_URL,
  BACKEND_AUTH_STATE_EVENT,
  BACKEND_SUBSCRIBE_URL,
  getBackendFeatureAccessState,
  getBackendSessionState,
} from "./backend-auth.js";
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

const PANEL_AUDIENCES = Object.freeze({
  guest: "guest",
  noSubscription: "no_subscription",
  subscriber: "subscriber",
  operational: "operational",
  unknown: "unknown",
});

const OPERATIONAL_REASONS = new Set([
  "aborted",
  "error",
  "lease",
  "logout",
  "offline",
  "ownership",
  "unavailable",
]);

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

function getText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalBoolean(value) {
  return value === true ? true : value === false ? false : null;
}

function getNormalizedStatus() {
  const status = getCloudSyncStatus();
  return {
    ...status,
    state: normalizeCloudSyncState(status?.state),
    reason: getText(status?.reason),
  };
}

function reasonSuggestsSubscription(reason) {
  const normalized = getText(reason).toLowerCase();
  return (
    normalized === "disabled"
    || normalized.includes("subscription")
    || normalized.includes("suscripcion")
    || normalized.includes("suscripción")
  );
}

function isOperationalStatus(status) {
  const reason = getText(status?.reason).toLowerCase();
  return (
    OPERATIONAL_REASONS.has(reason)
    || status?.state === CLOUD_SYNC_STATUS_STATES.failed
  );
}

function createPanelAccessState() {
  return {
    authenticated: null,
    checking: false,
    cloudSyncEnabled: null,
    hasActiveSubscription: null,
    isGuest: null,
    pendingLogout: false,
    unavailable: false,
  };
}

function derivePanelAudience(status, accessState) {
  const reason = getText(status?.reason).toLowerCase();

  if (accessState.pendingLogout === true || reason === "logout") {
    return PANEL_AUDIENCES.operational;
  }

  if (accessState.unavailable === true) {
    return PANEL_AUDIENCES.operational;
  }

  if (
    accessState.isGuest === true
    || accessState.authenticated === false
  ) {
    return PANEL_AUDIENCES.guest;
  }

  if (
    accessState.hasActiveSubscription === true
    || accessState.cloudSyncEnabled === true
  ) {
    return PANEL_AUDIENCES.subscriber;
  }

  if (
    accessState.hasActiveSubscription === false
    || accessState.cloudSyncEnabled === false
    || reasonSuggestsSubscription(reason)
  ) {
    return PANEL_AUDIENCES.noSubscription;
  }

  if (
    status?.state === CLOUD_SYNC_STATUS_STATES.synced
    || (
      status?.state === CLOUD_SYNC_STATUS_STATES.syncing
      && reason !== "guest"
      && reason !== "auth"
    )
  ) {
    return PANEL_AUDIENCES.subscriber;
  }

  if (accessState.authenticated === true) {
    return PANEL_AUDIENCES.unknown;
  }

  if (reason === "guest" || reason === "auth") {
    return PANEL_AUDIENCES.guest;
  }

  if (isOperationalStatus(status)) {
    return PANEL_AUDIENCES.operational;
  }

  if (status?.state === CLOUD_SYNC_STATUS_STATES.localOnly) {
    return PANEL_AUDIENCES.guest;
  }

  return PANEL_AUDIENCES.unknown;
}

function getPanelMessageKey(status, accessState, audience) {
  const reason = getText(status?.reason).toLowerCase();

  if (accessState.checking && audience === PANEL_AUDIENCES.unknown) {
    return "cloudSyncPanelChecking";
  }

  if (accessState.unavailable === true) {
    return "cloudSyncPanelUnavailable";
  }

  if (audience === PANEL_AUDIENCES.guest) {
    return "cloudSyncPanelGuest";
  }

  if (audience === PANEL_AUDIENCES.noSubscription) {
    return "cloudSyncPanelNoSubscription";
  }

  if (reason === "offline") {
    return "cloudSyncPanelPausedOffline";
  }

  if (reason === "ownership" || reason === "lease") {
    return "cloudSyncPanelPausedOwnership";
  }

  if (reason === "logout" || accessState.pendingLogout === true) {
    return "cloudSyncPanelPausedLogout";
  }

  if (reason === "unavailable") {
    return "cloudSyncPanelUnavailable";
  }

  if (status?.state === CLOUD_SYNC_STATUS_STATES.failed || reason === "error") {
    return "cloudSyncPanelFailed";
  }

  if (audience === PANEL_AUDIENCES.subscriber) {
    if (status?.state === CLOUD_SYNC_STATUS_STATES.syncing) {
      return "cloudSyncPanelSubscriberSyncing";
    }
    return "cloudSyncPanelSubscriberSynced";
  }

  return CLOUD_SYNC_HELP_KEYS[status?.state] || "cloudSyncPanelUnknown";
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
  closeButton.className = "cloud-sync-indicator-close";
  closeButton.setAttribute("aria-label", t("close"));
  closeButton.title = t("close");
  closeButton.innerHTML = IconClose;

  actions.append(subscribeLink, loginButton);
  panel.append(closeButton, message, actions);
  root.append(button, panel);
  mount.append(root);

  let destroyed = false;
  let panelAccessState = createPanelAccessState();
  let accessRefreshVersion = 0;

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
    if (nextOpen) {
      void refreshPanelAccessState({ force: true });
    }
    render();
  }

  function applyAuthStateDetail(detail = {}) {
    const authenticated = normalizeOptionalBoolean(detail.authenticated);
    const isGuest = normalizeOptionalBoolean(detail.isGuest);

    panelAccessState = {
      ...panelAccessState,
      authenticated: authenticated ?? panelAccessState.authenticated,
      isGuest: isGuest ?? panelAccessState.isGuest,
      pendingLogout: detail.pendingLogout === true,
    };

    if (detail.pendingLogout === true || isGuest === true || authenticated === false) {
      panelAccessState.cloudSyncEnabled = null;
      panelAccessState.hasActiveSubscription = null;
    }
  }

  async function refreshPanelAccessState({ force = false } = {}) {
    const requestVersion = accessRefreshVersion + 1;
    accessRefreshVersion = requestVersion;
    panelAccessState = {
      ...panelAccessState,
      checking: true,
      unavailable: false,
    };
    render();

    try {
      const session = await getBackendSessionState({ force });
      if (destroyed || accessRefreshVersion !== requestVersion) return;

      if (!session?.ok || session?.isGuest || session?.authenticated !== true) {
        panelAccessState = {
          ...panelAccessState,
          authenticated: false,
          checking: false,
          cloudSyncEnabled: null,
          hasActiveSubscription: null,
          isGuest: session?.isGuest !== false,
          pendingLogout: false,
          unavailable: !session?.ok && !session?.isGuest,
        };
        render();
        return;
      }

      const featureAccess = await getBackendFeatureAccessState({ force });
      if (destroyed || accessRefreshVersion !== requestVersion) return;

      if (!featureAccess?.ok || featureAccess?.isGuest) {
        panelAccessState = {
          ...panelAccessState,
          authenticated: featureAccess?.isGuest ? false : true,
          checking: false,
          cloudSyncEnabled: null,
          hasActiveSubscription: null,
          isGuest: featureAccess?.isGuest === true,
          pendingLogout: false,
          unavailable: featureAccess?.isGuest !== true,
        };
        render();
        return;
      }

      const capability = featureAccess?.cloudSyncCapability || {};
      panelAccessState = {
        ...panelAccessState,
        authenticated: true,
        checking: false,
        cloudSyncEnabled: capability.enabled === true,
        hasActiveSubscription: capability.hasActiveSubscription === true,
        isGuest: false,
        pendingLogout: false,
        unavailable: !featureAccess?.ok,
      };
    } catch {
      if (destroyed || accessRefreshVersion !== requestVersion) return;
      panelAccessState = {
        ...panelAccessState,
        checking: false,
        unavailable: true,
      };
    }

    render();
  }

  function syncActions(status, audience) {
    const operationalOnly = isOperationalStatus(status);
    const showAccountLink = (
      audience === PANEL_AUDIENCES.guest
      || audience === PANEL_AUDIENCES.noSubscription
      || (
        audience === PANEL_AUDIENCES.subscriber
        && !operationalOnly
      )
    );
    const showLogin = audience === PANEL_AUDIENCES.guest;

    setHidden(loginButton, !showLogin);
    setHidden(subscribeLink, !showAccountLink);

    if (audience === PANEL_AUDIENCES.guest) {
      subscribeLink.href = BACKEND_AUTH_SIGNUP_URL;
      subscribeLink.textContent = t("cloudSyncCreateAccount");
    } else if (audience === PANEL_AUDIENCES.noSubscription) {
      subscribeLink.href = BACKEND_SUBSCRIBE_URL;
      subscribeLink.textContent = t("cloudSyncSubscribe");
    } else {
      subscribeLink.href = BACKEND_SUBSCRIBE_URL;
      subscribeLink.textContent = t("cloudSyncManageSubscription");
    }

    loginButton.textContent = t("authLogin");
    closeButton.setAttribute("aria-label", t("close"));
    closeButton.title = t("close");
  }

  function render() {
    if (destroyed) return;
    const status = getNormalizedStatus();
    const state = status.state;
    const audience = derivePanelAudience(status, panelAccessState);
    const labelKey = CLOUD_SYNC_LABEL_KEYS[state];
    const helpKey = getPanelMessageKey(status, panelAccessState, audience);
    const label = t(labelKey);

    root.dataset.state = state;
    root.dataset.panelAudience = audience;
    button.dataset.state = state;
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.title = label;
    message.textContent = t(helpKey);
    syncActions(status, audience);
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

  function handleAuthStateChange(event) {
    applyAuthStateDetail(event?.detail || {});
    if (!panel.hidden && panelAccessState.authenticated === true) {
      void refreshPanelAccessState({ force: true });
    }
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
  window.addEventListener(BACKEND_AUTH_STATE_EVENT, handleAuthStateChange);

  render();

  return {
    destroy() {
      destroyed = true;
      accessRefreshVersion += 1;
      closePanel();
      root.remove();
      root.removeEventListener("click", handleRootClick);
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleDocumentKeyDown);
      document.removeEventListener("i18n:change", handleStatusChange);
      window.removeEventListener(CLOUD_SYNC_STATUS_EVENT, handleStatusChange);
      window.removeEventListener(BACKEND_AUTH_STATE_EVENT, handleAuthStateChange);
    },
  };
}
