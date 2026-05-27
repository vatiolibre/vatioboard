import { t } from "../i18n.js";
import { IconClose } from "../icons.js";
import {
  BACKEND_AUTH_SIGNUP_URL,
  BACKEND_AUTH_STATE_EVENT,
  getBackendFeatureAccessState,
  getBackendSessionState,
  getSsoSubscribeUrl,
  getVatioLibreSubscribeUrl,
} from "./backend-auth.js";
import {
  CLOUD_SYNC_STATUS_EVENT,
  CLOUD_SYNC_STATUS_STATES,
  getCloudSyncStatus,
} from "./cloud-sync.js";

const translate = t as (key: string, params?: Record<string, unknown>) => string;

type CloudSyncState = typeof CLOUD_SYNC_STATUS_STATES[keyof typeof CLOUD_SYNC_STATUS_STATES];

interface CloudSyncStatusSnapshot {
  state?: unknown;
  reason?: unknown;
  [key: string]: unknown;
}

interface NormalizedCloudSyncStatus extends CloudSyncStatusSnapshot {
  state: CloudSyncState;
  reason: string;
}

interface PanelAccessState {
  authenticated: boolean | null;
  checking: boolean;
  cloudSyncEnabled: boolean | null;
  hasActiveSubscription: boolean | null;
  isGuest: boolean | null;
  pendingLogout: boolean;
  unavailable: boolean;
}

interface BackendAuthStateDetail {
  authenticated?: unknown;
  isGuest?: unknown;
  pendingLogout?: unknown;
}

interface BackendSessionState {
  ok?: boolean;
  authenticated?: boolean;
  isGuest?: boolean;
}

interface BackendFeatureCapability {
  enabled?: boolean;
  hasActiveSubscription?: boolean;
}

interface BackendFeatureAccessState {
  ok?: boolean;
  isGuest?: boolean;
  cloudSyncCapability?: BackendFeatureCapability | null;
}

interface BindPanelActionOptions {
  allowDefault?: boolean;
}

export interface CloudSyncStatusIndicatorOptions {
  mount?: HTMLElement | null;
  alignEnd?: boolean;
  openLauncher?: () => void;
}

export interface CloudSyncStatusIndicatorController {
  destroy(): void;
}

const CLOUD_SYNC_LABEL_KEYS: Readonly<Record<CloudSyncState, string>> = Object.freeze({
  [CLOUD_SYNC_STATUS_STATES.failed]: "cloudSyncFailed",
  [CLOUD_SYNC_STATUS_STATES.localOnly]: "cloudSyncLocalOnly",
  [CLOUD_SYNC_STATUS_STATES.paused]: "cloudSyncPaused",
  [CLOUD_SYNC_STATUS_STATES.synced]: "cloudSyncSynced",
  [CLOUD_SYNC_STATUS_STATES.syncing]: "cloudSyncSyncing",
});

