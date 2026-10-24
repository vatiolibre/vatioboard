/**
 * Player widget — draggable floating embeddable audio player.
 *
 * API mirrors createCalculatorWidget():
 *  - Draggable panel with header (drag by header)
 *  - External button support
 *  - Local-first lazy bootstrap (catalog loaded on first open)
 *  - Singleton runtime via audio-runtime.js (no duplicate audio engines)
 *
 * Usage:
 *   const widget = createPlayerWidget();
 *   widget.open();
 *
 * Multiple instances share the same runtime and deduped catalog bootstrap.
 */

import { createPlayerShell, type PlayerShellSettingsStore } from "./player-shell.js";
import { makePanelDraggable } from "../calculator/widget/drag.js";
import { loadAudioCatalog, syncAudioCatalog, annotateOfflineAvailability } from "../shared/audio-catalog.js";
import { loadPlaylists, syncPlaylistsManifest } from "../shared/playlist-loader.js";
import { loadDemoPlaylist, syncDemoPlaylist } from "../shared/demo-cache.js";
import * as runtime from "../shared/audio-runtime.js";
import { hasPlayerSession, loadPlayerSession } from "../shared/player-session.js";
import { ensureSingleTabOwnership } from "../shared/single-tab.js";
import { appControl } from "../app-platform/app-control.js";
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
import { getShellWorkArea } from "../shared/shell-work-area.js";
import { isFocusedLandscapeProfile } from "../shared/shell-layout-metrics.js";
import type { ShellAppRuntimeManager } from "../app-platform/types";
import type { ShellLifecycleOptions, ShellRuntime } from "../types/shell";

// ── Deduped bootstrap (shared across all widget instances) ───────────

let _bootstrapPromise = null;
let _bootstrapped = false;
let _lastBootstrappedAuthState = undefined;
let _bootstrapGeneration = 0;
let _sessionHydrated = false;

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
const PLAYER_PANEL_SAFE_MARGIN_PX = 8;
const PLAYER_CONTENT_SHEET_HEIGHT_VAR = "--player-content-sheet-open-height";
const PLAYER_CONTENT_SHEET_MAX_HEIGHT_PX = 340;
const PLAYER_CONTENT_SHEET_VIEWPORT_RATIO = 0.56;

type PlayerWidgetPosition = {
  panel?: {
    left?: string;
    top?: string;
  } | null;
};

type PlayerWidgetOptions = {
  mount?: HTMLElement;
  floating?: boolean;
  button?: HTMLElement | null;
  preload?: "on-open" | "immediate";
  persistVisibility?: boolean;
  restoreVisibility?: boolean;
  onOpen?: (() => void) | null;
  onClose?: (() => void) | null;
  settingsStore?: PlayerShellSettingsStore | null;
  shellManager?: ShellRuntime;
  shellAppRuntimeManager?: ShellAppRuntimeManager | null;
};

export type PlayerWidgetApi = {
  open: (options?: ShellLifecycleOptions) => void;
  close: (options?: ShellLifecycleOptions) => void;
  minimize: (options?: ShellLifecycleOptions) => void;
  toggle: () => void;
  restoreVisibility: () => void;
  destroy: () => void;
  setTracks: (tracks: unknown[]) => void;
  setPlaylists: (playlists: unknown[]) => void;
};

function toFiniteNumber(value) {
  const number = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = toFiniteNumber(value);
    if (number !== null && number > 0) return number;
  }
  return 0;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getViewportHeight() {
  return positiveNumber(globalThis.visualViewport?.height, globalThis.innerHeight, 768);
}

function getElementBox(element, rect = element?.getBoundingClientRect?.()) {
  const style = typeof getComputedStyle === "function" && element
    ? getComputedStyle(element)
    : null;
  const width = positiveNumber(rect?.width, element?.offsetWidth, style?.width);
  const height = positiveNumber(rect?.height, element?.offsetHeight, style?.height);
  return { width, height };
}

