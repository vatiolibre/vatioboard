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
import { loadPlaylists, syncPlaylistsManifest } from "../shared/playlist-loader.js";
import { loadDemoPlaylist, syncDemoPlaylist } from "../shared/demo-cache.js";
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
import { isPublicStaticTrack } from "../shared/track-source-policy.js";
import {
  registerFloatingPanel,
} from "../shared/floating-layer-manager.js";
import { getDefaultShellWindowManager } from "../shared/shell-window-manager.js";

// ── Deduped bootstrap (shared across all widget instances) ───────────

let _bootstrapPromise = null;
let _bootstrapped = false;
let _lastBootstrappedAuthState = undefined;

async function bootstrapAuth() {
  try {
    const session = await getBackendSessionState();
    const authenticated = session.authenticated === true && session.isGuest !== true;
    if (authenticated) {
      const loggedUser = await fetchBackendLoggedUser().catch(() => null);
      if (loggedUser?.user) setMediaCacheUser(loggedUser.user);
    } else {
      clearPersistedMediaCacheUser();
    }
    return authenticated;
  } catch {
    restorePersistedMediaCacheUser();
    return undefined;
  }
}

const DEMO_PLAYLIST_NAME = "demo:playlist";
const DEMO_PLAYLIST_TITLE = "Demo Playlist";
const PLAYER_WINDOW_ID = "player";

async function loadAnnotatedDemoPlaylist() {
  const result = await loadDemoPlaylist();
  const tracks = await annotateOfflineAvailability(result.tracks || []);
  return {
    ...result,
    tracks,
  };
}

async function syncAnnotatedDemoPlaylist() {
  const result = await syncDemoPlaylist();
  const tracks = await annotateOfflineAvailability(result.tracks || []);
  return {
    ...result,
    tracks,
  };
}

function buildDemoPlaylistEntry(tracks) {
  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  return {
    name: DEMO_PLAYLIST_NAME,
    title: DEMO_PLAYLIST_TITLE,
    item_count: tracks.length,
    total_duration_seconds: totalDuration,
    _local: true,
    items: tracks.map((t) => ({
      media_asset_name: t.name,
      snapshot_title: t.title || "",
      snapshot_artist: t.artist || "",
      snapshot_album: t.album || "",
      snapshot_genre: t.genre || "",
      snapshot_duration: t.duration ?? null,
      snapshot_artwork_ref: t.artwork_ref || "",
      snapshot_content_hash: t.content_hash || "",
    })),
  };
}

function queueNameSignature(tracks) {
  return Array.isArray(tracks)
    ? tracks.map((track) => track?.name || "").join("\n")
    : "";
}

function isPristineSeededQueue(state, signature) {
  if (!signature || !state?.paused || state.currentIndex > 0 || state.currentTime > 0.5) {
    return false;
  }
  return queueNameSignature(state.queue) === signature;
}

function isPristineDemoQueue(state) {
  if (!state?.paused || state.currentIndex > 0 || state.currentTime > 0.5) {
    return false;
  }
  return Array.isArray(state.queue)
    && state.queue.length > 0
    && state.queue.every((track) => isPublicStaticTrack(track?.name, track));
}

function applyDemoCatalog(shell, tracks) {
  shell.setTracks(tracks);
  shell.setPlaylists(tracks.length > 0 ? [buildDemoPlaylistEntry(tracks)] : []);
}

function maybeRefreshSeededQueue(tracks, seededQueueSignature) {
  if (!Array.isArray(tracks) || tracks.length === 0) return seededQueueSignature;

  const current = runtime.getState();
  if (current.queue.length === 0 || isPristineSeededQueue(current, seededQueueSignature)) {
    runtime.setQueue(tracks, { autoplay: false });
    return queueNameSignature(tracks);
  }

  return seededQueueSignature;
}

