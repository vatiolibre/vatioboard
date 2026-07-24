import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  BACKEND_AUTH_REQUEST_EVENT,
  BACKEND_AUTH_SSO_UI_DEFAULTS,
  buildBoardDocumentPreviewBffUrl,
  buildMediaBffUrl,
  clearBackendAccessCache,
  createBackendAuthController,
  downloadSyncPayloadFromBackend,
  getBackendAccelRunDetail,
  getBackendFeatureAccessState,
  getBackendManifestVersion,
  getBackendMediaAssetAccess,
  getBackendMediaAssetDetail,
  getBackendPlaylistDetail,
  getBackendPlaylistsManifest,
  getBackendPlaylistsManifestVersion,
  getBackendSessionState,
  getSsoStartUrl,
  getSsoSubscribeUrl,
  getVatioLibreOrigin,
  getVatioLibreSubscribeUrl,
  getProtectedMediaRequestGate,
  listBackendMediaAssets,
  listBackendPlaylists,
  normalizeBackendOwnedUrl,
  pushSyncChangesToBackend,
  startSubscriptionSso,
  startSso,
} from '../../src/shared/backend-auth.js';
import { getEnvironmentConfig } from '../../src/shared/environment.js';
import { applyTranslations } from '../../src/i18n.js';

const TEST_CONFIG = {
  apiBase: 'https://api.test.example',
};

// ── URL origins used in normalization tests ──────────────────────────
// Raw backend (admin) origins: intentional inputs representing URLs returned
// by the Frappe backend before BFF rewriting.  Do not remove — these prove
// that normalizeBackendOwnedUrl rewrites backend origins correctly.
const BACKEND_DEV_ORIGIN = 'https://dev.vatiolibre.com';
const BACKEND_PROD_ORIGIN = 'https://www.vatiolibre.com';
// Expected BFF-rewritten origins.
const DEV_BFF_ORIGIN = 'https://api.dev.vatioboard.com';
const PROD_BFF_ORIGIN = 'https://api.vatioboard.com';

afterEach(() => {
  clearBackendAccessCache();
  document.body.innerHTML = '';
});

describe('environment configuration', () => {
  it('maps production frontend hosts to the production API host', () => {
    expect(getEnvironmentConfig({
      hostname: 'vatioboard.com',
      origin: 'https://vatioboard.com',
    }).apiBase).toBe('https://api.vatioboard.com');

    expect(getEnvironmentConfig({
      hostname: 'www.vatioboard.com',
      origin: 'https://www.vatioboard.com',
    }).apiBase).toBe('https://api.vatioboard.com');
  });

  it('maps development hosts to the development API host with backend enabled', () => {
    expect(getEnvironmentConfig({
      hostname: 'dev.vatioboard.com',
      origin: 'https://dev.vatioboard.com',
    }).apiBase).toBe('https://api.dev.vatioboard.com');
    expect(getEnvironmentConfig({
      hostname: 'dev.vatioboard.com',
      origin: 'https://dev.vatioboard.com',
    }).backendEnabled).toBe(true);
  });

  it('keeps localhost on the development API host but disables backend calls by default', () => {
    const config = getEnvironmentConfig({
      hostname: 'localhost',
      origin: 'http://localhost:5173',
    });

    expect(config.apiBase).toBe('https://api.dev.vatioboard.com');
    expect(config.isLocalhost).toBe(true);
    expect(config.backendEnabled).toBe(false);
    expect(config.backendAuthDebugControlsEnabled).toBe(false);
  });

  it('allows local backend calls when explicitly enabled by environment', () => {
    expect(getEnvironmentConfig({
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:5174',
    }, {
      VITE_VATIOBOARD_BACKEND: 'on',
    }).backendEnabled).toBe(true);

    expect(getEnvironmentConfig({
      hostname: 'dev.vatioboard.com',
      origin: 'https://dev.vatioboard.com',
    }, {
      VITE_VATIOBOARD_BACKEND: 'off',
    }).backendEnabled).toBe(false);
  });

  it('keeps backend auth debug controls hidden unless explicitly enabled by environment', () => {
    expect(getEnvironmentConfig({
      hostname: 'vatioboard.com',
      origin: 'https://vatioboard.com',
    }).backendAuthDebugControlsEnabled).toBe(false);

    expect(getEnvironmentConfig({
      hostname: 'vatioboard.com',
      origin: 'https://vatioboard.com',
    }, {
      VITE_VATIOBOARD_BACKEND_AUTH_DEBUG_CONTROLS: 'on',
    }).backendAuthDebugControlsEnabled).toBe(true);

    expect(getEnvironmentConfig({
      hostname: 'vatioboard.com',
      origin: 'https://vatioboard.com',
    }, {
      VITE_VATIOBOARD_BACKEND_AUTH_DEBUG_CONTROLS: 'false',
    }).backendAuthDebugControlsEnabled).toBe(false);
  });
});