function getElementRect(element) {
  const rect = element?.getBoundingClientRect?.();
  const box = getElementBox(element, rect);
  const left = toFiniteNumber(rect?.left) ?? toFiniteNumber(element?.style?.left) ?? 0;
  const top = toFiniteNumber(rect?.top) ?? toFiniteNumber(element?.style?.top) ?? 0;
  return {
    left,
    top,
    width: box.width,
    height: box.height,
    right: left + box.width,
    bottom: top + box.height,
  };
}

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
  const generation = ++_bootstrapGeneration;
  const hadSession = hasPlayerSession();
  const shouldRestore = !_sessionHydrated;
  _sessionHydrated = true;
  const authPromise = bootstrapAuth();
  // Demo metadata/public source resolution never waits for backend authentication.
  const demoPromise = loadDemoPlaylist().catch(() => ({ tracks: [] }));
  const ownership = window.__vatioboardSpa ? ensureSingleTabOwnership() : Promise.resolve(true);
  const playbackRevision = runtime.getState().playbackRevision;
  const saved = loadPlayerSession();
  const selected = saved.queueEntries.find((entry) => entry.entryId === saved.currentEntryId)
    || saved.queueEntries[saved.currentIndex];
  const privateMedia = selected && selected.media_kind !== "radio" && !isPublicStaticTrack(selected.name, { ...selected });
  const enabled = () => appControl.isEnabled("vatio.player");
  const playbackReady = Promise.all([ownership, privateMedia ? authPromise : Promise.resolve()])
    .then(([owned]) => owned && enabled());
  const recovery = !shouldRestore ? Promise.resolve() : hadSession
    ? runtime.restoreSession([], { autoplay: true, prepareTracks: demoPromise.then((demo) => demo.tracks), playbackReady })
    : Promise.all([demoPromise, playbackReady]).then(([demo, ready]) => {
      if (generation !== _bootstrapGeneration || !ready || !demo.tracks.length || runtime.getState().queue.length
          || runtime.getState().playbackRevision !== playbackRevision) return;
      // First visits play the public demo even for authenticated users.
      runtime.setRecoveryTracks?.(demo.tracks);
      runtime.setQueue(demo.tracks, { autoplay: true });
    });
  // Attach a handler immediately; catalog/auth work may take much longer.
  const recovered = Promise.resolve(recovery).catch(() => {});
  try {
    const bootAuthState = await authPromise;
    if (generation !== _bootstrapGeneration) return;
    if (bootAuthState !== undefined) _lastBootstrappedAuthState = bootAuthState;
    const { tracks } = await loadAudioCatalog();
    const annotated = await annotateOfflineAvailability(tracks);
    const demoResult = await demoPromise;
    const demoTracks = demoResult.tracks || [];
    if (generation !== _bootstrapGeneration) return;
    const playlist = annotated.length > 0 ? annotated : demoTracks;
    runtime.enrichCatalogMetadata(annotated);
    shell.setTracks(playlist);
    if (annotated.length > 0) {
      loadPlaylists().then(({ playlists }) => {
        if (generation === _bootstrapGeneration) shell.setPlaylists(playlists);
      }).catch(() => {});
    } else if (playlist.length > 0) {
      shell.setPlaylists([buildDemoPlaylistEntry(playlist)]);
    }
    await recovered;
    if (generation !== _bootstrapGeneration) return;
    if (shouldRestore && !hadSession && !demoTracks.length && !runtime.getState().queue.length && annotated.length) {
      runtime.setQueue(annotated, { autoplay: false });
    }
    let seededQueueSignature = "";
    _bootstrapped = true;

    // Non-blocking background revalidation (skip for demo-only sessions)
    if (annotated.length > 0) {
      syncAudioCatalog().then(async (refreshed) => {
        if (!refreshed || generation !== _bootstrapGeneration) return;
        try {
          const fresh = await loadAudioCatalog();
          const freshAnnotated = await annotateOfflineAvailability(fresh.tracks);
          if (freshAnnotated.length > 0 && generation === _bootstrapGeneration) {
            runtime.enrichCatalogMetadata(freshAnnotated);
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
        if (!refreshed || generation !== _bootstrapGeneration) return;
        try {
          const { playlists } = await loadPlaylists();
          if (generation === _bootstrapGeneration) shell.setPlaylists(playlists);
        } catch { /* ignore */ }
      }).catch(() => {});
    } else {
      syncAnnotatedDemoPlaylist().then((refreshed) => {
        if (generation !== _bootstrapGeneration) return;
        if (!refreshed?.refreshed || !refreshed.changed || refreshed.tracks.length === 0) return;
        applyDemoCatalog(shell, refreshed.tracks);
        seededQueueSignature = maybeRefreshSeededQueue(refreshed.tracks, seededQueueSignature);
      }).catch(() => {});
    }
  } catch {
    // Catalog failures never replace a saved selection or an active recovery.
    const demo = await demoPromise;
    if (generation !== _bootstrapGeneration) return;
    applyDemoCatalog(shell, demo.tracks || []);
    await recovered;
    if (generation === _bootstrapGeneration) _bootstrapped = true;
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
  _bootstrapGeneration++;
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
 * @param {boolean} [options.floating] - Deprecated; shell taskbar owns launchers.
 * @param {HTMLElement|null} [options.button] - External button that toggles the player
 * @param {"on-open"|"immediate"} [options.preload="on-open"] - When to bootstrap catalog
 * @param {boolean} [options.persistVisibility=true] - Save open/closed panel state
 * @param {boolean} [options.restoreVisibility=true] - Restore saved open/closed panel state on create
 * @param {Function|null} [options.onOpen]
 * @param {Function|null} [options.onClose]
 * @returns {{ open: Function, close: Function, toggle: Function, restoreVisibility: Function, destroy: Function, setTracks: Function }}
 */
export function createPlayerWidget(options: PlayerWidgetOptions = {}): PlayerWidgetApi {
  const {
    mount = document.body,
    button = null,
    preload = "on-open",
    persistVisibility = true,
    restoreVisibility = true,
    onOpen = null,
    onClose = null,
    settingsStore = null,
    shellManager = getDefaultShellWindowManager(),
    shellAppRuntimeManager = null,
  } = options;

  const DRAG_THRESHOLD_PX = 6;
  const POS_KEY = "player_widget_pos_v1";
  const VISIBILITY_KEY = "player_widget_visible_v1";
  const DEFAULT_PANEL_LEFT = "16px";
  const DEFAULT_PANEL_BOTTOM = "76px";

  // ── Position persistence ─────────────────────────────────────
  function loadPos(): PlayerWidgetPosition | null {
    try {
      const raw = localStorage.getItem(POS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function savePos(pos: PlayerWidgetPosition) {
    clearPanelFixedHeight();
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      // ignore
    }
    if (pos?.panel?.left && pos?.panel?.top) {
      shellManager.updateWindowBounds(PLAYER_WINDOW_ID, {
        left: parseFloat(pos.panel.left),
        top: parseFloat(pos.panel.top),
      }, {
        preserveSnap: Boolean(shellManager.getWindow(PLAYER_WINDOW_ID)?.snap),
        rawBounds: true,
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

  function saveVisibility(visible: boolean) {
    if (!persistVisibility) return;
    try {
      localStorage.setItem(VISIBILITY_KEY, visible ? "true" : "false");
    } catch {
      // ignore
    }
  }

  // ── Create player shell ──────────────────────────────────────
  const shell = createPlayerShell({
    container: mount,
    onContentOpenChange: handleContentOpenChange,
    settingsStore,
    shellManager,
    shellAppRuntimeManager,
  });
  const contentSheet = shell.root.querySelector<HTMLElement>(".player-content-sheet");
  const playerBody = shell.root.querySelector<HTMLElement>(".player-body");
  let cleanupLayer = () => {};
  let panelFitTimeoutId = 0;
  let contentFitFrameId = 0;
  const panelFitFrameIds = new Set<number>();

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

  function clearPanelFixedHeight() {
    if (
      shell.root.dataset.vbShellLayoutMode === "short-landscape"
      && shell.root.classList.contains("is-content-open")
    ) return;
    shell.root.style.height = "";
    shell.root.style.maxHeight = "";
  }

  function persistPanelPosition() {
    if (!shell.root.style.left || !shell.root.style.top) return;
    savePos({
      ...(loadPos() || {}),
      panel: {
        left: shell.root.style.left,
        top: shell.root.style.top,
      },
    });
  }

  function getPanelPosition(rect = getElementRect(shell.root)) {
    const styledLeft = toFiniteNumber(shell.root.style.left);
    const styledTop = toFiniteNumber(shell.root.style.top);
    const styledBottom = toFiniteNumber(shell.root.style.bottom);
    const panelHeight = positiveNumber(rect.height, shell.root.offsetHeight);
    const viewportHeight = getViewportHeight();
    const viewportTop = toFiniteNumber(globalThis.visualViewport?.offsetTop) ?? 0;

    return {
      left: styledLeft ?? rect.left,
      top: styledTop ?? (
        styledBottom !== null && panelHeight > 0
          ? viewportTop + viewportHeight - styledBottom - panelHeight
          : rect.top
      ),
    };
  }

  function ensureTopLeftPositioning() {
    const rect = getElementRect(shell.root);
    const position = getPanelPosition(rect);
    shell.root.style.position = "fixed";
    shell.root.style.left = `${Math.round(position.left)}px`;
    shell.root.style.top = `${Math.round(position.top)}px`;
    shell.root.style.right = "auto";
    shell.root.style.bottom = "auto";
  }

  function getDefaultOpenSheetHeight() {
    return Math.min(
      PLAYER_CONTENT_SHEET_MAX_HEIGHT_PX,
      getViewportHeight() * PLAYER_CONTENT_SHEET_VIEWPORT_RATIO,
    );
  }

  function fitContentSheetHeight(area) {
    if (shell.root.dataset.vbShellLayoutMode === "short-landscape") {
      shell.root.style.removeProperty(PLAYER_CONTENT_SHEET_HEIGHT_VAR);
      return;
    }
    if (!contentSheet?.classList.contains("is-open")) {
      shell.root.style.removeProperty(PLAYER_CONTENT_SHEET_HEIGHT_VAR);
      return;
    }

    const panelRect = getElementRect(shell.root);
    const sheetRect = contentSheet.getBoundingClientRect?.();
    const sheetHeight = positiveNumber(sheetRect?.height, contentSheet.offsetHeight);
    const baseHeight = Math.max(0, panelRect.height - sheetHeight);
    const availableSheetHeight = Math.max(0, area.height - baseHeight);
    const nextSheetHeight = Math.max(0, Math.min(getDefaultOpenSheetHeight(), availableSheetHeight));
    shell.root.style.setProperty(
      PLAYER_CONTENT_SHEET_HEIGHT_VAR,
      `${Math.floor(nextSheetHeight)}px`,
    );
  }

  function fitPanelToAvailableSpace({ persist = false } = {}) {
    if (shell.root.hidden) return;

    if (shell.root.classList.contains("is-content-open")
      && isFocusedLandscapeProfile(document.documentElement.dataset.vbLayoutProfile)) {
      clearPanelFixedHeight();
      return;
    }

    clearPanelFixedHeight();
    ensureTopLeftPositioning();

    const area = getShellWorkArea({
      root: document,
      safeMargin: PLAYER_PANEL_SAFE_MARGIN_PX,
    });

    fitContentSheetHeight(area);

    const rect = getElementRect(shell.root);
    const position = getPanelPosition(rect);
    const width = Math.min(rect.width || 340, area.width);
    const height = Math.min(rect.height || 1, area.height);
    const minLeft = area.left;
    const minTop = area.top;
    const maxLeft = Math.max(minLeft, area.left + area.width - width);
    const maxTop = Math.max(minTop, area.top + area.height - height);

    shell.root.style.left = `${Math.round(clampNumber(position.left, minLeft, maxLeft))}px`;
    shell.root.style.top = `${Math.round(clampNumber(position.top, minTop, maxTop))}px`;
    shell.root.style.right = "auto";
    shell.root.style.bottom = "auto";
    if (persist) persistPanelPosition();
    shell.root.style.maxHeight = `${Math.floor(area.height)}px`;
    shell.root.style.minHeight = `${Math.min(220, Math.floor(area.height))}px`;
  }

  function cancelScheduledPanelFit() {
    for (const frameId of panelFitFrameIds) {
      window.cancelAnimationFrame?.(frameId);
    }
    panelFitFrameIds.clear();
    if (panelFitTimeoutId) {
      window.clearTimeout(panelFitTimeoutId);
      panelFitTimeoutId = 0;
    }
  }

  function requestPanelFitFrame(callback) {
    if (typeof window.requestAnimationFrame !== "function") return;
    const frameId = window.requestAnimationFrame(() => {
      panelFitFrameIds.delete(frameId);
      callback();
    });
    panelFitFrameIds.add(frameId);
  }

  function schedulePanelFit({ persist = true } = {}) {
    cancelScheduledPanelFit();
    fitPanelToAvailableSpace({ persist });
    if (shell.root.hidden) return;

    const refit = () => fitPanelToAvailableSpace({ persist });
    requestPanelFitFrame(() => {
      refit();
      if (!shell.root.hidden) {
        requestPanelFitFrame(refit);
      }
    });
    panelFitTimeoutId = window.setTimeout(() => {
      panelFitTimeoutId = 0;
      refit();
    }, 280);
  }

  function handleContentOpenChange() {
    shellManager.reflowWindowsToWorkArea({ persist: false });
    schedulePanelFit({ persist: true });
  }

  function handleContentSheetTransitionEnd(event) {
    if (event.target !== contentSheet) return;
    if (event.propertyName !== "height" && event.propertyName !== "max-height") return;
    fitPanelToAvailableSpace({ persist: true });
  }

  contentSheet?.addEventListener("transitionend", handleContentSheetTransitionEnd);

  // Observe intrinsic content, not only the constrained body: an overflowing
  // body can keep the same border-box size when metadata or visuals grow.
  const measuredSizes = new WeakMap<Element, string>();
  const contentObserver = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      const size = `${entry.contentRect.width}:${entry.contentRect.height}`;
      if (measuredSizes.get(entry.target) !== size) changed = true;
      measuredSizes.set(entry.target, size);
    }
    if (!changed || shell.root.hidden || contentFitFrameId) return;
    contentFitFrameId = window.requestAnimationFrame(() => {
      contentFitFrameId = 0;
      fitPanelToAvailableSpace({ persist: false });
    });
  }) : null;
  function observePanelContent() {
    contentObserver?.observe(shell.header);
    for (const child of Array.from(playerBody?.children || [])) contentObserver?.observe(child);
  }

  function suspendPanelSizing() {
    contentObserver?.disconnect();
    if (contentFitFrameId) window.cancelAnimationFrame(contentFitFrameId);
    contentFitFrameId = 0;
    cancelScheduledPanelFit();
  }

  const handleWorkAreaReflow = () => fitPanelToAvailableSpace({ persist: false });
  window.addEventListener("vatioboard:shell-work-area-reflowed", handleWorkAreaReflow);
  globalThis.visualViewport?.addEventListener("resize", handleWorkAreaReflow);

  function getCompactContentHeight() {
    if (!playerBody) return shell.root.getBoundingClientRect().height;
    const style = getComputedStyle(shell.root);
    return shell.header.getBoundingClientRect().height + playerBody.scrollHeight
      + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
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
      maximizable: false,
      fullscreen: false,
      snap: false,
      preserveIntrinsicWidth: true,
      minWidth: 320,
      maxWidth: 720,
    },
    resolveLayout(metrics) {
      if (!isFocusedLandscapeProfile(metrics.profile)) return null;
      const contentOpen = shell.root.classList.contains("is-content-open");
      if (!contentOpen) {
        return {
          mode: "short-landscape",
          width: Math.min(340, metrics.workArea.width),
          height: Math.min(getCompactContentHeight() || metrics.workArea.height, metrics.workArea.height),
          maxWidth: Math.min(340, metrics.workArea.width),
          maxHeight: metrics.workArea.height,
        };
      }
      const width = Math.min(720, metrics.workArea.width);
      return {
        mode: "short-landscape",
        left: metrics.workArea.left + Math.max(0, metrics.workArea.width - width) / 2,
        top: metrics.workArea.top,
        width,
        height: metrics.workArea.height,
        minWidth: Math.min(620, metrics.workArea.width),
        minHeight: Math.min(360, metrics.workArea.height),
        maxWidth: metrics.workArea.width,
        maxHeight: metrics.workArea.height,
      };
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
    shellWindowId: PLAYER_WINDOW_ID,
    shellManager,
    enableSnapPreview: shellManager.getShellPreference?.("snapEnabled") !== false,
    onDragEnd: () => {
      schedulePanelFit({ persist: true });
    },
  });
  window.addEventListener("resize", handleContentOpenChange);

  // ── Window controls ──────────────────────────────────────────
  shell.minimizeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  shell.minimizeBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  shell.minimizeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    minimize();
  });

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
  function showPanel({ persist = true }: ShellLifecycleOptions = {}) {
    shell.root.hidden = false;
    observePanelContent();
    shell.resumeVisualizations?.();
    if (persist) saveVisibility(true);

    // Lazy bootstrap on first open
    ensureBootstrap();

    fitPanelToAvailableSpace({ persist: false });

    if (typeof onOpen === "function") onOpen();
  }

  function hidePanel({ persist = true, stopPlayback = true }: ShellLifecycleOptions = {}) {
    shell.root.hidden = true;
    suspendPanelSizing();
    shell.suspendVisualizations?.();
    if (persist) saveVisibility(false);
    if (stopPlayback !== false) runtime.stopPlayback();
    if (typeof onClose === "function") onClose();
  }

  function minimizePanel() {
    shell.root.hidden = true;
    suspendPanelSizing();
    shell.suspendVisualizations?.();
  }

  function open(options: ShellLifecycleOptions = {}) {
    showPanel(options);
    shellManager.openWindow(PLAYER_WINDOW_ID, { ...options, invokeLifecycle: false });
    fitPanelToAvailableSpace({ persist: false });
  }

  function close(options: ShellLifecycleOptions = {}) {
    hidePanel(options);
    shellManager.closeWindow(PLAYER_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function minimize(options: ShellLifecycleOptions = {}) {
    minimizePanel();
    shellManager.minimizeWindow(PLAYER_WINDOW_ID, { ...options, invokeLifecycle: false });
  }

  function toggle() {
    shell.root.hidden ? open() : close();
  }

  function restoreSavedVisibility() {
    if (loadVisibility() === true) {
      open({ persist: false });
    }
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
    if (detail.pendingLogout) {
      _bootstrapGeneration++;
      runtime.stopPlayback();
    }

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
    window.removeEventListener("resize", handleContentOpenChange);
    window.removeEventListener("vatioboard:shell-work-area-reflowed", handleWorkAreaReflow);
    globalThis.visualViewport?.removeEventListener("resize", handleWorkAreaReflow);
    suspendPanelSizing();
    contentSheet?.removeEventListener("transitionend", handleContentSheetTransitionEnd);
    cancelScheduledPanelFit();
    cleanupLayer();
    shell.destroy();
    if (button) {
      button.removeEventListener("click", toggle);
    }
  }

  // ── Public API ───────────────────────────────────────────────
  return {
    open,
    close,
    minimize,
    toggle,
    restoreVisibility: restoreSavedVisibility,
    destroy,
    setTracks: (tracks) => shell.setTracks(tracks),
    setPlaylists: (playlists) => shell.setPlaylists(playlists),
  };
}