const CLOUD_SYNC_HELP_KEYS: Readonly<Record<CloudSyncState, string>> = Object.freeze({
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

type PanelAudience = typeof PANEL_AUDIENCES[keyof typeof PANEL_AUDIENCES];

const OPERATIONAL_REASONS = new Set([
  "aborted",
  "error",
  "lease",
  "logout",
  "offline",
  "ownership",
  "unavailable",
]);

function normalizeCloudSyncState(value: unknown): CloudSyncState {
  return (Object.values(CLOUD_SYNC_STATUS_STATES) as unknown[]).includes(value)
    ? value as CloudSyncState
    : CLOUD_SYNC_STATUS_STATES.localOnly;
}

function setHidden(element: HTMLElement | null | undefined, isHidden: boolean): void {
  if (!element) return;
  element.hidden = isHidden;
}

function stopEventPropagation(event: Event): void {
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}

function getText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  return value === true ? true : value === false ? false : null;
}

function getNormalizedStatus(): NormalizedCloudSyncStatus {
  const status = getCloudSyncStatus() as CloudSyncStatusSnapshot;
  return {
    ...status,
    state: normalizeCloudSyncState(status?.state),
    reason: getText(status?.reason),
  };
}

function reasonSuggestsSubscription(reason: unknown): boolean {
  const normalized = getText(reason).toLowerCase();
  return (
    normalized === "disabled"
    || normalized.includes("subscription")
    || normalized.includes("suscripcion")
    || normalized.includes("suscripción")
  );
}

function isOperationalStatus(status: CloudSyncStatusSnapshot | null | undefined): boolean {
  const reason = getText(status?.reason).toLowerCase();
  return (
    OPERATIONAL_REASONS.has(reason)
    || status?.state === CLOUD_SYNC_STATUS_STATES.failed
  );
}

function createPanelAccessState(): PanelAccessState {
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

function derivePanelAudience(status: CloudSyncStatusSnapshot | null | undefined, accessState: PanelAccessState): PanelAudience {
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

function getPanelMessageKey(
  status: CloudSyncStatusSnapshot | null | undefined,
  accessState: PanelAccessState,
  audience: PanelAudience,
): string {
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

  return CLOUD_SYNC_HELP_KEYS[normalizeCloudSyncState(status?.state)] || "cloudSyncPanelUnknown";
}

function bindPanelAction(
  element: HTMLElement | null | undefined,
  closePanel: () => void,
  handler: (() => void) | null = null,
  { allowDefault = false }: BindPanelActionOptions = {},
): void {
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

function getSubscribeLinkHref(): string {
  try {
    return getSsoSubscribeUrl() || getVatioLibreSubscribeUrl();
  } catch {
    return getVatioLibreSubscribeUrl();
  }
}

export function initCloudSyncStatusIndicator({
  mount,
  alignEnd = false,
  openLauncher,
}: CloudSyncStatusIndicatorOptions = {}): CloudSyncStatusIndicatorController | null {
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
  subscribeLink.target = "_blank";
  subscribeLink.rel = "noopener noreferrer";

  const loginButton = document.createElement("button");
  loginButton.type = "button";
  loginButton.className = "cloud-sync-indicator-action";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "cloud-sync-indicator-close";
  closeButton.setAttribute("aria-label", translate("close"));
  closeButton.title = translate("close");
  closeButton.innerHTML = IconClose;

  actions.append(subscribeLink, loginButton);
  panel.append(closeButton, message, actions);
  root.append(button, panel);
  mount.append(root);

  let destroyed = false;
  let panelAccessState = createPanelAccessState();
  let accessRefreshVersion = 0;

  function closePanel(): void {
    root.classList.remove("is-open");
    setHidden(panel, true);
    button.setAttribute("aria-expanded", "false");
  }

  function togglePanel(): void {
    const nextOpen = Boolean(panel.hidden);
    root.classList.toggle("is-open", nextOpen);
    setHidden(panel, !nextOpen);
    button.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    if (nextOpen) {
      void refreshPanelAccessState({ force: true });
    }
    render();
  }

  function applyAuthStateDetail(detail: BackendAuthStateDetail = {}): void {
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

  async function refreshPanelAccessState({ force = false }: { force?: boolean } = {}): Promise<void> {
    const requestVersion = accessRefreshVersion + 1;
    accessRefreshVersion = requestVersion;
    panelAccessState = {
      ...panelAccessState,
      checking: true,
      unavailable: false,
    };
    render();

    try {
      const session = await getBackendSessionState({ force }) as BackendSessionState;
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

      const featureAccess = await getBackendFeatureAccessState({ force }) as BackendFeatureAccessState;
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

  function syncActions(status: NormalizedCloudSyncStatus, audience: PanelAudience): void {
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
      subscribeLink.target = "_blank";
      subscribeLink.rel = "noopener noreferrer";
      subscribeLink.textContent = translate("cloudSyncCreateAccount");
    } else if (audience === PANEL_AUDIENCES.noSubscription) {
      subscribeLink.href = getSubscribeLinkHref();
      subscribeLink.target = "_self";
      subscribeLink.removeAttribute("rel");
      subscribeLink.textContent = translate("cloudSyncSubscribe");
    } else {
      subscribeLink.href = getSubscribeLinkHref();
      subscribeLink.target = "_self";
      subscribeLink.removeAttribute("rel");
      subscribeLink.textContent = translate("cloudSyncManageSubscription");
    }

    loginButton.textContent = translate("authLogin");
    closeButton.setAttribute("aria-label", translate("close"));
    closeButton.title = translate("close");
  }

  function render(): void {
    if (destroyed) return;
    const status = getNormalizedStatus();
    const state = status.state;
    const audience = derivePanelAudience(status, panelAccessState);
    const labelKey = CLOUD_SYNC_LABEL_KEYS[state];
    const helpKey = getPanelMessageKey(status, panelAccessState, audience);
    const label = translate(labelKey);

    root.dataset.state = state;
    root.dataset.panelAudience = audience;
    button.dataset.state = state;
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.title = label;
    message.textContent = translate(helpKey);
    syncActions(status, audience);
  }

  function isEventInsideRoot(event: Event): boolean {
    return Boolean(event?.target && root.contains(event.target as Node));
  }

  function handleDocumentPointerDown(event: PointerEvent): void {
    if (panel.hidden || isEventInsideRoot(event)) return;
    closePanel();
  }

  function handleDocumentClick(event: MouseEvent): void {
    if (panel.hidden || isEventInsideRoot(event)) return;
    closePanel();
  }

  function handleRootClick(event: MouseEvent): void {
    stopEventPropagation(event);
  }

  function handleDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || panel.hidden) return;
    closePanel();
  }

  function handleStatusChange(): void {
    render();
  }

  function handleAuthStateChange(event: Event): void {
    applyAuthStateDetail((event as CustomEvent<BackendAuthStateDetail>)?.detail || {});
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