describe('backend auth SSO helpers', () => {
  const PROD_CONFIG = {
    apiBase: 'https://api.vatioboard.com',
    frontendOrigin: 'https://vatioboard.com',
    isProduction: true,
  };
  const DEV_CONFIG = {
    apiBase: 'https://api.dev.vatioboard.com',
    frontendOrigin: 'https://dev.vatioboard.com',
    isProduction: false,
  };

  it('builds the VatioLibre-backed board SSO URL', () => {
    const url = new URL(getSsoStartUrl(
      'board',
      'https://vatioboard.com/#/board',
      PROD_CONFIG
    ));

    expect(url.origin).toBe('https://api.vatioboard.com');
    expect(url.pathname).toBe('/api/method/vatiolibre.vatiolibre.sso.start');
    expect(url.searchParams.get('target')).toBe('board');
    expect(url.searchParams.get('redirect_to')).toBe('https://vatioboard.com/#/board');
  });

  it('preserves hash routes in redirect_to', () => {
    const url = new URL(getSsoStartUrl(
      'board',
      'https://vatioboard.com/#/library',
      PROD_CONFIG
    ));

    expect(url.searchParams.get('redirect_to')).toBe('https://vatioboard.com/#/library');
  });

  it('builds the VatioLibre target SSO URL for the development API host', () => {
    const url = new URL(getSsoStartUrl(
      'libre',
      'https://dev.vatiolibre.com/fleet',
      DEV_CONFIG
    ));

    expect(url.origin).toBe('https://api.dev.vatioboard.com');
    expect(url.searchParams.get('target')).toBe('libre');
    expect(url.searchParams.get('redirect_to')).toBe('https://dev.vatiolibre.com/fleet');
    expect(getVatioLibreOrigin(DEV_CONFIG)).toBe('https://dev.vatiolibre.com');
  });

  it('builds direct subscribe URLs from the VatioLibre origin', () => {
    expect(getVatioLibreSubscribeUrl(DEV_CONFIG)).toBe('https://dev.vatiolibre.com/subscribe');
    expect(getVatioLibreSubscribeUrl(PROD_CONFIG)).toBe('https://vatiolibre.com/subscribe');
    expect(getVatioLibreSubscribeUrl({
      ...PROD_CONFIG,
      vatioLibreOrigin: 'https://www.vatiolibre.com',
    })).toBe('https://www.vatiolibre.com/subscribe');
  });

  it('builds the VatioLibre subscribe SSO URL', () => {
    const url = new URL(getSsoSubscribeUrl(DEV_CONFIG));

    expect(url.origin).toBe('https://api.dev.vatioboard.com');
    expect(url.pathname).toBe('/api/method/vatiolibre.vatiolibre.sso.start');
    expect(url.searchParams.get('target')).toBe('libre');
    expect(url.searchParams.get('redirect_to')).toBe('https://dev.vatiolibre.com/subscribe');
  });

  it('does not construct SSO URLs for unsafe redirect targets', () => {
    expect(getSsoStartUrl('board', 'javascript:alert(1)', PROD_CONFIG)).toBe('');
    expect(getSsoStartUrl('board', '//evil.example/#/board', PROD_CONFIG)).toBe('');
    expect(getSsoStartUrl('board', 'https://evil.example/#/board', PROD_CONFIG)).toBe('');
    expect(getSsoStartUrl('libre', 'https://vatioboard.com/#/board', PROD_CONFIG)).toBe('');
  });

  it('uses top-level navigation for SSO starts', () => {
    const location = {
      href: 'https://vatioboard.com/#/board',
      assign: vi.fn(),
    };

    expect(startSso('board', 'https://vatioboard.com/#/board', {
      config: PROD_CONFIG,
      location,
    })).toBe(true);
    expect(location.assign).toHaveBeenCalledTimes(1);
    expect(location.assign.mock.calls[0][0]).toContain(
      '/api/method/vatiolibre.vatiolibre.sso.start'
    );
  });

  it('opens VatioLibre through the dev SSO bridge with the fleet redirect', () => {
    const location = {
      href: 'https://dev.vatioboard.com/#/board',
      assign: vi.fn(),
    };

    expect(startSso('libre', 'https://dev.vatiolibre.com/fleet', {
      config: DEV_CONFIG,
      location,
    })).toBe(true);

    const url = new URL(location.assign.mock.calls[0][0]);
    expect(url.origin).toBe('https://api.dev.vatioboard.com');
    expect(url.pathname).toBe('/api/method/vatiolibre.vatiolibre.sso.start');
    expect(url.searchParams.get('target')).toBe('libre');
    expect(url.searchParams.get('redirect_to')).toBe('https://dev.vatiolibre.com/fleet');
  });

  it('starts subscription SSO with top-level navigation', () => {
    const location = {
      href: 'https://dev.vatioboard.com/#/board',
      assign: vi.fn(),
    };

    expect(startSubscriptionSso({
      config: DEV_CONFIG,
      location,
    })).toBe(true);

    const url = new URL(location.assign.mock.calls[0][0]);
    expect(url.origin).toBe('https://api.dev.vatioboard.com');
    expect(url.searchParams.get('target')).toBe('libre');
    expect(url.searchParams.get('redirect_to')).toBe('https://dev.vatiolibre.com/subscribe');
  });
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function waitForExpect(assertion, attempts = 25) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
      await Promise.resolve();
    }
  }
  throw lastError;
}

