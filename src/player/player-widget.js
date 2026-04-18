/**
 * Player widget — draggable floating embeddable audio player.
 *
 * API mirrors createCalculatorWidget():
 *  - Floating launcher FAB (optional)
 *  - Draggable panel with header (drag by header)
 *  - External button support
 *  - Local-first lazy bootstrap (catalog loaded on first open)
 *  - Singleton runtime via audio-runtime.js (no duplicate audio engines)
 *
 * Usage:
 *   const widget = createPlayerWidget({ floating: true });
 *   widget.open();
 *
 * Multiple instances share the same runtime and deduped catalog bootstrap.
 */

import { createPlayerShell } from "./player-shell.js";
import {
  clampElementToViewport,
  makePanelDraggable,
  makeLauncherDraggable,
} from "../calculator/widget/drag.js";
import { IconMusic } from "../icons.js";
import { loadAudioCatalog, syncAudioCatalog, annotateOfflineAvailability } from "../shared/audio-catalog.js";
import * as runtime from "../shared/audio-runtime.js";
import {
  getBackendSessionState,
  fetchBackendLoggedUser,
  BACKEND_AUTH_STATE_EVENT,
} from "../shared/backend-auth.js";
import {
  setMediaCacheUser,
  restorePersistedMediaCacheUser,
  clearPersistedMediaCacheUser,
} from "../shared/media-cache.js";

// ── Deduped bootstrap (shared across all widget instances) ───────────

let _bootstrapPromise = null;
let _bootstrapped = false;

async function bootstrapAuth() {
  try {
    const session = await getBackendSessionState();
    if (session.authenticated) {
      const loggedUser = await fetchBackendLoggedUser().catch(() => null);
      if (loggedUser?.user) setMediaCacheUser(loggedUser.user);
    } else {
      clearPersistedMediaCacheUser();
    }
  } catch {
    restorePersistedMediaCacheUser();
  }
}

async function loadDemoPlaylist() {
  try {
    const res = await fetch("/audio/demo/playlist.json");
    if (!res.ok) return [];
    const tracks = await res.json();
    return Array.isArray(tracks) ? tracks : [];
  } catch {
    return [];
  }
}

async function doBootstrap(shell) {
  try {
    await bootstrapAuth();

    const { tracks } = await loadAudioCatalog();
    const annotated = await annotateOfflineAvailability(tracks);

    // Fall back to the free demo playlist when no catalog is available
    // (guest / unauthenticated visitors).
    const playlist = annotated.length > 0 ? annotated : await loadDemoPlaylist();

    shell.setTracks(playlist);

    // Restore previous session (or do nothing if cold start)
    await runtime.restoreSession(playlist, { autoplay: false });

    // If no session restored, seed the full catalog as queue
    const s = runtime.getState();
    if (s.queue.length === 0 && playlist.length > 0) {
      runtime.setQueue(playlist, { autoplay: false });
    }

    _bootstrapped = true;

    // Non-blocking background revalidation (skip for demo-only sessions)
    if (annotated.length > 0) {
      syncAudioCatalog().then(async (refreshed) => {
        if (!refreshed) return;
        try {
          const fresh = await loadAudioCatalog();
          const freshAnnotated = await annotateOfflineAvailability(fresh.tracks);
          if (freshAnnotated.length > 0) {
            shell.setTracks(freshAnnotated);
            const current = runtime.getState();
            if (current.paused && current.currentIndex <= 0) {
              runtime.setQueue(freshAnnotated, { autoplay: false });
            }
          }
        } catch { /* ignore revalidation failures */ }
      }).catch(() => {});
    }
  } catch {
    // Offline or no manifest — try demo playlist as last resort
    try {
      const demo = await loadDemoPlaylist();
      if (demo.length > 0) {
        shell.setTracks(demo);
        runtime.setQueue(demo, { autoplay: false });
        _bootstrapped = true;
      }
    } catch { /* shell starts empty */ }
  }
}

function getBootstrap(shell) {
  if (_bootstrapped) return Promise.resolve();
  if (_bootstrapPromise) return _bootstrapPromise;
  _bootstrapPromise = doBootstrap(shell).finally(() => {
    _bootstrapPromise = null;
  });
  return _bootstrapPromise;
}

/**
 * Re-bootstrap after an auth state change — reloads the catalog (or
 * falls back to the demo playlist on logout) and updates the queue
 * without requiring a page refresh.
 *
 * @param {object} shell  – player shell instance
 * @param {boolean} loggedIn – whether the user just logged in
 */
async function reloadCatalogForAuthChange(shell, loggedIn) {
  // Reset so getBootstrap re-runs the full flow.
  _bootstrapped = false;
  _bootstrapPromise = null;

  // Stop playback so the user doesn't keep listening to tracks they
  // may no longer have access to.
  runtime.stopPlayback();

  if (loggedIn) {
    // User just logged in — run the full bootstrap (manifest fetch etc.)
    await doBootstrap(shell);
  } else {
    // Logout — skip backend calls and fall back to demo tracks.
    const demo = await loadDemoPlaylist();
    shell.setTracks(demo);
    if (demo.length > 0) runtime.setQueue(demo, { autoplay: false });
    _bootstrapped = true;
  }
}

/** Exposed for integration tests to await the bootstrap promise. */
export function _getBootstrapPromise() {
  return _bootstrapPromise ?? Promise.resolve();
}

// ── Widget factory ───────────────────────────────────────────────────

