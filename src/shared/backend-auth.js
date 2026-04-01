import { t } from "../i18n.js";

export const BACKEND_AUTH_SIGNUP_URL = "https://www.vatiolibre.com/login#signup";
export const BACKEND_AUTH_FORGOT_URL = "https://www.vatiolibre.com/login#forgot";

const PROD_HOSTS = new Set(["vatioboard.com", "www.vatioboard.com"]);
// Use an allow_guest endpoint first so guest sessions do not trigger a visible 403.
const SESSION_PROBE_METHOD = "vatiolibre.services.tesla_connection_status";
const LOGGED_USER_METHOD = "frappe.auth.get_logged_user";
const FEATURE_ACCESS_METHOD = "vatiolibre.vatiolibre.feature_access.get_my_feature_access";
const SAVE_DRAWING_METHOD = "vatiolibre.vatiolibre.drawings.save_my_saved_drawing";

function getFetch(fetchImpl) {
  if (typeof fetchImpl === "function") return fetchImpl;
  if (typeof window?.fetch === "function") return window.fetch.bind(window);
  throw new Error("Fetch API is unavailable.");
}

function getMethodUrl(methodName, config) {
  return `${config.apiBase}/api/method/${methodName}`;
}

async function safeJson(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getMessage(data) {
  return data && Object.prototype.hasOwnProperty.call(data, "message")
    ? data.message
    : data;
}

function getLoggedUser(data) {
  const user = typeof getMessage(data) === "string" ? getMessage(data).trim() : "";
  return user && user !== "Guest" ? user : null;
}

function getText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getFeatureAccess(data) {
  const message = getMessage(data);
  return message && typeof message === "object" ? message : null;
}

async function fetchBackendJson(methodName, {
  method = "GET",
  headers,
  body,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  const request = getFetch(fetchImpl);
  const response = await request(getMethodUrl(methodName, config), {
    method,
    credentials: "include",
    headers,
    body,
  });

  return {
    response,
    data: await safeJson(response),
  };
}

function setHidden(elements, isHidden) {
  elements.forEach((element) => {
    element.hidden = isHidden;
  });
}

export function getBackendAuthConfig(location = window.location) {
  const host = String(location?.hostname || "").toLowerCase();

  return {
    frontendOrigin: String(location?.origin || ""),
    apiBase: PROD_HOSTS.has(host)
      ? "https://api.vatioboard.com"
      : "https://api.dev.vatioboard.com",
    signupUrl: BACKEND_AUTH_SIGNUP_URL,
    forgotUrl: BACKEND_AUTH_FORGOT_URL,
  };
}

export async function fetchBackendSession({ fetchImpl, config = getBackendAuthConfig() } = {}) {
  const { response, data } = await fetchBackendJson(SESSION_PROBE_METHOD, {
    fetchImpl,
    config,
  });
  const payload = getMessage(data);
  const isGuest = response.status === 401
    || response.status === 403
    || Boolean(payload?.is_guest);

  return {
    ok: response.ok || isGuest,
    status: response.status,
    data,
    isGuest,
    authenticated: response.ok && !isGuest,
  };
}

export async function fetchBackendLoggedUser({
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendJson(LOGGED_USER_METHOD, {
    fetchImpl,
    config,
  });

  return {
    ok: response.ok,
    status: response.status,
    data,
    user: getLoggedUser(data),
  };
}

export async function loginToBackend({
  username,
  password,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new URLSearchParams();
  body.set("usr", String(username || "").trim());
  body.set("pwd", String(password || ""));

  const request = getFetch(fetchImpl);
  const response = await request(getMethodUrl("login", config), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  return {
    ok: response.ok,
    status: response.status,
    data: await safeJson(response),
  };
}

export async function logoutFromBackend({ fetchImpl, config = getBackendAuthConfig() } = {}) {
  const { response, data } = await fetchBackendJson("logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    fetchImpl,
    config,
  });

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export function getSavedDrawingsCapability(featureAccessData) {
  const featureAccess = getFeatureAccess(featureAccessData);
  const savedDrawings = featureAccess?.features?.saved_drawings;

  return {
    hasActiveSubscription: featureAccess?.has_active_subscription === true,
    enabled: savedDrawings?.enabled === true,
    reason: getText(savedDrawings?.reason),
    csrfToken: getText(featureAccess?.csrf_token),
  };
}

export async function fetchBackendFeatureAccess({
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  const { response, data } = await fetchBackendJson(FEATURE_ACCESS_METHOD, {
    fetchImpl,
    config,
  });

  return {
    ok: response.ok,
    status: response.status,
    data,
    isGuest: response.status === 401 || response.status === 403,
    featureAccess: getFeatureAccess(data),
    capability: getSavedDrawingsCapability(data),
  };
}

export async function saveDrawingToBackend({
  fileBlob,
  fileName,
  title,
  imageWidth,
  imageHeight,
  csrfToken,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  const body = new FormData();

  if (!(fileBlob instanceof Blob)) {
    throw new Error("Drawing file is required.");
  }

  body.append("file", fileBlob, getText(fileName) || "drawing.png");

  const trimmedTitle = getText(title);
  if (trimmedTitle) {
    body.append("title", trimmedTitle);
  }

  if (Number.isFinite(imageWidth) && imageWidth > 0) {
    body.append("image_width", String(Math.round(imageWidth)));
  }

  if (Number.isFinite(imageHeight) && imageHeight > 0) {
    body.append("image_height", String(Math.round(imageHeight)));
  }

  const headers = {};

  if (getText(csrfToken)) {
    headers["X-Frappe-CSRF-Token"] = getText(csrfToken);
  }

  const { response, data } = await fetchBackendJson(SAVE_DRAWING_METHOD, {
    method: "POST",
    headers,
    body,
    fetchImpl,
    config,
  });
  const message = getMessage(data);

  return {
    ok: response.ok,
    status: response.status,
    data,
    drawing: message?.drawing ?? null,
  };
}

export function createBackendAuthController({
  root,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  if (!root) return null;

  const form = root.matches("form") ? root : root.querySelector("form");
  const statusEl = root.querySelector("[data-backend-auth-status]");
  const usernameInput = root.querySelector("[data-backend-auth-user]");
  const passwordInput = root.querySelector("[data-backend-auth-password]");
  const loginButton = root.querySelector("[data-backend-auth-login]");
  const logoutButton = root.querySelector("[data-backend-auth-logout]");
  const signupLink = root.querySelector("[data-backend-auth-signup]");
  const forgotLink = root.querySelector("[data-backend-auth-forgot]");
  const guestElements = Array.from(root.querySelectorAll("[data-backend-auth-guest]"));
  const authenticatedElements = Array.from(root.querySelectorAll("[data-backend-auth-authenticated]"));

  let busy = false;
  let currentUser = null;
  let statusKey = "authCheckingSession";
  let statusParams = null;
  let statusTone = "muted";

  if (signupLink && !signupLink.getAttribute("href")) {
    signupLink.href = config.signupUrl;
  }

  if (forgotLink && !forgotLink.getAttribute("href")) {
    forgotLink.href = config.forgotUrl;
  }

  function renderStatus() {
    if (!statusEl) return;
    statusEl.textContent = t(statusKey, statusParams || undefined);
    statusEl.dataset.tone = statusTone;
  }

  function setStatus(key, params, tone = "muted") {
    statusKey = key;
    statusParams = params || null;
    statusTone = tone;
    renderStatus();
  }

  function syncView() {
    const isAuthenticated = Boolean(currentUser);
    root.dataset.authState = isAuthenticated ? "authenticated" : "guest";
    root.dataset.authBusy = busy ? "true" : "false";

    setHidden(guestElements, isAuthenticated);
    setHidden(authenticatedElements, !isAuthenticated);
    if (signupLink) signupLink.hidden = isAuthenticated || busy;
    if (forgotLink) forgotLink.hidden = isAuthenticated || busy;

    if (usernameInput) usernameInput.disabled = busy;
    if (passwordInput) passwordInput.disabled = busy;
    if (loginButton) loginButton.disabled = busy;
    if (logoutButton) logoutButton.disabled = busy;
  }

  async function refreshSession(options = {}) {
    busy = true;
    setStatus("authCheckingSession");
    syncView();

    try {
      const session = await fetchBackendSession({ fetchImpl, config });

      if (!session.ok) {
        currentUser = null;
        setStatus("authSessionCheckFailed", { status: session.status }, "danger");
      } else if (session.isGuest) {
        currentUser = null;
        setStatus("authSignedOut");
      } else {
        currentUser = String(options.userHint || currentUser || "").trim() || null;
        try {
          const resolvedSession = await fetchBackendLoggedUser({ fetchImpl, config });
          if (resolvedSession.ok && resolvedSession.user) {
            currentUser = resolvedSession.user;
          }
        } catch {
          // Fall back to a generic signed-in state if the username lookup fails.
        }

        if (currentUser) {
          setStatus("authSignedInAs", { user: currentUser }, "success");
        } else {
          setStatus("authSignedIn", null, "success");
        }
      }
    } catch {
      currentUser = null;
      setStatus("authNetworkError", null, "danger");
    } finally {
      busy = false;
      syncView();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const username = String(usernameInput?.value || "").trim();
    const password = String(passwordInput?.value || "");

    if (!username || !password) {
      setStatus("authMissingCredentials", null, "danger");
      return;
    }

    busy = true;
    setStatus("authLoggingIn");
    syncView();

    try {
      const result = await loginToBackend({
        username,
        password,
        fetchImpl,
        config,
      });

      if (!result.ok) {
        busy = false;
        setStatus("authLoginFailed", { status: result.status }, "danger");
        syncView();
        return;
      }

      if (passwordInput) passwordInput.value = "";
      await refreshSession({ userHint: username });
    } catch {
      busy = false;
      setStatus("authNetworkError", null, "danger");
      syncView();
    }
  }

  async function handleLogout() {
    busy = true;
    setStatus("authLoggingOut");
    syncView();

    try {
      const result = await logoutFromBackend({ fetchImpl, config });

      if (!result.ok) {
        busy = false;
        setStatus("authLogoutFailed", { status: result.status }, "danger");
        syncView();
        return;
      }

      currentUser = null;
      await refreshSession();
    } catch {
      busy = false;
      setStatus("authNetworkError", null, "danger");
      syncView();
    }
  }

  function handleLanguageChange() {
    renderStatus();
  }

  form?.addEventListener("submit", handleSubmit);
  logoutButton?.addEventListener("click", handleLogout);
  document.addEventListener("i18n:change", handleLanguageChange);

  syncView();
  renderStatus();
  void refreshSession();

  return {
    refreshSession,
    destroy() {
      form?.removeEventListener("submit", handleSubmit);
      logoutButton?.removeEventListener("click", handleLogout);
      document.removeEventListener("i18n:change", handleLanguageChange);
    },
  };
}

export function initBackendAuthControllers({
  root = document,
  fetchImpl,
  config = getBackendAuthConfig(),
} = {}) {
  return Array.from(root.querySelectorAll("[data-backend-auth]"))
    .map((element) => createBackendAuthController({ root: element, fetchImpl, config }))
    .filter(Boolean);
}