describe('backend auth controller layout', () => {
  it('normalizes legacy auth form markup into the shared compact structure', () => {
    document.body.innerHTML = `
      <form class="backend-auth" data-backend-auth novalidate>
        <p class="backend-auth-title" data-i18n="authTitle">VatioLibre account</p>
        <p class="backend-auth-status" data-backend-auth-status role="status" aria-live="polite" data-i18n="authCheckingSession">Checking session...</p>
        <input class="backend-auth-input" data-backend-auth-user data-backend-auth-guest type="text" />
        <input class="backend-auth-input" data-backend-auth-password data-backend-auth-guest type="password" />
        <button type="submit" data-backend-auth-login data-backend-auth-guest data-i18n="authLogin">Log in</button>
        <button type="button" data-backend-auth-logout data-backend-auth-authenticated data-i18n="authLogout">Log out</button>
        <a class="backend-auth-link" data-backend-auth-guest data-backend-auth-signup href="#">Create account</a>
        <a class="backend-auth-link" data-backend-auth-guest data-backend-auth-forgot href="#">Forgot password</a>
      </form>
    `;

    const form = document.querySelector('[data-backend-auth]');
    const controller = createBackendAuthController({
      root: form,
      config: TEST_CONFIG,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ message: { is_guest: true } })),
    });

    expect(form.dataset.authLayout).toBe('normalized');
    expect(BACKEND_AUTH_SSO_UI_DEFAULTS).toEqual({
      showGuestSsoLogin: false,
      showAuthenticatedCrossOpenActions: false,
    });
    expect(form.querySelector('.backend-auth-header .backend-auth-copy .backend-auth-title')).toBeTruthy();
    expect(form.querySelector('.backend-auth-header .backend-auth-logout-button')).toBeTruthy();
    expect(form.querySelector('.backend-auth-fields [data-backend-auth-user]')).toBeTruthy();
    expect(form.querySelector('.backend-auth-fields .backend-auth-password-wrap [data-backend-auth-password]')).toBeTruthy();
    expect(form.querySelector('.backend-auth-actions .backend-auth-login-button .backend-auth-action-icon svg')).toBeTruthy();
    expect(form.querySelector('.backend-auth-actions .backend-auth-links [data-backend-auth-forgot]')).toBeTruthy();
    expect(form.querySelector('.backend-auth-sso-button')).toBeNull();
    expect(form.querySelector('[data-backend-auth-sso-board]')).toBeNull();
    expect(form.textContent).not.toContain('Continue with VatioLibre');
    expect(form.querySelector('.backend-auth-open-libre-button')).toBeNull();
    expect(form.querySelector('.backend-auth-open-board-button')).toBeNull();
    expect(form.querySelector('[data-backend-auth-open-libre]')).toBeNull();
    expect(form.querySelector('[data-backend-auth-open-board]')).toBeNull();
    expect(form.querySelector('.backend-auth-authenticated-actions')).toBeNull();

    const loginButton = form.querySelector('[data-backend-auth-login]');
    const logoutButton = form.querySelector('[data-backend-auth-logout]');
    const signupLink = form.querySelector('[data-backend-auth-signup]');
    const forgotLink = form.querySelector('[data-backend-auth-forgot]');
    expect(loginButton.getAttribute('data-i18n')).toBeNull();
    expect(loginButton.querySelector("[data-i18n='authLogin']")).toBeTruthy();
    expect(logoutButton.getAttribute('aria-label')).toBe('Log out');
    expect(logoutButton.querySelector("[data-i18n='authLogout']")).toBeTruthy();
    expect(signupLink.getAttribute('target')).toBe('_blank');
    expect(signupLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(forgotLink.getAttribute('target')).toBe('_blank');
    expect(forgotLink.getAttribute('rel')).toBe('noopener noreferrer');

    controller.destroy();
  });

  it('removes legacy SSO controls when the default display policy hides them', () => {
    document.body.innerHTML = `
      <form class="backend-auth" data-backend-auth novalidate>
        <p class="backend-auth-title" data-i18n="authTitle">VatioLibre account</p>
        <p class="backend-auth-status" data-backend-auth-status role="status" aria-live="polite" data-i18n="authCheckingSession">Checking session...</p>
        <input class="backend-auth-input" data-backend-auth-user data-backend-auth-guest type="text" />
        <input class="backend-auth-input" data-backend-auth-password data-backend-auth-guest type="password" />
        <div class="backend-auth-actions" data-backend-auth-guest>
          <button type="button" class="backend-auth-sso-button" data-backend-auth-sso-board data-backend-auth-guest>Continue with VatioLibre</button>
          <button type="submit" data-backend-auth-login data-backend-auth-guest data-i18n="authLogin">Log in</button>
        </div>
        <button type="button" data-backend-auth-logout data-backend-auth-authenticated data-i18n="authLogout">Log out</button>
        <div class="backend-auth-authenticated-actions" data-backend-auth-authenticated>
          <button type="button" class="backend-auth-open-libre-button" data-backend-auth-open-libre>Open VatioLibre</button>
          <button type="button" class="backend-auth-open-board-button" data-backend-auth-open-board>Open VatioBoard</button>
        </div>
      </form>
    `;

    const form = document.querySelector('[data-backend-auth]');
    const controller = createBackendAuthController({
      root: form,
      config: TEST_CONFIG,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ message: { is_guest: true } })),
    });

    expect(form.querySelector('[data-backend-auth-sso-board]')).toBeNull();
    expect(form.querySelector('[data-backend-auth-open-libre]')).toBeNull();
    expect(form.querySelector('[data-backend-auth-open-board]')).toBeNull();
    expect(form.querySelector('.backend-auth-authenticated-actions')).toBeNull();

    controller.destroy();
  });

  it('renders and submits username/password login without first-login SSO controls', async () => {
    document.body.innerHTML = `
      <form class="backend-auth" data-backend-auth novalidate>
        <p class="backend-auth-title" data-i18n="authTitle">VatioLibre account</p>
        <p class="backend-auth-status" data-backend-auth-status role="status" aria-live="polite" data-i18n="authCheckingSession">Checking session...</p>
        <input class="backend-auth-input" data-backend-auth-user data-backend-auth-guest type="text" />
        <input class="backend-auth-input" data-backend-auth-password data-backend-auth-guest type="password" />
        <button type="submit" data-backend-auth-login data-backend-auth-guest data-i18n="authLogin">Log in</button>
        <button type="button" data-backend-auth-logout data-backend-auth-authenticated data-i18n="authLogout">Log out</button>
      </form>
    `;

    let loggedIn = false;
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/api/method/login')) {
        expect(options.method).toBe('POST');
        expect(String(options.body)).toContain('usr=driver%40example.com');
        loggedIn = true;
        return jsonResponse({ message: 'Logged In' });
      }
      if (requestUrl.includes('frappe.auth.get_logged_user')) {
        return jsonResponse({ message: 'driver@example.com' });
      }
      if (requestUrl.includes('vatiolibre.vatiolibre.sso.status')) {
        expect(options.method).toBe('GET');
        return jsonResponse({ message: { is_guest: !loggedIn } });
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });
    const form = document.querySelector('[data-backend-auth]');
    const controller = createBackendAuthController({
      root: form,
      config: TEST_CONFIG,
      fetchImpl,
    });

    await waitForExpect(() => {
      expect(form.querySelector('[data-backend-auth-status]').textContent).toBe('Signed out');
    });

    expect(form.querySelector('[data-backend-auth-login]')).toBeTruthy();
    expect(form.querySelector('[data-backend-auth-sso-board]')).toBeNull();

    form.querySelector('[data-backend-auth-user]').value = 'driver@example.com';
    form.querySelector('[data-backend-auth-password]').value = 'secret';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitForExpect(() => {
      expect(form.querySelector('[data-backend-auth-status]').textContent).toBe(
        'Signed in as driver@example.com'
      );
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test.example/api/method/login',
      expect.objectContaining({ method: 'POST' })
    );

    controller.destroy();
  });

  it('renders logout for authenticated sessions and logs out without cross-open controls', async () => {
    document.body.innerHTML = `
      <form class="backend-auth" data-backend-auth novalidate>
        <p class="backend-auth-title" data-i18n="authTitle">VatioLibre account</p>
        <p class="backend-auth-status" data-backend-auth-status role="status" aria-live="polite" data-i18n="authCheckingSession">Checking session...</p>
        <input class="backend-auth-input" data-backend-auth-user data-backend-auth-guest type="text" />
        <input class="backend-auth-input" data-backend-auth-password data-backend-auth-guest type="password" />
        <button type="submit" data-backend-auth-login data-backend-auth-guest data-i18n="authLogin">Log in</button>
        <button type="button" data-backend-auth-logout data-backend-auth-authenticated data-i18n="authLogout">Log out</button>
      </form>
    `;

    let loggedIn = true;
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/api/method/logout')) {
        loggedIn = false;
        return jsonResponse({ message: 'Logged Out' });
      }
      if (requestUrl.includes('frappe.auth.get_logged_user')) {
        return jsonResponse({ message: 'driver@example.com' });
      }
      if (requestUrl.includes('vatiolibre.vatiolibre.sso.status')) {
        expect(options.method).toBe('GET');
        return jsonResponse({ message: { is_guest: !loggedIn } });
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });
    const form = document.querySelector('[data-backend-auth]');
    const controller = createBackendAuthController({
      root: form,
      config: TEST_CONFIG,
      fetchImpl,
    });

    await waitForExpect(() => {
      expect(form.querySelector('[data-backend-auth-status]').textContent).toBe(
        'Signed in as driver@example.com'
      );
    });

    const logoutButton = form.querySelector('[data-backend-auth-logout]');
    expect(logoutButton.hidden).toBe(false);
    expect(form.querySelector('[data-backend-auth-open-libre]')).toBeNull();
    expect(form.querySelector('[data-backend-auth-open-board]')).toBeNull();

    logoutButton.click();

    await waitForExpect(() => {
      expect(form.querySelector('[data-backend-auth-status]').textContent).toBe('Signed out');
    });
    expect(logoutButton.hidden).toBe(true);

    controller.destroy();
  });

  it('renders debug SSO controls when explicitly enabled and keeps handlers wired', async () => {
    document.body.innerHTML = `
      <form class="backend-auth" data-backend-auth novalidate>
        <p class="backend-auth-title" data-i18n="authTitle">VatioLibre account</p>
        <p class="backend-auth-status" data-backend-auth-status role="status" aria-live="polite" data-i18n="authCheckingSession">Checking session...</p>
        <input class="backend-auth-input" data-backend-auth-user data-backend-auth-guest type="text" />
        <input class="backend-auth-input" data-backend-auth-password data-backend-auth-guest type="password" />
        <button type="submit" data-backend-auth-login data-backend-auth-guest data-i18n="authLogin">Log in</button>
        <button type="button" data-backend-auth-logout data-backend-auth-authenticated data-i18n="authLogout">Log out</button>
      </form>
    `;

    const location = {
      assign: vi.fn(),
      hash: '#/library',
      href: 'https://vatioboard.com/#/library',
      pathname: '/',
      search: '',
    };
    const config = {
      apiBase: 'https://api.vatioboard.com',
      frontendOrigin: 'https://vatioboard.com',
      isProduction: true,
    };
    const form = document.querySelector('[data-backend-auth]');
    const controller = createBackendAuthController({
      root: form,
      config,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ message: { is_guest: true } })),
      location,
      ssoUi: {
        showGuestSsoLogin: true,
        showAuthenticatedCrossOpenActions: true,
      },
    });

    await waitForExpect(() => {
      expect(form.querySelector('[data-backend-auth-status]').textContent).toBe('Signed out');
    });

    expect(form.querySelector('.backend-auth-sso-button [data-i18n="authContinueWithVatioLibre"]')).toBeTruthy();
    expect(form.querySelector('.backend-auth-authenticated-actions [data-backend-auth-open-libre]')).toBeTruthy();
    expect(form.querySelector('.backend-auth-authenticated-actions [data-backend-auth-open-board]')).toBeTruthy();

    form.querySelector('[data-backend-auth-sso-board]').click();
    let url = new URL(location.assign.mock.calls.at(-1)[0]);
    expect(url.pathname).toBe('/api/method/vatiolibre.vatiolibre.sso.start');
    expect(url.searchParams.get('target')).toBe('board');
    expect(url.searchParams.get('redirect_to')).toBe('https://vatioboard.com/#/library');

    form.querySelector('[data-backend-auth-open-libre]').click();
    url = new URL(location.assign.mock.calls.at(-1)[0]);
    expect(url.searchParams.get('target')).toBe('libre');
    expect(url.searchParams.get('redirect_to')).toBe('https://vatiolibre.com/fleet');

    form.querySelector('[data-backend-auth-open-board]').click();
    url = new URL(location.assign.mock.calls.at(-1)[0]);
    expect(url.searchParams.get('target')).toBe('board');
    expect(url.searchParams.get('redirect_to')).toBe('https://vatioboard.com/#/library');

    controller.destroy();
  });

  it('keeps dynamic auth status from being reset by later global translation passes', async () => {
    document.body.innerHTML = `
      <form class="backend-auth" data-backend-auth novalidate>
        <p class="backend-auth-title" data-i18n="authTitle">VatioLibre account</p>
        <p class="backend-auth-status" data-backend-auth-status role="status" aria-live="polite" data-i18n="authCheckingSession">Checking session...</p>
        <input class="backend-auth-input" data-backend-auth-user data-backend-auth-guest type="text" />
        <input class="backend-auth-input" data-backend-auth-password data-backend-auth-guest type="password" />
        <button type="submit" data-backend-auth-login data-backend-auth-guest data-i18n="authLogin">Log in</button>
        <button type="button" data-backend-auth-logout data-backend-auth-authenticated data-i18n="authLogout">Log out</button>
      </form>
    `;

    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('frappe.auth.get_logged_user')) {
        return jsonResponse({ message: 'Administrator' });
      }
      return jsonResponse({ message: { is_guest: false } });
    });
    const form = document.querySelector('[data-backend-auth]');
    const controller = createBackendAuthController({
      root: form,
      config: TEST_CONFIG,
      fetchImpl,
    });

    await controller.refreshSession({ force: true });
    const status = form.querySelector('[data-backend-auth-status]');

    expect(status.textContent).toBe('Signed in as Administrator');
    expect(status.dataset.tone).toBe('success');
    expect(status.getAttribute('data-i18n')).toBeNull();

    applyTranslations();

    expect(status.textContent).toBe('Signed in as Administrator');
    expect(status.dataset.tone).toBe('success');

    controller.destroy();
  });

  it('keeps the icon logout button out of the full-width auth button selector', () => {
    const css = readFileSync('src/styles/backend-auth.less', 'utf8');

    expect(css).toContain(
      '.backend-auth button:not(.backend-auth-password-toggle):not(.backend-auth-logout-button)'
    );
    expect(css).toContain('.backend-auth .backend-auth-header .backend-auth-logout-button');
    expect(css).toContain('justify-content: center;');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(css).toContain('.backend-auth .sr-only');
  });
});