/**
 * Create an embeddable audio player widget.
 *
 * @param {object} [options]
 * @param {HTMLElement} [options.mount=document.body]
 * @param {boolean} [options.floating] - Show floating launcher (default: true unless button provided)
 * @param {HTMLElement|null} [options.button] - External button that toggles the player
 * @param {"on-open"|"immediate"} [options.preload="on-open"] - When to bootstrap catalog
 * @param {Function|null} [options.onOpen]
 * @param {Function|null} [options.onClose]
 * @returns {{ open: Function, close: Function, toggle: Function, destroy: Function, setTracks: Function }}
 */
export function createPlayerWidget(options = {}) {
  const {
    mount = document.body,
    floating = options.button ? false : true,
    button = null,
    preload = "on-open",
    onOpen = null,
    onClose = null,
  } = options;

  const DRAG_THRESHOLD_PX = 6;
  const POS_KEY = "player_widget_pos_v1";

  // ── Position persistence ─────────────────────────────────────
  function loadPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function savePos(pos) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      // ignore
    }
  }

  // ── Create player shell ──────────────────────────────────────
  const shell = createPlayerShell({ container: mount });

  // Apply stored panel position
  {
    const pos = loadPos();
    if (pos?.panel?.left && pos?.panel?.top) {
      shell.root.style.position = "fixed";
      shell.root.style.left = pos.panel.left;
      shell.root.style.top = pos.panel.top;
      shell.root.style.right = "auto";
      shell.root.style.bottom = "auto";
    }
  }

  // ── Panel drag ───────────────────────────────────────────────
  makePanelDraggable({
    panel: shell.root,
    header: shell.header,
    dragThresholdPx: DRAG_THRESHOLD_PX,
    savePos,
    loadPos,
  });

  // ── Close button (must NOT stop playback) ────────────────────
  shell.closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  shell.closeBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  shell.closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });

  // ── Bootstrap ────────────────────────────────────────────────
  let bootstrapFired = false;

  function ensureBootstrap() {
    if (bootstrapFired) return;
    bootstrapFired = true;
    getBootstrap(shell);
  }

  if (preload === "immediate") {
    ensureBootstrap();
  }

  // ── Open / Close / Toggle ────────────────────────────────────
  function open() {
    shell.root.hidden = false;

    // Lazy bootstrap on first open
    ensureBootstrap();

    // Ensure panel stays in viewport
    if (shell.root.style.left && shell.root.style.top) {
      clampElementToViewport(shell.root);
    }

    if (typeof onOpen === "function") onOpen();
  }

  function close() {
    shell.root.hidden = true;
    // Playback continues — closing the panel does NOT stop audio
    if (typeof onClose === "function") onClose();
  }

  function toggle() {
    shell.root.hidden ? open() : close();
  }

  // ── Floating launcher (FAB) ──────────────────────────────────
  let launcher = null;
  let launcherUnsubscribe = null;

  if (floating) {
    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "player-fab";
    launcher.setAttribute("aria-label", "Open Player");
    launcher.innerHTML = IconMusic;

    // Apply stored launcher position
    {
      const pos = loadPos();
      if (pos?.launcher?.left && pos?.launcher?.top) {
        launcher.style.position = "fixed";
        launcher.style.left = pos.launcher.left;
        launcher.style.top = pos.launcher.top;
        launcher.style.right = "auto";
        launcher.style.bottom = "auto";
      }
    }

    // Draggable launcher (guards toggle on drag)
    const launcherMoved = makeLauncherDraggable({
      launcherEl: launcher,
      dragThresholdPx: DRAG_THRESHOLD_PX,
      savePos,
      loadPos,
    });

    launcher.addEventListener("click", (e) => {
      if (launcherMoved()) {
        e.preventDefault();
        return;
      }
      toggle();
    });

    // Active-state indicator when playback is active and panel is hidden
    launcherUnsubscribe = runtime.subscribe((s) => {
      launcher.classList.toggle("is-playing", s.playing && shell.root.hidden);
    });

    mount.appendChild(launcher);
  }

  // ── External button ──────────────────────────────────────────
  if (button) {
    button.addEventListener("click", toggle);
  }

  // ── Auth change → reload catalog ────────────────────────────
  let _lastAuthState = undefined;

  function onAuthChange(event) {
    const detail = event?.detail || {};
    const isNowAuthenticated = detail.authenticated === true && !detail.isGuest && !detail.pendingLogout;

    // Only react to actual transitions, not duplicate events.
    if (isNowAuthenticated === _lastAuthState) return;
    _lastAuthState = isNowAuthenticated;

    // Only reload if the widget has already bootstrapped at least once.
    // Early auth events (during page load) are tracked but not acted on;
    // the initial bootstrap will use whatever auth state is current.
    if (!_bootstrapped && !_bootstrapPromise) return;

    // Re-bootstrap: loads the user catalog on login, falls back to
    // the demo playlist on logout.
    reloadCatalogForAuthChange(shell, isNowAuthenticated).catch(() => {});
  }

  window.addEventListener(BACKEND_AUTH_STATE_EVENT, onAuthChange);

  // ── Destroy ──────────────────────────────────────────────────
  function destroy() {
    window.removeEventListener(BACKEND_AUTH_STATE_EVENT, onAuthChange);
    shell.destroy();
    if (launcher) {
      launcher.remove();
      if (launcherUnsubscribe) launcherUnsubscribe();
    }
    if (button) {
      button.removeEventListener("click", toggle);
    }
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    open,
    close,
    toggle,
    destroy,
    setTracks: (tracks) => shell.setTracks(tracks),
  };
}
