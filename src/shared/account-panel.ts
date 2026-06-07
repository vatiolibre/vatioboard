import "../styles/backend-auth.less";
import "../styles/account-panel.less";

import { t } from "../i18n.js";
import { IconClose, IconLogin, IconLogout } from "../icons.js";
import { clampElementToViewport, makePanelDraggable } from "../calculator/widget/drag.js";
import {
  BACKEND_AUTH_REQUEST_EVENT,
  BACKEND_AUTH_STATE_EVENT,
  createBackendAuthController,
  getBackendAuthStateSnapshot,
} from "./backend-auth.js";
import { getEnvironmentConfig } from "./environment.js";
import { registerFloatingPanel } from "./floating-layer-manager.js";
import { getDefaultShellWindowManager } from "./shell-window-manager.js";
import type { ShellLifecycleOptions, ShellRuntime } from "../types/shell";

const ACCOUNT_PANEL_WINDOW_ID = "account";
const ACCOUNT_PANEL_POS_KEY = "vatioboard.account_panel_pos.v1";
const ACCOUNT_PANEL_PROMPT_STATE_KEY = "vatioboard.account_panel_prompt_state.v1";
const ACCOUNT_PANEL_PROMPT_STATE_VERSION = 1;
const ACCOUNT_PANEL_MIN_WIDTH = 320;
const ACCOUNT_PANEL_MIN_HEIGHT = 400;
const AUTH_PROMPT_MODES = new Set(["silent", "soft", "required"]);

type AccountPanelOptions = {
  mount?: HTMLElement;
  shellManager?: ShellRuntime;
  authRequestGate?: Promise<unknown> | null;
  gatedAuthRequestFocus?: boolean;
};

type AccountPanelShowOptions = ShellLifecycleOptions & {
  focus?: boolean;
  authPromptMode?: string;
  blockedByAuth?: boolean;
  featureKey?: string;
  promptAuth?: boolean;
  reason?: string;
  source?: string;
};

type AccountPanelPromptState = {
  dismissedAtMs: number;
  featureKey: string | null;
  reason: string | null;
  source: string | null;
  version: number;
};

export type AccountPanelApi = {
  open: (options?: AccountPanelShowOptions) => void;
  close: (options?: ShellLifecycleOptions) => void;
  toggle: (options?: AccountPanelShowOptions) => void;
  destroy: () => void;
  getElement: () => HTMLElement;
};

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs: Record<string, string> = {},
) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
  return element;
}

function loadPanelPosition() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_PANEL_POS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePanelPosition(position: { panel?: { left?: string; top?: string } | null }) {
  try {
    localStorage.setItem(ACCOUNT_PANEL_POS_KEY, JSON.stringify(position));
  } catch {
    // Position is convenience state only.
  }
}

function normalizePromptState(value: unknown): AccountPanelPromptState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<AccountPanelPromptState>;
  const dismissedAtMs = Number(state.dismissedAtMs);
  if (!Number.isFinite(dismissedAtMs) || dismissedAtMs <= 0) return null;
  return {
    dismissedAtMs,
    featureKey: typeof state.featureKey === "string" ? state.featureKey : null,
    reason: typeof state.reason === "string" ? state.reason : null,
    source: typeof state.source === "string" ? state.source : null,
    version: Number(state.version) || ACCOUNT_PANEL_PROMPT_STATE_VERSION,
  };
}

function loadPromptState(): AccountPanelPromptState | null {
  try {
    return normalizePromptState(JSON.parse(localStorage.getItem(ACCOUNT_PANEL_PROMPT_STATE_KEY) || "null"));
  } catch {
    return null;
  }
}