async function gzipText(text) {
  const sourceStream = new Response(text, {
    headers: {
      'Content-Type': 'application/json',
    },
  }).body;
  if (!sourceStream) {
    throw new Error('Compression source stream is unavailable.');
  }

  const compressedStream = sourceStream.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(compressedStream).arrayBuffer());
}

async function gunzipText(bytes) {
  const sourceStream = new Response(bytes, {
    headers: {
      'Content-Type': 'application/gzip',
    },
  }).body;
  if (!sourceStream) {
    throw new Error('Decompression source stream is unavailable.');
  }

  const decompressedStream = sourceStream.pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressedStream).text();
}

describe('backend auth transport helpers', () => {
  it('rewrites backend-owned media URLs to the configured BFF origin', () => {
    // Raw dev backend origin → dev BFF
    expect(normalizeBackendOwnedUrl(
      `${BACKEND_DEV_ORIGIN}/api/method/vatiolibre.vatiolibre.drawings.get_my_saved_drawing_detail?name=DRAW-1`,
      {
        config: {
          apiBase: DEV_BFF_ORIGIN,
        },
      }
    )).toBe(
      `${DEV_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.drawings.get_my_saved_drawing_detail?name=DRAW-1`
    );

    // Raw prod backend origin → prod BFF
    expect(normalizeBackendOwnedUrl(
      `${BACKEND_PROD_ORIGIN}/api/method/vatiolibre.vatiolibre.drawings.download_my_saved_drawing?name=DRAW-2&as_attachment=1`,
      {
        config: {
          apiBase: PROD_BFF_ORIGIN,
        },
      }
    )).toBe(
      `${PROD_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.drawings.download_my_saved_drawing?name=DRAW-2&as_attachment=1`
    );

    // Relative path → prepended with BFF origin
    expect(normalizeBackendOwnedUrl('/api/method/vatiolibre.vatiolibre.drawings.get_my_saved_drawing_detail?name=DRAW-3', {
      config: {
        apiBase: DEV_BFF_ORIGIN,
      },
    })).toBe(
      `${DEV_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.drawings.get_my_saved_drawing_detail?name=DRAW-3`
    );

    expect(normalizeBackendOwnedUrl('/files/skidpad.png?token=view#preview', {
      config: {
        apiBase: PROD_BFF_ORIGIN,
      },
    })).toBe(`${PROD_BFF_ORIGIN}/files/skidpad.png?token=view#preview`);

    expect(normalizeBackendOwnedUrl('/private/files/skidpad.png?download=1', {
      config: {
        apiBase: DEV_BFF_ORIGIN,
      },
    })).toBe(`${DEV_BFF_ORIGIN}/private/files/skidpad.png?download=1`);

    // Third-party CDN URL passes through unchanged
    expect(normalizeBackendOwnedUrl('https://cdn.example.com/skidpad.png?token=view', {
      config: {
        apiBase: PROD_BFF_ORIGIN,
      },
    })).toBe('https://cdn.example.com/skidpad.png?token=view');
  });

  it('normalizes media asset URLs returned by shared list/detail helpers', async () => {
    // Mock responses simulate raw backend-origin URLs the Frappe API returns.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        message: {
          assets: [
            {
              name: 'MEDIA-1',
              title: 'Skidpad',
              media_kind: 'audio',
              preview_image_url: `${BACKEND_PROD_ORIGIN}/files/skidpad.png?token=view#preview`,
              download_url: `${BACKEND_PROD_ORIGIN}/private/files/skidpad.png?download=1`,
              export_url: '/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1&as_attachment=1',
              playback_url: `${BACKEND_PROD_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
            },
          ],
          total_count: 1,
          has_more: false,
          next_offset: 1,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        message: {
          asset: {
            name: 'MEDIA-1',
            title: 'Skidpad',
            media_kind: 'video',
            preview_image_url: `${BACKEND_DEV_ORIGIN}/files/skidpad.png?token=view#preview`,
            download_url: '/private/files/skidpad.png?download=1',
            export_url: 'https://127.0.0.1/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1',
            playback_url: `${BACKEND_DEV_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
          },
        },
      }));

    const listResult = await listBackendMediaAssets({
      fetchImpl,
      config: {
        apiBase: PROD_BFF_ORIGIN,
      },
    });

    const detailResult = await getBackendMediaAssetDetail({
      name: 'MEDIA-1',
      fetchImpl,
      config: {
        apiBase: DEV_BFF_ORIGIN,
      },
    });

    expect(listResult.assets).toEqual([
      expect.objectContaining({
        preview_image_url: `${PROD_BFF_ORIGIN}/files/skidpad.png?token=view#preview`,
        download_url: `${PROD_BFF_ORIGIN}/private/files/skidpad.png?download=1`,
        export_url: `${PROD_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1&as_attachment=1`,
        playback_url: `${PROD_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
      }),
    ]);
    expect(detailResult.asset).toEqual(expect.objectContaining({
      preview_image_url: `${DEV_BFF_ORIGIN}/files/skidpad.png?token=view#preview`,
      download_url: `${DEV_BFF_ORIGIN}/private/files/skidpad.png?download=1`,
      export_url: `${DEV_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
      playback_url: `${DEV_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
    }));
  });

  it('rewrites playback_url from backend origin to the configured BFF origin', () => {
    expect(normalizeBackendOwnedUrl(
      `${BACKEND_DEV_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`,
      { config: { apiBase: DEV_BFF_ORIGIN } },
    )).toBe(`${DEV_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`);
  });

  it('rewrites relative playback_url to the configured BFF origin', () => {
    expect(normalizeBackendOwnedUrl(
      '/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1',
      { config: { apiBase: PROD_BFF_ORIGIN } },
    )).toBe(`${PROD_BFF_ORIGIN}/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset?name=MEDIA-1`);
  });

  it('returns a local-only guest session without fetching when backend calls are disabled', async () => {
    clearBackendAccessCache();
    const fetchImpl = vi.fn();

    const session = await getBackendSessionState({
      fetchImpl,
      config: {
        ...TEST_CONFIG,
        backendEnabled: false,
        frontendOrigin: 'http://localhost:5174',
      },
    });

    expect(session).toMatchObject({
      ok: true,
      status: 0,
      isGuest: true,
      authenticated: false,
      localOnly: true,
      reason: 'local_only',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks protected media locally without fetching or requesting auth when backend calls are disabled', async () => {
    clearBackendAccessCache();
    const fetchImpl = vi.fn();
    const authRequests = [];
    const handleAuthRequest = (event) => {
      authRequests.push(event.detail);
    };
    window.addEventListener(BACKEND_AUTH_REQUEST_EVENT, handleAuthRequest);

    try {
      const gate = await getProtectedMediaRequestGate({
        fetchImpl,
        config: {
          ...TEST_CONFIG,
          backendEnabled: false,
          frontendOrigin: 'http://localhost:5174',
        },
      });

      expect(gate).toMatchObject({
        allowed: false,
        blockedByAuth: true,
        featureKey: 'media_assets',
        reason: 'local_only',
        status: 0,
      });
      expect(gate.session).toMatchObject({
        isGuest: true,
        localOnly: true,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(authRequests).toHaveLength(0);
    } finally {
      window.removeEventListener(BACKEND_AUTH_REQUEST_EVENT, handleAuthRequest);
    }
  });

  it('keeps protected media gates silent for guest sessions by default', async () => {
    clearBackendAccessCache();
    const fetchImpl = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('vatiolibre.vatiolibre.sso.status')) {
        return jsonResponse({
          message: {
            is_guest: true,
          },
        });
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });
    const authRequests = [];
    const handleAuthRequest = (event) => {
      authRequests.push(event.detail);
    };
    window.addEventListener(BACKEND_AUTH_REQUEST_EVENT, handleAuthRequest);

    try {
      const gate = await getProtectedMediaRequestGate({
        fetchImpl,
        config: TEST_CONFIG,
      });

      expect(gate).toMatchObject({
        allowed: false,
        blockedByAuth: true,
        featureKey: 'media_assets',
        reason: 'guest',
        status: 401,
      });
      expect(authRequests).toHaveLength(0);
    } finally {
      window.removeEventListener(BACKEND_AUTH_REQUEST_EVENT, handleAuthRequest);
    }
  });

  it('dispatches a required login prompt for protected media gates when requested', async () => {
    clearBackendAccessCache();
    const fetchImpl = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('vatiolibre.vatiolibre.sso.status')) {
        return jsonResponse({
          message: {
            is_guest: true,
          },
        });
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });
    const authRequests = [];
    const handleAuthRequest = (event) => {
      authRequests.push(event.detail);
    };
    window.addEventListener(BACKEND_AUTH_REQUEST_EVENT, handleAuthRequest);

    try {
      const gate = await getProtectedMediaRequestGate({
        fetchImpl,
        config: TEST_CONFIG,
        promptAuth: true,
        authPromptMode: 'required',
        source: 'media-playback',
      });

      expect(gate).toMatchObject({
        allowed: false,
        blockedByAuth: true,
        featureKey: 'media_assets',
        reason: 'guest',
        status: 401,
      });
      expect(authRequests).toEqual([
        expect.objectContaining({
          authPromptMode: 'required',
          blockedByAuth: true,
          featureKey: 'media_assets',
          promptAuth: true,
          reason: 'guest',
          source: 'media-playback',
        }),
      ]);
    } finally {
      window.removeEventListener(BACKEND_AUTH_REQUEST_EVENT, handleAuthRequest);
    }
  });

  it('returns a synthetic disabled response without fetching for direct backend helpers', async () => {
    const fetchImpl = vi.fn();

    const result = await listBackendMediaAssets({
      fetchImpl,
      config: {
        ...TEST_CONFIG,
        backendEnabled: false,
        frontendOrigin: 'http://localhost:5174',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      assets: [],
      totalCount: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('dedupes concurrent session probes', async () => {
    clearBackendAccessCache();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      message: {
        is_guest: false,
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    const [first, second] = await Promise.all([
      getBackendSessionState({
        fetchImpl,
        config: TEST_CONFIG,
      }),
      getBackendSessionState({
        fetchImpl,
        config: TEST_CONFIG,
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps rejected cached session probes observed while still rejecting callers', async () => {
    clearBackendAccessCache();
    const unhandled = [];
    const handleUnhandled = (reason) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', handleUnhandled);

    try {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });

      const sessionPromise = getBackendSessionState({
        fetchImpl,
        config: TEST_CONFIG,
      });
      const handledSessionPromise = sessionPromise.catch((error) => error);

      await Promise.resolve();
      await Promise.resolve();

      const result = await handledSessionPromise;
      expect(result).toBeInstanceOf(TypeError);
      expect(result.message).toBe('Failed to fetch');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', handleUnhandled);
    }
  });

  it('dedupes concurrent feature access probes', async () => {
    clearBackendAccessCache();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      message: {
        has_active_subscription: true,
        csrf_token: 'csrf-token',
        features: {
          media_assets: {
            enabled: true,
          },
          cloud_sync: {
            enabled: true,
          },
        },
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    const [first, second] = await Promise.all([
      getBackendFeatureAccessState({
        fetchImpl,
        config: TEST_CONFIG,
      }),
      getBackendFeatureAccessState({
        fetchImpl,
        config: TEST_CONFIG,
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.cloudSyncCapability.enabled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('blocks authenticated media gates when media_assets is disabled', async () => {
    clearBackendAccessCache();
    const fetchImpl = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('vatiolibre.vatiolibre.sso.status')) {
        return jsonResponse({
          message: {
            is_guest: false,
          },
        });
      }
      if (requestUrl.includes('get_my_feature_access')) {
        return jsonResponse({
          message: {
            has_active_subscription: false,
            features: {
              media_assets: {
                enabled: false,
                reason: 'Media needs a subscription.',
              },
              cloud_sync: {
                enabled: false,
              },
            },
          },
        });
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const gate = await getProtectedMediaRequestGate({
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(gate.allowed).toBe(false);
    expect(gate.blockedByFeature).toBe(true);
    expect(gate.featureKey).toBe('media_assets');
    expect(gate.status).toBe(403);
    expect(gate.reason).toBe('Media needs a subscription.');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate stale session state after the cache is cleared mid-request', async () => {
    clearBackendAccessCache();
    const staleProbe = createDeferred();
    const freshProbe = createDeferred();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => staleProbe.promise)
      .mockImplementationOnce(() => freshProbe.promise);

    const staleResultPromise = getBackendSessionState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    clearBackendAccessCache();

    const freshResultPromise = getBackendSessionState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    staleProbe.resolve(jsonResponse({
      message: {
        is_guest: true,
      },
    }, 401));
    freshProbe.resolve(jsonResponse({
      message: {
        is_guest: false,
      },
    }));

    const [staleResult, freshResult] = await Promise.all([
      staleResultPromise,
      freshResultPromise,
    ]);

    expect(staleResult.isGuest).toBe(true);
    expect(freshResult.authenticated).toBe(true);

    const cachedResult = await getBackendSessionState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(cachedResult.authenticated).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate stale feature access after the cache is cleared mid-request', async () => {
    clearBackendAccessCache();
    const staleProbe = createDeferred();
    const freshProbe = createDeferred();
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => staleProbe.promise)
      .mockImplementationOnce(() => freshProbe.promise);

    const staleResultPromise = getBackendFeatureAccessState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    clearBackendAccessCache();

    const freshResultPromise = getBackendFeatureAccessState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    staleProbe.resolve(jsonResponse({
      message: {
        has_active_subscription: false,
        features: {
          cloud_sync: {
            enabled: false,
          },
        },
      },
    }));
    freshProbe.resolve(jsonResponse({
      message: {
        has_active_subscription: true,
        csrf_token: 'fresh-csrf-token',
        features: {
          media_assets: {
            enabled: true,
          },
          cloud_sync: {
            enabled: true,
          },
        },
      },
    }));

    const [staleResult, freshResult] = await Promise.all([
      staleResultPromise,
      freshResultPromise,
    ]);

    expect(staleResult.cloudSyncCapability.enabled).toBe(false);
    expect(freshResult.cloudSyncCapability.enabled).toBe(true);

    const cachedResult = await getBackendFeatureAccessState({
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(cachedResult.cloudSyncCapability.enabled).toBe(true);
    expect(cachedResult.capability.enabled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('requests accel detail from the accel detail backend method', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe(
        '/api/method/vatiolibre.vatiolibre.cloud_sync.get_my_accel_recording_detail'
      );
      expect(requestUrl.searchParams.get('name')).toBe('SYNC-ACCEL-1');
      expect(requestUrl.searchParams.get('include_payload')).toBe('1');

      return jsonResponse({
        message: {
          record: {
            name: 'SYNC-ACCEL-1',
            title: 'Quarter mile',
          },
          payload: {
            id: 'run-1',
          },
        },
      });
    });

    const result = await getBackendAccelRunDetail({
      name: 'SYNC-ACCEL-1',
      includePayload: true,
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      record: {
        name: 'SYNC-ACCEL-1',
        title: 'Quarter mile',
      },
      payload: {
        id: 'run-1',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('pushes large sync batches as a gzipped multipart payload', async () => {
    const changes = [
      {
        entity_type: 'replay_session',
        client_record_id: 'replay-huge',
        device_id: 'device-a',
        updated_at_ms: 1712163600000,
        payload: {
          id: 'replay-huge',
          telemetryBlob: '0123456789abcdef'.repeat(12000),
        },
      },
    ];
    const fetchImpl = vi.fn(async (_url, options = {}) => {
      expect(options.method).toBe('POST');
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.headers['X-Frappe-CSRF-Token']).toBe('csrf-token');
      expect(options.body.get('changes_encoding')).toBe('gzip');

      const compressedChanges = options.body.get('changes_gzip');
      expect(compressedChanges).toBeInstanceOf(File);
      expect(compressedChanges.name).toBe('changes.json.gz');

      const uploadedJson = await gunzipText(
        new Uint8Array(await compressedChanges.arrayBuffer())
      );
      expect(JSON.parse(uploadedJson)).toEqual(changes);

      return new Response(JSON.stringify({
        message: {
          records: [],
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    const result = await pushSyncChangesToBackend({
      changes,
      csrfToken: 'csrf-token',
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('downloads gzipped sync payloads and inflates them client-side', async () => {
    const payload = {
      id: 'replay-1',
      samples: [
        { timestampMs: 1000, latitude: 1, longitude: 1, totalDistanceM: 0 },
        { timestampMs: 2000, latitude: 2, longitude: 2, totalDistanceM: 100 },
      ],
    };
    const compressedPayload = await gzipText(JSON.stringify(payload));
    const payloadBase64 = Buffer.from(compressedPayload).toString('base64');

    const fetchImpl = vi.fn(async (_url, options = {}) => {
      expect(options.method).toBe('POST');
      expect(String(options.body || '')).toContain('compressed=1');
      expect(String(options.body || '')).toContain('payload_encoding=gzip_base64');

      return new Response(JSON.stringify({
        message: {
          record: {
            name: 'sync-replay-1',
          },
          payload_encoding: 'gzip_base64',
          payload_gzip_base64: payloadBase64,
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    const result = await downloadSyncPayloadFromBackend({
      name: 'sync-replay-1',
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(result.ok).toBe(true);
    expect(result.record).toEqual({ name: 'sync-replay-1' });
    expect(result.payload).toEqual(payload);
  });

  it('normalizes protected endpoint 403 responses as feature-blocked results', async () => {
    const mediaFetch = vi.fn().mockResolvedValueOnce(jsonResponse({
      message: 'An active subscription is required to browse media.',
    }, 403));
    const syncFetch = vi.fn().mockResolvedValueOnce(jsonResponse({
      message: 'An active subscription is required to sync.',
    }, 403));

    const mediaResult = await getBackendManifestVersion({
      fetchImpl: mediaFetch,
      config: TEST_CONFIG,
    });
    const syncResult = await downloadSyncPayloadFromBackend({
      name: 'SYNC-1',
      fetchImpl: syncFetch,
      config: TEST_CONFIG,
    });

    expect(mediaResult).toMatchObject({
      ok: false,
      status: 403,
      blockedByFeature: true,
      featureKey: 'media_assets',
      reason: 'An active subscription is required to browse media.',
    });
    expect(syncResult).toMatchObject({
      ok: false,
      status: 403,
      blockedByFeature: true,
      featureKey: 'cloud_sync',
      reason: 'An active subscription is required to sync.',
    });
  });

  it('remembers protected endpoint 403s so stale feature cache does not allow retries', async () => {
    clearBackendAccessCache();
    const featureFetch = vi.fn().mockResolvedValueOnce(jsonResponse({
      message: {
        has_active_subscription: true,
        csrf_token: 'csrf-token',
        features: {
          media_assets: {
            enabled: true,
          },
          cloud_sync: {
            enabled: true,
          },
        },
      },
    }));
    await getBackendFeatureAccessState({
      fetchImpl: featureFetch,
      config: TEST_CONFIG,
    });

    const accessFetch = vi.fn().mockResolvedValueOnce(jsonResponse({
      message: 'Subscription required.',
    }, 403));
    await getBackendMediaAssetAccess({
      name: 'MEDIA-403',
      fetchImpl: accessFetch,
      config: TEST_CONFIG,
    });

    const gateFetch = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('vatiolibre.vatiolibre.sso.status')) {
        return jsonResponse({
          message: {
            is_guest: false,
          },
        });
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const gate = await getProtectedMediaRequestGate({
      fetchImpl: gateFetch,
      config: TEST_CONFIG,
    });

    expect(gate).toMatchObject({
      allowed: false,
      blockedByFeature: true,
      featureKey: 'media_assets',
      reason: 'Subscription required.',
      status: 403,
    });
    expect(gateFetch).toHaveBeenCalledTimes(1);
  });

  it('fetches media asset access without normalizing S3 URLs', async () => {
    const s3DownloadUrl = 'https://my-bucket.s3.amazonaws.com/key?X-Amz-Signature=abc';
    const s3PlaybackUrl = 'https://my-bucket.s3.amazonaws.com/key?X-Amz-Signature=def';

    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        message: {
          asset: { name: 'media-1', content_hash: 'aabbcc', media_kind: 'audio' },
          access: {
            download_url: s3DownloadUrl,
            playback_url: s3PlaybackUrl,
            expires_in_seconds: 300,
          },
        },
      })
    );

    const result = await getBackendMediaAssetAccess({
      name: 'media-1',
      fetchImpl,
      config: TEST_CONFIG,
    });

    expect(result.ok).toBe(true);
    expect(result.asset).toEqual({ name: 'media-1', content_hash: 'aabbcc', media_kind: 'audio' });
    // S3 URLs must NOT be rewritten through BFF normalization
    expect(result.access.download_url).toBe(s3DownloadUrl);
    expect(result.access.playback_url).toBe(s3PlaybackUrl);
    expect(result.access.expires_in_seconds).toBe(300);
  });
});

// ── BFF URL builders ─────────────────────────────────────────────────

describe('buildMediaBffUrl', () => {
  it('returns an empty string for empty asset name', () => {
    expect(buildMediaBffUrl('', { config: TEST_CONFIG })).toBe('');
  });

  it('builds a stable BFF URL for media preview', () => {
    const url = buildMediaBffUrl('MEDIA-1', { preview: true, config: TEST_CONFIG });
    expect(url).toContain('/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset');
    expect(url).toContain('name=MEDIA-1');
    expect(url).toContain('preview=1');
  });

  it('builds a stable BFF URL for media download', () => {
    const url = buildMediaBffUrl('MEDIA-1', { config: TEST_CONFIG });
    expect(url).toContain('/api/method/vatiolibre.vatiolibre.media_assets.download_my_media_asset');
    expect(url).toContain('name=MEDIA-1');
    expect(url).not.toContain('preview');
  });
});

describe('buildBoardDocumentPreviewBffUrl', () => {
  it('returns an empty string for empty document name', () => {
    expect(buildBoardDocumentPreviewBffUrl('', { config: TEST_CONFIG })).toBe('');
  });

  it('builds a stable BFF URL for board document preview', () => {
    const url = buildBoardDocumentPreviewBffUrl('BOARD-DOC-1', { config: TEST_CONFIG });
    expect(url).toContain('/api/method/vatiolibre.vatiolibre.board_documents.download_my_board_document_preview');
    expect(url).toContain('name=BOARD-DOC-1');
  });
});

// ── Playlist backend methods ─────────────────────────────────────────

describe('listBackendPlaylists', () => {
  it('parses playlist list response', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      message: {
        playlists: [
          { name: 'PL-1', title: 'Driving Mix', item_count: 3 },
          { name: 'PL-2', title: 'Chill Vibes', item_count: 5 },
        ],
        total_count: 2,
        manifest_token: 'abc123',
      },
    }));

    const result = await listBackendPlaylists({ fetchImpl, config: TEST_CONFIG });

    expect(result.ok).toBe(true);
    expect(result.playlists).toHaveLength(2);
    expect(result.playlists[0].name).toBe('PL-1');
    expect(result.totalCount).toBe(2);
    expect(result.manifestToken).toBe('abc123');
  });

  it('returns empty array on error response', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(
      { message: 'Not Found' },
      404,
    ));

    const result = await listBackendPlaylists({ fetchImpl, config: TEST_CONFIG });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.playlists).toEqual([]);
  });

  it('passes search, limit, and offset params', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      message: { playlists: [], total_count: 0 },
    }));

    await listBackendPlaylists({
      search: 'road',
      limit: 10,
      offset: 20,
      fetchImpl,
      config: TEST_CONFIG,
    });

    const url = fetchImpl.mock.calls[0][0];
    expect(url).toContain('media_playlists.list_my_media_playlists');
  });
});

describe('getBackendPlaylistDetail', () => {
  it('parses playlist detail response', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      message: {
        playlist: {
          name: 'PL-1',
          title: 'Driving Mix',
          items: [
            { media_asset_name: 'MEDIA-1', position: 1 },
            { media_asset_name: 'MEDIA-2', position: 2 },
          ],
        },
      },
    }));

    const result = await getBackendPlaylistDetail({ name: 'PL-1', fetchImpl, config: TEST_CONFIG });

    expect(result.ok).toBe(true);
    expect(result.playlist.name).toBe('PL-1');
    expect(result.playlist.items).toHaveLength(2);
  });

  it('returns null playlist on error', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(
      { message: 'Not Found' },
      404,
    ));

    const result = await getBackendPlaylistDetail({ name: 'PL-MISSING', fetchImpl, config: TEST_CONFIG });

    expect(result.ok).toBe(false);
    expect(result.playlist).toBeNull();
  });
});

describe('getBackendPlaylistsManifestVersion', () => {
  it('parses manifest version response', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      message: {
        manifest_token: 'deadbeef',
        total_count: 10,
      },
    }));

    const result = await getBackendPlaylistsManifestVersion({ fetchImpl, config: TEST_CONFIG });

    expect(result.ok).toBe(true);
    expect(result.manifestToken).toBe('deadbeef');
    expect(result.totalCount).toBe(10);
  });
});

describe('getBackendPlaylistsManifest', () => {
  it('parses full manifest response', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      message: {
        playlists: [
          { name: 'PL-1', title: 'Mix 1' },
          { name: 'PL-2', title: 'Mix 2' },
        ],
        total_count: 2,
        manifest_token: 'tok_v1',
        is_truncated: false,
      },
    }));

    const result = await getBackendPlaylistsManifest({ fetchImpl, config: TEST_CONFIG });

    expect(result.ok).toBe(true);
    expect(result.playlists).toHaveLength(2);
    expect(result.manifestToken).toBe('tok_v1');
    expect(result.isTruncated).toBe(false);
    expect(result.totalCount).toBe(2);
  });

  it('detects truncated manifest', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({
      message: {
        playlists: [{ name: 'PL-1', title: 'Mix 1' }],
        total_count: 500,
        manifest_token: 'tok_v2',
        is_truncated: true,
      },
    }));

    const result = await getBackendPlaylistsManifest({ fetchImpl, config: TEST_CONFIG });

    expect(result.isTruncated).toBe(true);
    expect(result.totalCount).toBe(500);
  });
});