async function doBootstrap(shell) {
  try {
    const bootAuthState = await bootstrapAuth();
    if (bootAuthState !== undefined) {
      _lastBootstrappedAuthState = bootAuthState;
    }

    const { tracks } = await loadAudioCatalog();
    const annotated = await annotateOfflineAvailability(tracks);
    const demoResult = await loadAnnotatedDemoPlaylist();
    const demoTracks = demoResult.tracks || [];

    // Fall back to the free demo playlist when no catalog is available
    // (guest / unauthenticated visitors).
    const playlist = annotated.length > 0 ? annotated : demoTracks;
    const restoreCandidates = annotated.length > 0
      ? [...annotated, ...demoTracks]
      : playlist;

    shell.setTracks(playlist);

    // Load playlists alongside tracks (or use demo playlist for guests)
    if (annotated.length > 0) {
      loadPlaylists().then(({ playlists }) => {
        shell.setPlaylists(playlists);
      }).catch(() => {});
    } else if (playlist.length > 0) {
      shell.setPlaylists([buildDemoPlaylistEntry(playlist)]);
    }

    // Restore previous session (or do nothing if cold start).  The runtime
    // only autoplays when the saved session was actively playing.
    await runtime.restoreSession(restoreCandidates, { autoplay: true });

    // If no session restored, seed the full catalog as queue
    const s = runtime.getState();
    let seededQueueSignature = "";
    if (annotated.length > 0 && isPristineDemoQueue(s)) {
      runtime.setQueue(annotated, { autoplay: false });
      seededQueueSignature = queueNameSignature(annotated);
    } else if (s.queue.length === 0 && playlist.length > 0) {
      runtime.setQueue(playlist, { autoplay: false });
      seededQueueSignature = queueNameSignature(playlist);
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
            if (isPristineSeededQueue(current, seededQueueSignature)) {
              runtime.setQueue(freshAnnotated, { autoplay: false });
              seededQueueSignature = queueNameSignature(freshAnnotated);
            }
          }
        } catch { /* ignore revalidation failures */ }
      }).catch(() => {});

      // Background sync playlists
      syncPlaylistsManifest().then(async (refreshed) => {
        if (!refreshed) return;
        try {
          const { playlists } = await loadPlaylists();
          shell.setPlaylists(playlists);
        } catch { /* ignore */ }
      }).catch(() => {});
    } else {
      syncAnnotatedDemoPlaylist().then((refreshed) => {
        if (!refreshed?.refreshed || !refreshed.changed || refreshed.tracks.length === 0) return;
        applyDemoCatalog(shell, refreshed.tracks);
        seededQueueSignature = maybeRefreshSeededQueue(refreshed.tracks, seededQueueSignature);
      }).catch(() => {});
    }
  } catch {
    // Offline or no manifest — try demo playlist as last resort
    try {
      const demoResult = await loadAnnotatedDemoPlaylist();
      const demo = demoResult.tracks || [];
      if (demo.length > 0) {
        applyDemoCatalog(shell, demo);
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

  if (loggedIn) {
    // User just logged in — run the full bootstrap (manifest fetch etc.)
    await doBootstrap(shell);
  } else {
    // Stop playback so the user doesn't keep listening to tracks they
    // may no longer have access to.
    runtime.stopPlayback();

    // Logout — skip backend calls and fall back to demo tracks.
    const demoResult = await loadAnnotatedDemoPlaylist();
    const demo = demoResult.tracks || [];
    applyDemoCatalog(shell, demo);
    if (demo.length > 0) {
      runtime.setQueue(demo, { autoplay: false });
    } else {
      runtime.setQueue([], { autoplay: false });
    }
    _bootstrapped = true;

    let seededQueueSignature = demo.length > 0 ? queueNameSignature(demo) : "";
    syncAnnotatedDemoPlaylist().then((refreshed) => {
      if (!refreshed?.refreshed || !refreshed.changed || refreshed.tracks.length === 0) return;
      applyDemoCatalog(shell, refreshed.tracks);
      seededQueueSignature = maybeRefreshSeededQueue(refreshed.tracks, seededQueueSignature);
    }).catch(() => {});
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
 * @param {boolean} [options.persistVisibility=true] - Save open/closed panel state
 * @param {boolean} [options.restoreVisibility=true] - Restore saved open/closed panel state on create
 * @param {Function|null} [options.onOpen]
 * @param {Function|null} [options.onClose]
 * @returns {{ open: Function, close: Function, toggle: Function, restoreVisibility: Function, destroy: Function, setTracks: Function }}
 */
export function createPlayerWidget(options = {}) {
  const {
    mount = document.body,
    floating = options.button ? false : true,
    button = null,
    preload = "on-open",
    persistVisibility = true,
    restoreVisibility = true,
    onOpen = null,
    onClose = null,
    shellManager = getDefaultShellWindowManager(),
  } = options;

  const DRAG_THRESHOLD_PX = 6;
  const POS_KEY = "player_widget_pos_v1";
  const VISIBILITY_KEY = "player_widget_visible_v1";
  const DEFAULT_PANEL_LEFT = "16px";
  const DEFAULT_PANEL_BOTTOM = "76px";

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
    if (pos?.panel?.left && pos?.panel?.top) {
      shellManager.updateWindowBounds(PLAYER_WINDOW_ID, {
        left: parseFloat(pos.panel.left),
        top: parseFloat(pos.panel.top),
      });
    }
  }

  function loadVisibility() {
    if (!persistVisibility) return null;
    try {
      const raw = localStorage.getItem(VISIBILITY_KEY);
      if (raw === "true") return true;
      if (raw === "false") return false;
      return null;
    } catch {
      return null;
    }
  }

  function saveVisibility(visible) {
    if (!persistVisibility) return;
    try {
      localStorage.setItem(VISIBILITY_KEY, visible ? "true" : "false");
    } catch {
      // ignore
    }
  }

  // ── Create player shell ──────────────────────────────────────
  const shell = createPlayerShell({ container: mount });
  let cleanupLayer = () => {};

  // Apply stored panel position, or use the first-visit default.
  {
    const pos = loadPos();
    if (pos?.panel?.left && pos?.panel?.top) {
      shell.root.style.position = "fixed";
      shell.root.style.left = pos.panel.left;
      shell.root.style.top = pos.panel.top;
      shell.root.style.right = "auto";
      shell.root.style.bottom = "auto";
    } else {
      shell.root.style.position = "fixed";
      shell.root.style.left = DEFAULT_PANEL_LEFT;
      shell.root.style.right = "auto";
      shell.root.style.bottom = DEFAULT_PANEL_BOTTOM;
    }
  }

  cleanupLayer = registerFloatingPanel(shell.root, {
    id: PLAYER_WINDOW_ID,
    kind: "media",
    title: "Player",
    shellManager,
    storageKey: VISIBILITY_KEY,
    lazy: preload !== "immediate",
    capabilities: {
      draggable: true,
      resizable: false,
      minimizable: true,
      closable: true,
      restorable: true,
    },
    lifecycle: {
      open: showPanel,
      close: hidePanel,
      minimize: minimizePanel,
      restore: showPanel,
    },
  });

  // ── Panel drag ───────────────────────────────────────────────
  makePanelDraggable({
    panel: shell.root,
    header: [shell.header, shell.nowPlaying],
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
  function showPanel({ persist = true } = {}) {
    shell.root.hidden = false;
    if (persist) saveVisibility(true);

    // Lazy bootstrap on first open
    ensureBootstrap();

    // Ensure panel stays in viewport
    if (shell.root.style.left && shell.root.style.top) {
      clampElementToViewport(shell.root);
    }

    if (typeof onOpen === "function") onOpen();
  }

  function hidePanel({ persist = true } = {}) {
    shell.root.hidden = true;
    if (persist) saveVisibility(false);
    // Playback continues — closing the panel does NOT stop audio
    if (typeof onClose === "function") onClose();
  }

  function minimizePanel() {
    shell.root.hidden = true;
  }

  function open(options = {}) {
    showPanel(options);
    shellManager.openWindow(PLAYER_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function close(options = {}) {
    hidePanel(options);
    shellManager.closeWindow(PLAYER_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function toggle() {
    shell.root.hidden ? open() : close();
  }

  function restoreSavedVisibility() {
    if (loadVisibility() === true) {
      open({ persist: false });
    }
  }

  // ── Floating launcher (FAB) ──────────────────────────────────
  let launcher = null;
  let launcherUnsubscribe = null;
  let launcherMoved = null;

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
    launcherMoved = makeLauncherDraggable({
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

    if (_lastAuthState === undefined && _lastBootstrappedAuthState !== undefined) {
      _lastAuthState = _lastBootstrappedAuthState;
    }

    // Only react to actual transitions, not duplicate events.
    if (isNowAuthenticated === _lastAuthState) return;
    _lastAuthState = isNowAuthenticated;

    // Only reload if the widget has already bootstrapped at least once.
    // Early auth events (during page load) are tracked but not acted on;
    // the initial bootstrap will use whatever auth state is current.
    if (!_bootstrapped) return;

    // Re-bootstrap: loads the user catalog on login, falls back to
    // the demo playlist on logout.
    reloadCatalogForAuthChange(shell, isNowAuthenticated).catch(() => {});
  }

  window.addEventListener(BACKEND_AUTH_STATE_EVENT, onAuthChange);

  if (restoreVisibility) {
    restoreSavedVisibility();
  }

  // ── Destroy ──────────────────────────────────────────────────
  function destroy() {
    window.removeEventListener(BACKEND_AUTH_STATE_EVENT, onAuthChange);
    cleanupLayer();
    shell.destroy();
    if (launcher) {
      launcherMoved?.destroy?.();
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
    restoreVisibility: restoreSavedVisibility,
    destroy,
    setTracks: (tracks) => shell.setTracks(tracks),
    setPlaylists: (playlists) => shell.setPlaylists(playlists),
  };
}