function savePromptState(options: AccountPanelShowOptions = {}) {
  const state: AccountPanelPromptState = {
    dismissedAtMs: Date.now(),
    featureKey: typeof options.featureKey === "string" ? options.featureKey : null,
    reason: typeof options.reason === "string" ? options.reason : null,
    source: typeof options.source === "string" ? options.source : null,
    version: ACCOUNT_PANEL_PROMPT_STATE_VERSION,
  };
  try {
    localStorage.setItem(ACCOUNT_PANEL_PROMPT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Prompt dismissal is a UX preference only.
  }
}

function clearPromptState() {
  try {
    localStorage.removeItem(ACCOUNT_PANEL_PROMPT_STATE_KEY);
  } catch {
    // Best effort only.
  }
}

function getAuthPromptMode(detail: AccountPanelShowOptions = {}) {
  if (typeof detail.authPromptMode === "string" && AUTH_PROMPT_MODES.has(detail.authPromptMode)) {
    return detail.authPromptMode;
  }
  if (detail.promptAuth === true) return "required";
  if (detail.promptAuth === false) return "silent";
  return "soft";
}

function buildAccountAuthForm() {
  const form = createEl("form", "backend-auth vb-account-panel-auth");
  form.dataset.backendAuth = "";
  form.noValidate = true;

  form.innerHTML = `
    <div class="backend-auth-header">
      <div class="backend-auth-copy">
        <p class="backend-auth-title" data-i18n="authTitle">${t("authTitle")}</p>
        <p class="backend-auth-status" data-backend-auth-status role="status" aria-live="polite" data-i18n="authCheckingSession">${t("authCheckingSession")}</p>
      </div>
      <button class="backend-auth-logout-button" type="button" data-backend-auth-logout data-backend-auth-authenticated aria-label="${t("authLogout")}" title="${t("authLogout")}" data-i18n-aria="authLogout" data-i18n-title="authLogout">
        <span class="backend-auth-action-icon" aria-hidden="true">${IconLogout}</span>
        <span class="sr-only" data-i18n="authLogout">${t("authLogout")}</span>
      </button>
    </div>
    <div class="backend-auth-fields" data-backend-auth-guest>
      <input class="backend-auth-input" data-backend-auth-user type="text" autocomplete="username" spellcheck="false" aria-label="${t("authUsername")}" data-i18n-aria="authUsername" placeholder="${t("authUsername")}" data-i18n-placeholder="authUsername" />
      <input class="backend-auth-input" data-backend-auth-password type="password" autocomplete="current-password" aria-label="${t("authPassword")}" data-i18n-aria="authPassword" placeholder="${t("authPassword")}" data-i18n-placeholder="authPassword" />
    </div>
    <div class="backend-auth-actions" data-backend-auth-guest>
      <button class="backend-auth-login-button" type="submit" data-backend-auth-login>
        <span class="backend-auth-action-icon" aria-hidden="true">${IconLogin}</span>
        <span data-i18n="authLogin">${t("authLogin")}</span>
      </button>
      <div class="backend-auth-links">
        <a class="backend-auth-link" data-backend-auth-signup href="https://www.vatiolibre.com/login#signup" target="_blank" rel="noopener noreferrer" data-i18n="authCreateAccount">${t("authCreateAccount")}</a>
        <a class="backend-auth-link" data-backend-auth-forgot href="https://www.vatiolibre.com/login#forgot" target="_blank" rel="noopener noreferrer" data-i18n="authForgotPassword">${t("authForgotPassword")}</a>
      </div>
    </div>
  `;

  return form;
}

export function initAccountPanel({
  mount = document.body,
  shellManager = getDefaultShellWindowManager(),
  authRequestGate = null,
  gatedAuthRequestFocus = false,
}: AccountPanelOptions = {}): AccountPanelApi {
  const panel = createEl("section", "vb-account-panel", {
    role: "dialog",
    "aria-label": t("authTitle"),
    "data-vb-account-panel": "",
  });
  panel.hidden = true;
  panel.style.position = "fixed";
  panel.style.right = "max(14px, var(--vb-safe-area-right, 0px))";
  panel.style.bottom = "calc(84px + var(--vb-safe-area-bottom, 0px))";

  const header = createEl("header", "vb-account-panel-header");
  const headerMain = createEl("div", "vb-account-panel-header-main");
  const icon = createEl("span", "vb-account-panel-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = IconLogin;
  const copy = createEl("span", "vb-account-panel-copy");
  const title = createEl("strong", "vb-account-panel-title");
  title.dataset.i18n = "authTitle";
  title.textContent = t("authTitle");
  const state = createEl("span", "vb-account-panel-state");
  state.setAttribute("data-vb-account-panel-state", "");
  copy.append(title, state);
  headerMain.append(icon, copy);

  const closeButton = createEl("button", "vb-account-panel-close", {
    type: "button",
    "aria-label": "Close account panel",
    title: "Close account panel",
  }) as HTMLButtonElement;
  closeButton.innerHTML = IconClose;
  header.append(headerMain, closeButton);

  const body = createEl("div", "vb-account-panel-body");
  const authForm = buildAccountAuthForm();
  body.append(authForm);
  panel.append(header, body);
  mount.append(panel);

  const storedPosition = loadPanelPosition();
  if (storedPosition?.panel?.left && storedPosition?.panel?.top) {
    panel.style.left = storedPosition.panel.left;
    panel.style.top = storedPosition.panel.top;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  const showBackendAuthDebugControls = getEnvironmentConfig().backendAuthDebugControlsEnabled;
  const authController = createBackendAuthController({
    root: authForm,
    ...(showBackendAuthDebugControls
      ? {
          ssoUi: {
            showGuestSsoLogin: true,
            showAuthenticatedCrossOpenActions: true,
          },
        }
      : {}),
  });

  function savePos(position: { panel?: { left?: string; top?: string } | null }) {
    savePanelPosition(position);
    if (position?.panel?.left && position?.panel?.top) {
      shellManager.updateWindowBounds(ACCOUNT_PANEL_WINDOW_ID, {
        left: parseFloat(position.panel.left),
        top: parseFloat(position.panel.top),
      }, {
        preserveSnap: Boolean(shellManager.getWindow(ACCOUNT_PANEL_WINDOW_ID)?.snap),
      });
    }
  }

  function syncState(detail = getBackendAuthStateSnapshot()) {
    const authenticated = detail.authenticated === true;
    const busy = detail.busy === true;
    const label = busy
      ? t("authCheckingSession")
      : authenticated && detail.user
        ? t("authSignedInAs", { user: detail.user })
        : authenticated
          ? t("authSignedIn")
          : t("authSignedOut");
    state.textContent = label;
    state.dataset.authState = authenticated ? "authenticated" : "guest";
    state.dataset.authBusy = busy ? "true" : "false";
    if (authenticated) clearPromptState();
  }

  function showPanel({ focus = true }: AccountPanelShowOptions = {}) {
    panel.hidden = false;
    syncState();
    if (panel.style.left && panel.style.top) {
      clampElementToViewport(panel, 8, {
        useShellWorkArea: true,
        preferVisibleBottom: true,
      });
    }
    if (focus) {
      const target = authForm.querySelector<HTMLElement>(
        "[data-backend-auth-user]:not(:disabled), [data-backend-auth-login]:not(:disabled), [data-backend-auth-logout]:not([hidden]):not(:disabled)"
      );
      setTimeout(() => target?.focus?.({ preventScroll: true }), 0);
    }
  }

  function hidePanel() {
    panel.hidden = true;
  }

  function minimizePanel() {
    panel.hidden = true;
  }

  function open(options: AccountPanelShowOptions = {}) {
    showPanel(options);
    shellManager.openWindow(ACCOUNT_PANEL_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function close(options: ShellLifecycleOptions = {}) {
    if (activeAuthPrompt && options.source === "account-panel-close") {
      savePromptState(activeAuthPrompt);
      activeAuthPrompt = null;
    }
    hidePanel();
    shellManager.closeWindow(ACCOUNT_PANEL_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function toggle(options: AccountPanelShowOptions = {}) {
    panel.hidden ? open(options) : close(options);
  }

  const cleanupLayer = registerFloatingPanel(panel, {
    id: ACCOUNT_PANEL_WINDOW_ID,
    kind: "system",
    title: "Account",
    shellManager,
    restoreOnBoot: false,
    capabilities: {
      draggable: true,
      resizable: false,
      minimizable: true,
      closable: true,
      restorable: true,
      maximizable: false,
      snap: false,
      preserveIntrinsicWidth: true,
      minWidth: ACCOUNT_PANEL_MIN_WIDTH,
      minHeight: ACCOUNT_PANEL_MIN_HEIGHT,
      maxWidth: 380,
    },
    lifecycle: {
      open: (options = {}) => showPanel({ focus: false, ...options }),
      close: hidePanel,
      minimize: minimizePanel,
      restore: (options = {}) => showPanel({ focus: false, ...options }),
    },
  });

  makePanelDraggable({
    panel,
    header: headerMain,
    dragThresholdPx: 6,
    savePos,
    loadPos: loadPanelPosition,
    shellWindowId: ACCOUNT_PANEL_WINDOW_ID,
    shellManager,
    enableSnapPreview: false,
  });

  const handleAuthRequest = (event: Event) => {
    const detail = ((event as CustomEvent)?.detail || {}) as AccountPanelShowOptions;
    const authPromptMode = getAuthPromptMode(detail);
    if (authPromptMode === "silent") return;
    if (authPromptMode === "soft" && loadPromptState()) return;

    const explicitFocus = typeof detail.focus === "boolean";
    const options = {
      ...detail,
      authPromptMode,
      source: detail.source || "auth-request",
    };
    if (authRequestGatePending) {
      queuedAuthRequest = options;
      return;
    }
    activeAuthPrompt = options.blockedByAuth === true ? options : null;
    open({
      ...options,
      focus: explicitFocus ? detail.focus : true,
    });
  };
  const handleAuthState = (event: Event) => {
    syncState((event as CustomEvent).detail || undefined);
  };
  const handleLanguageChange = () => {
    title.textContent = t("authTitle");
    panel.setAttribute("aria-label", t("authTitle"));
    syncState();
  };
  const handleCloseClick = () => close({ source: "account-panel-close" });
  let destroyed = false;
  let authRequestGatePending = Boolean(authRequestGate);
  let queuedAuthRequest: AccountPanelShowOptions | null = null;
  let activeAuthPrompt: AccountPanelShowOptions | null = null;

  function releaseAuthRequestGate() {
    authRequestGatePending = false;
    if (destroyed || !queuedAuthRequest) return;
    const options = queuedAuthRequest;
    queuedAuthRequest = null;
    activeAuthPrompt = options.blockedByAuth === true ? options : null;
    open({
      ...options,
      focus: typeof options.focus === "boolean" ? options.focus : gatedAuthRequestFocus,
      source: options.source || "auth-request",
    });
  }

  if (authRequestGate) {
    authRequestGate.then(releaseAuthRequestGate, releaseAuthRequestGate);
  }

  closeButton.addEventListener("click", handleCloseClick);
  window.addEventListener(BACKEND_AUTH_REQUEST_EVENT, handleAuthRequest);
  window.addEventListener(BACKEND_AUTH_STATE_EVENT, handleAuthState);
  document.addEventListener("i18n:change", handleLanguageChange);
  syncState();

  return {
    open,
    close,
    toggle,
    destroy() {
      destroyed = true;
      queuedAuthRequest = null;
      closeButton.removeEventListener("click", handleCloseClick);
      window.removeEventListener(BACKEND_AUTH_REQUEST_EVENT, handleAuthRequest);
      window.removeEventListener(BACKEND_AUTH_STATE_EVENT, handleAuthState);
      document.removeEventListener("i18n:change", handleLanguageChange);
      authController?.destroy?.();
      cleanupLayer();
      panel.remove();
    },
    getElement: () => panel,
  };
}
