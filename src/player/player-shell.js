/**
 * Player shell — compact embeddable panel renderer.
 *
 * Renders now-playing metadata, transport controls, progress, volume,
 * and a collapsible queue bottom-sheet.  Communicates with the
 * audio-runtime singleton — the shell owns zero playback logic.
 *
 * Designed to be mounted inside a draggable widget container by
 * createPlayerWidget().  Not a full-page layout.
 */

import {
  IconPlay, IconPause, IconSkipBack, IconSkipForward,
  IconRepeat, IconShuffle, IconVolume, IconMuted,
  IconMusic, IconClose, IconQueue, IconPlaylist, IconLibrary,
} from "../icons.js";
import { t } from "../i18n.js";
import { createMiniAudioVisualizer } from "../shared/audio-mini-visualizer.js";
import { isVisualizerSafeSource } from "../shared/audio-visualizer.js";
import { primeAudioContext } from "../shared/audio-graph-registry.js";
import {
  createMilkdropPanel,
  loadMilkdropPanelVisibility,
} from "./milkdrop-panel.js";
import * as runtime from "../shared/audio-runtime.js";
import { loadText, saveText } from "../shared/storage.js";
import { loadPlaylists, loadPlaylistDetail } from "../shared/playlist-loader.js";
import { isAudioAsset } from "../shared/audio-catalog.js";
import { normalizeTrack } from "../shared/track-model.js";
import {
  pinMediaBlob,
  pinMediaFromResponse,
  unpinMediaBlob,
  isMediaBlobPinned,
  getCachedMediaBlob,
  getCachedBlobMeta,
  removeCachedMediaBlob,
} from "../shared/media-cache.js";
import {
  createBackendPlaylist,
  bulkAddBackendPlaylistItems,
  getProtectedMediaRequestGate,
  getBackendMediaAssetAccess,
  fetchBackendMediaAssetBlob,
} from "../shared/backend-auth.js";
import { setMediaSessionMetadata } from "../shared/media-session-adapter.js";
import { showPromptDialog } from "../shared/ui/confirm-dialog.js";

const PROGRESS_MAX = 1000;
const VISUALIZER_VISIBLE_STORAGE_KEY = "vatio_board_player_widget_visualizer_visible";
const VISUALIZER_MODE_STORAGE_KEY = "vatio_board_player_widget_visualizer_mode";
const VISUALIZER_MODES = new Set(["spectrum", "scope"]);
const IconVisualizer = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 17V9M9.5 17V5M15 17v-7M20 17V7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>
`;
const IconMilkdrop = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.5 2"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
  </svg>
`;

function updateRangeVisualFill(input) {
  if (!(input instanceof HTMLInputElement)) return;

  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 100;
  const safeValue = Number.isFinite(value) ? value : safeMin;
  const span = safeMax - safeMin;
  const clampedValue = Math.min(safeMax, Math.max(safeMin, safeValue));
  const percent = span > 0 ? ((clampedValue - safeMin) / span) * 100 : 0;

  input.style.setProperty("--player-range-percent", `${percent}%`);
}

function normalizeVisualizerMode(mode) {
  const value = String(mode || "").toLowerCase();
  return VISUALIZER_MODES.has(value) ? value : "spectrum";
}

function getNextVisualizerMode(mode) {
  return normalizeVisualizerMode(mode) === "spectrum" ? "scope" : "spectrum";
}

function getVisualizerModeLabel(mode) {
  return normalizeVisualizerMode(mode) === "scope"
    ? t("mediaPlayerVisualizerScope")
    : t("mediaPlayerVisualizerSpectrum");
}

function isSafeVisualizerElement(audioElement) {
  if (!audioElement?.src) return true;
  return isVisualizerSafeSource(audioElement.currentSrc || audioElement.src);
}

/**
 * Format seconds as m:ss or h:mm:ss.
 */
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${String(rm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getQueueRenderSignature(queue) {
  if (!Array.isArray(queue) || queue.length === 0) return "";
  return queue.map((track) => [
    track?._queueId || "",
    track?.name || "",
    track?.title || "",
    track?.original_filename || "",
    track?.artist || "",
    track?.album || "",
    String(track?.duration ?? ""),
    track?._offline ? "1" : "0",
  ].join("\u001f")).join("\u001e");
}

// ── Artwork URL resolution ───────────────────────────────────────────

function isArtworkUrl(ref) {
  return typeof ref === "string" && (ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("/"));
}

/** Resolved artwork URL cache — keyed by track name. */
const artworkUrlCache = new Map();
/** In-flight artwork resolution promises — keyed by artwork asset identity. */
const artworkInflight = new Map();
/** TTL expiry for failed artwork lookups — keyed by track name. */
const artworkFailedUntil = new Map();
const ARTWORK_FAIL_TTL_MS = 30_000;

/**
 * Derive the artwork identity key used for inflight dedupe.
 * Two tracks that resolve to the same backend asset should share one request.
 *
 * Priority: non-URL artwork_ref (asset name) > track.name for has_artwork > null.
 */
function artworkIdentity(track) {
  if (track.artwork_ref && !isArtworkUrl(track.artwork_ref)) return track.artwork_ref;
  if (track.has_artwork) return track.name;
  return null;
}

/**
 * Resolve the artwork URL for a track.
 *
 * - If `artwork_ref` is already a URL, use directly.
 * - If the track has embedded artwork (`has_artwork`), resolve via access endpoint.
 * - Otherwise returns "".
 */
async function resolveArtworkUrl(track) {
  if (!track?.name) return "";
  const cached = artworkUrlCache.get(track.name);
  if (cached !== undefined) return cached;
  const failExpiry = artworkFailedUntil.get(track.name);
  if (failExpiry && Date.now() < failExpiry) return "";
  artworkFailedUntil.delete(track.name);

  if (track.artwork_ref && isArtworkUrl(track.artwork_ref)) {
    artworkUrlCache.set(track.name, track.artwork_ref);
    return track.artwork_ref;
  }

  // Resolve artwork for tracks with embedded artwork OR snapshot tracks
  // whose artwork_ref is a plain asset name (not a URL).
  const artworkAssetName = track.has_artwork
    ? track.name
    : (track.artwork_ref && !isArtworkUrl(track.artwork_ref) ? track.artwork_ref : null);

  if (artworkAssetName && !track._demo) {
    // Check inflight dedupe by artwork identity
    const identity = artworkIdentity(track);
    const pending = identity ? artworkInflight.get(identity) : null;
    if (pending) {
      const result = await pending;
      if (result.ok) {
        artworkUrlCache.set(track.name, result.url);
        return result.url;
      }
      artworkFailedUntil.set(track.name, Date.now() + ARTWORK_FAIL_TTL_MS);
      return "";
    }

    const promise = (async () => {
      let gate = null;
      try {
        gate = await getProtectedMediaRequestGate();
        if (!gate.allowed) return { ok: false, url: "" };
        const resp = await getBackendMediaAssetAccess({
          name: artworkAssetName,
          intent: "artwork",
          signal: gate.signal,
        });
        return { ok: true, url: resp?.access?.artwork_url || "" };
      } catch {
        return { ok: false, url: "" };
      } finally {
        gate?.cleanup?.();
      }
    })();

    if (identity) artworkInflight.set(identity, promise);
    try {
      const result = await promise;
      if (result.ok) {
        artworkUrlCache.set(track.name, result.url);
        return result.url;
      }
      artworkFailedUntil.set(track.name, Date.now() + ARTWORK_FAIL_TTL_MS);
      return "";
    } finally {
      if (identity) artworkInflight.delete(identity);
    }
  }

  artworkUrlCache.set(track.name, "");
  return "";
}

/**
 * Create the compact player panel.
 *
 * @param {{ container: HTMLElement }} opts
 * @returns {{
 *   root: HTMLElement,
 *   header: HTMLElement,
 *   nowPlaying: HTMLElement,
 *   closeBtn: HTMLElement,
 *   destroy: () => void,
 *   setTracks: (tracks: object[]) => void,
 * }}
 */
export function createPlayerShell({ container }) {
  // ── Root panel ─────────────────────────────────────────────────
  const root = document.createElement("section");
  root.className = "player-panel";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", t("playerNowPlaying"));

  // ── Header (drag handle) ───────────────────────────────────────
  const header = document.createElement("div");
  header.className = "player-header";

  const headerMain = document.createElement("div");
  headerMain.className = "player-header-main";

  const headerGrip = document.createElement("div");
  headerGrip.className = "player-header-grip";
  headerGrip.setAttribute("aria-hidden", "true");
  headerMain.append(headerGrip);

  const visualizerToggleBtn = makeUtilityBtn(
    "player-visualizer-toggle-btn",
    IconVisualizer,
    t("mediaPlayerVisualizerMode"),
    t("playerVisualsShort"),
  );

  const milkdropToggleBtn = makeUtilityBtn(
    "player-milkdrop-toggle-btn",
    IconMilkdrop,
    t("milkdropOpen"),
    t("milkdropTitle"),
  );

  const contentToggleBtn = makeUtilityBtn(
    "player-content-toggle-btn",
    IconLibrary,
    t("playerContent"),
    t("playerBrowseShort"),
  );
  contentToggleBtn.setAttribute("aria-expanded", "false");
  contentToggleBtn.setAttribute("aria-pressed", "false");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "player-close";
  closeBtn.setAttribute("aria-label", t("close"));
  closeBtn.title = t("close");
  closeBtn.innerHTML = IconClose;

  header.append(headerMain, closeBtn);

  // ── Now-playing row (compact artwork + metadata) ───────────────
  const nowPlaying = document.createElement("div");
  nowPlaying.className = "player-now-playing";

  const artworkCompact = document.createElement("div");
  artworkCompact.className = "player-artwork-compact";
  artworkCompact.innerHTML = IconMusic;

  const metaSection = document.createElement("div");
  metaSection.className = "player-meta";
  const metaTitle = document.createElement("div");
  metaTitle.className = "player-meta-title";
  metaTitle.textContent = t("playerNowPlaying");
  const metaArtist = document.createElement("div");
  metaArtist.className = "player-meta-artist";
  const metaGenre = document.createElement("span");
  metaGenre.className = "player-meta-genre";
  metaGenre.hidden = true;
  const sourceBadge = document.createElement("span");
  sourceBadge.className = "player-source-badge";
  sourceBadge.hidden = true;
  metaSection.append(metaTitle, metaArtist, metaGenre, sourceBadge);

  nowPlaying.append(artworkCompact, metaSection);

  // ── Mini visualizer ─────────────────────────────────────────────
  const visualizerStrip = document.createElement("button");
  visualizerStrip.type = "button";
  visualizerStrip.className = "player-visualizer-strip";
  visualizerStrip.dataset.visualizerState = "disabled";
  visualizerStrip.dataset.visualizerMode = "spectrum";
  visualizerStrip.setAttribute("aria-label", t("mediaPlayerVisualizerCycle"));

  const visualizerHost = document.createElement("div");
  visualizerHost.className = "player-visualizer-host";

  const visualizerLabel = document.createElement("span");
  visualizerLabel.className = "player-visualizer-label";
  visualizerLabel.textContent = t("mediaPlayerVisualizerSpectrum");

  visualizerStrip.append(visualizerHost, visualizerLabel);

  // ── Error ──────────────────────────────────────────────────────
  const errorMsg = document.createElement("div");
  errorMsg.className = "player-error";
  errorMsg.hidden = true;

  // ── Progress ───────────────────────────────────────────────────
  const progressSection = document.createElement("div");
  progressSection.className = "player-progress-section";

  const progressBar = document.createElement("input");
  progressBar.type = "range";
  progressBar.className = "player-progress";
  progressBar.min = "0";
  progressBar.max = String(PROGRESS_MAX);
  progressBar.value = "0";
  progressBar.step = "1";
  progressBar.setAttribute("aria-label", t("mediaPlayerProgress"));

  const timeRow = document.createElement("div");
  timeRow.className = "player-time-row";
  const timeCurrent = document.createElement("span");
  timeCurrent.className = "player-time-current";
  timeCurrent.textContent = "0:00";
  const timeTotal = document.createElement("span");
  timeTotal.className = "player-time-total";
  timeTotal.textContent = "0:00";
  timeRow.append(timeCurrent, timeTotal);
  progressSection.append(progressBar, timeRow);

  // ── Transport controls ─────────────────────────────────────────
  const transport = document.createElement("div");
  transport.className = "player-transport";

  const shuffleBtn = makeBtn("player-btn-shuffle", IconShuffle, t("playerShuffle"));
  const prevBtn = makeBtn("player-btn-prev", IconSkipBack, t("playerPreviousTrack"));
  const playBtn = makeBtn("player-btn-play", IconPlay, t("mediaPlayerPlay"));
  playBtn.classList.add("player-btn-play-main");
  const nextBtn = makeBtn("player-btn-next", IconSkipForward, t("playerNextTrack"));
  const repeatBtn = makeBtn("player-btn-repeat", IconRepeat, t("playerRepeat"));

  transport.append(shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn);

  // ── Volume row ─────────────────────────────────────────────────
  const volumeRow = document.createElement("div");
  volumeRow.className = "player-volume-row";

  const muteBtn = makeBtn("player-btn-mute", IconVolume, t("mediaPlayerMute"));
  const volumeSlider = document.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.className = "player-volume";
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.value = "100";
  volumeSlider.step = "1";
  volumeSlider.setAttribute("aria-label", t("mediaPlayerVolume"));

  volumeRow.append(muteBtn, volumeSlider);
  updateRangeVisualFill(volumeSlider);

  // ── Utility controls ───────────────────────────────────────────
  const utilityRow = document.createElement("div");
  utilityRow.className = "player-utility-row";
  utilityRow.append(visualizerToggleBtn, milkdropToggleBtn, contentToggleBtn);

  // ── Integrated content sheet ───────────────────────────────────
  const contentSheet = document.createElement("div");
  contentSheet.className = "player-content-sheet";
  contentSheet.setAttribute("aria-hidden", "true");

  const contentSheetHeader = document.createElement("div");
  contentSheetHeader.className = "player-content-sheet-header";

  const contentTabs = document.createElement("div");
  contentTabs.className = "player-content-tabs";
  contentTabs.setAttribute("role", "tablist");
  contentTabs.setAttribute("aria-label", t("playerContent"));

  const queueTabBtn = makeTabBtn("queue", IconQueue, t("playerQueue"));
  const libraryTabBtn = makeTabBtn("library", IconLibrary, t("playerLibrary"));
  const playlistTabBtn = makeTabBtn("playlists", IconPlaylist, t("playerPlaylists"));

  contentTabs.append(queueTabBtn, libraryTabBtn, playlistTabBtn);

  const contentCloseBtn = document.createElement("button");
  contentCloseBtn.type = "button";
  contentCloseBtn.className = "player-content-sheet-close";
  contentCloseBtn.setAttribute("aria-label", t("close"));
  contentCloseBtn.innerHTML = IconClose;

  contentSheetHeader.append(contentTabs, contentCloseBtn);

  const contentPaneStack = document.createElement("div");
  contentPaneStack.className = "player-content-pane-stack";

  const queuePane = document.createElement("section");
  queuePane.className = "player-content-pane player-content-pane-queue";
  queuePane.hidden = true;
  queuePane.setAttribute("role", "tabpanel");
  queuePane.setAttribute("aria-hidden", "true");

  const libraryPane = document.createElement("section");
  libraryPane.className = "player-content-pane player-content-pane-library";
  libraryPane.hidden = true;
  libraryPane.setAttribute("role", "tabpanel");
  libraryPane.setAttribute("aria-hidden", "true");

  const playlistPane = document.createElement("section");
  playlistPane.className = "player-content-pane player-content-pane-playlists";
  playlistPane.hidden = true;
  playlistPane.setAttribute("role", "tabpanel");
  playlistPane.setAttribute("aria-hidden", "true");

  const queueSheetHeader = document.createElement("div");
  queueSheetHeader.className = "player-content-pane-toolbar player-queue-toolbar";

  const queueSheetTitle = document.createElement("span");
  queueSheetTitle.textContent = t("playerUpNext");

  const queueSheetClearBtn = document.createElement("button");
  queueSheetClearBtn.type = "button";
  queueSheetClearBtn.className = "player-queue-clear-btn";
  queueSheetClearBtn.textContent = t("playerClearQueue");

  const queueSaveBtn = document.createElement("button");
  queueSaveBtn.type = "button";
  queueSaveBtn.className = "player-queue-save-btn";
  queueSaveBtn.textContent = t("playerSaveQueueAsPlaylist");
  queueSaveBtn.setAttribute("aria-live", "polite");

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "player-queue-search";
  searchInput.placeholder = t("playerSearch");
  searchInput.setAttribute("aria-label", t("playerSearch"));

  queueSheetHeader.append(queueSheetTitle, queueSheetClearBtn, queueSaveBtn, searchInput);

  const trackListUl = document.createElement("ul");
  trackListUl.className = "player-queue-list";
  trackListUl.setAttribute("role", "list");

  queuePane.append(queueSheetHeader, trackListUl);

  const librarySheetHeader = document.createElement("div");
  librarySheetHeader.className = "player-content-pane-toolbar player-library-toolbar";

  const librarySheetTitle = document.createElement("span");
  librarySheetTitle.textContent = t("playerLibrary");

  const librarySearchInput = document.createElement("input");
  librarySearchInput.type = "search";
  librarySearchInput.className = "player-library-search";
  librarySearchInput.placeholder = t("playerSearch");
  librarySearchInput.setAttribute("aria-label", t("playerSearch"));

  librarySheetHeader.append(librarySheetTitle, librarySearchInput);

  const libraryListUl = document.createElement("ul");
  libraryListUl.className = "player-library-list";
  libraryListUl.setAttribute("role", "list");

  libraryPane.append(librarySheetHeader, libraryListUl);

  const playlistSheetHeader = document.createElement("div");
  playlistSheetHeader.className = "player-content-pane-toolbar player-playlist-toolbar-header";

  const playlistBackBtn = document.createElement("button");
  playlistBackBtn.type = "button";
  playlistBackBtn.className = "player-playlist-back-btn";
  playlistBackBtn.textContent = "\u2190";
  playlistBackBtn.hidden = true;
  playlistBackBtn.setAttribute("aria-label", t("playerBackToPlaylists"));

  const playlistSheetTitle = document.createElement("span");
  playlistSheetTitle.textContent = t("playerPlaylists");

  playlistSheetHeader.append(playlistBackBtn, playlistSheetTitle);

  const playlistListUl = document.createElement("ul");
  playlistListUl.className = "player-playlist-list";
  playlistListUl.setAttribute("role", "list");

  playlistPane.append(playlistSheetHeader, playlistListUl);
  contentPaneStack.append(queuePane, libraryPane, playlistPane);
  contentSheet.append(contentSheetHeader, contentPaneStack);

  // ── Assembly ───────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "player-body";
  body.append(nowPlaying, visualizerStrip, errorMsg, progressSection, transport, volumeRow, utilityRow);

  root.append(header, body, contentSheet);
  container.append(root);

  // ── State ──────────────────────────────────────────────────────
  let seeking = false;
  let allTracks = [];
  let contentOpen = false;
  let activeContentTab = "queue";
  let queueOpen = false;
  let queueFilter = "";
  let lastRenderedQueueSignature = "";
  let queueSaveStatusTimer = 0;
  let visualizerVisible = loadText(VISUALIZER_VISIBLE_STORAGE_KEY, "true") !== "false";
  let visualizerMode = normalizeVisualizerMode(loadText(VISUALIZER_MODE_STORAGE_KEY, "spectrum"));
  let visualizerController = null;
  let visualizerMediaElement = null;
  let visualizerFailed = false;

  // iOS Safari requires a user gesture before an AudioContext can run.
  // Block automatic visualizer start (from runtime state subscription) until
  // the very first user interaction (play / skip / toggle / track click).
  const _needsGestureGate = (() => {
    const ua = navigator.userAgent || "";
    return /Safari\//i.test(ua) && !/Chrom(e|ium)\//i.test(ua) && /iP(hone|od|ad)/i.test(ua);
  })();
  let _gestureUnlocked = !_needsGestureGate;

  // ── Integrated content sheet toggle ────────────────────────────
  const CONTENT_TABS = new Set(["queue", "library", "playlists"]);
  const tabButtons = {
    queue: queueTabBtn,
    library: libraryTabBtn,
    playlists: playlistTabBtn,
  };
  const tabPanes = {
    queue: queuePane,
    library: libraryPane,
    playlists: playlistPane,
  };

  function syncContentSheet({ render = true } = {}) {
    queueOpen = contentOpen && activeContentTab === "queue";
    libraryOpen = contentOpen && activeContentTab === "library";
    playlistOpen = contentOpen && activeContentTab === "playlists";

    contentSheet.classList.toggle("is-open", contentOpen);
    contentSheet.setAttribute("aria-hidden", String(!contentOpen));
    contentToggleBtn.classList.toggle("active", contentOpen);
    contentToggleBtn.setAttribute("aria-expanded", String(contentOpen));
    contentToggleBtn.setAttribute("aria-pressed", String(contentOpen));

    for (const tab of CONTENT_TABS) {
      const isActive = contentOpen && activeContentTab === tab;
      tabButtons[tab].classList.toggle("active", isActive);
      tabButtons[tab].setAttribute("aria-selected", String(isActive));
      tabButtons[tab].setAttribute("tabindex", isActive ? "0" : "-1");
      tabPanes[tab].hidden = !isActive;
      tabPanes[tab].classList.toggle("is-open", isActive);
      tabPanes[tab].setAttribute("aria-hidden", String(!isActive));
    }

    if (!render || !contentOpen) return;
    if (queueOpen) {
      renderTrackList(queueFilter);
    } else if (libraryOpen) {
      renderLibraryList(libraryFilter);
    } else if (playlistOpen && !playlistDetailView) {
      renderPlaylistList();
    }
  }

  function setContentOpen(open, tab = activeContentTab) {
    if (open && CONTENT_TABS.has(tab)) {
      activeContentTab = tab;
    }
    contentOpen = Boolean(open);
    syncContentSheet();
  }

  function setActiveContentTab(tab) {
    if (!CONTENT_TABS.has(tab)) return;
    const changed = activeContentTab !== tab;
    activeContentTab = tab;
    contentOpen = true;
    if (tab === "playlists" && changed) {
      playlistDetailView = null;
    }
    syncContentSheet();
  }

  function setQueueOpen(open) {
    setContentOpen(open, "queue");
  }

  // Prevent content controls from triggering header drag
  contentToggleBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  contentToggleBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  contentToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setContentOpen(!contentOpen);
  });
  contentCloseBtn.addEventListener("click", () => setContentOpen(false));

  for (const [tab, btn] of Object.entries(tabButtons)) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setActiveContentTab(tab);
    });
  }

  function handleContentPaneWheel(e) {
    const pane = e.currentTarget;
    if (!(pane instanceof HTMLElement) || pane.hidden) return;

    const canScrollY = pane.scrollHeight > pane.clientHeight;
    const canScrollX = pane.scrollWidth > pane.clientWidth;
    if (!canScrollY && !canScrollX) return;

    if (canScrollY && e.deltaY) {
      pane.scrollTop += e.deltaY;
    }
    if (canScrollX && e.deltaX) {
      pane.scrollLeft += e.deltaX;
    }

    e.preventDefault();
    e.stopPropagation();
  }

  for (const pane of Object.values(tabPanes)) {
    pane.addEventListener("wheel", handleContentPaneWheel, { passive: false });
  }

  queueTabBtn.addEventListener("keydown", (e) => handleContentTabKeydown(e, "queue"));
  libraryTabBtn.addEventListener("keydown", (e) => handleContentTabKeydown(e, "library"));
  playlistTabBtn.addEventListener("keydown", (e) => handleContentTabKeydown(e, "playlists"));

  function handleContentTabKeydown(e, currentTab) {
    const order = ["queue", "library", "playlists"];
    const index = order.indexOf(currentTab);
    if (index === -1) return;
    let nextTab = "";
    if (e.key === "ArrowRight") {
      nextTab = order[(index + 1) % order.length];
    } else if (e.key === "ArrowLeft") {
      nextTab = order[(index - 1 + order.length) % order.length];
    }
    if (!nextTab) return;
    e.preventDefault();
    setActiveContentTab(nextTab);
    tabButtons[nextTab]?.focus?.();
  }

  // Clear queue button
  queueSheetClearBtn.addEventListener("click", () => {
    runtime.stopPlayback();
    runtime.setQueue([], { autoplay: false });
    renderTrackList();
  });

  function clearQueueSaveStatusTimer() {
    if (!queueSaveStatusTimer) return;
    clearTimeout(queueSaveStatusTimer);
    queueSaveStatusTimer = 0;
  }

  function resetQueueSaveButton() {
    clearQueueSaveStatusTimer();
    queueSaveBtn.disabled = false;
    queueSaveBtn.textContent = t("playerSaveQueueAsPlaylist");
  }

  function showQueueSaveButtonStatus(labelKey) {
    clearQueueSaveStatusTimer();
    queueSaveBtn.disabled = true;
    queueSaveBtn.textContent = t(labelKey);
    queueSaveStatusTimer = window.setTimeout(() => {
      resetQueueSaveButton();
    }, 2000);
  }

  // Save queue as playlist — prompt for title instead of expanding the toolbar
  queueSaveBtn.addEventListener("click", async () => {
    if (queueSaveBtn.disabled) return;

    const initialState = runtime.getState();
    const initialSaveable = initialState.queue.filter((tr) => tr.name && !tr._demo);
    if (initialSaveable.length === 0) return;

    const title = await showPromptDialog({
      title: t("playerSaveQueueAsPlaylist"),
      placeholder: t("playerPlaylistTitlePlaceholder"),
      confirmLabel: t("playerSaveConfirm"),
      cancelLabel: t("cancel"),
      inputLabel: t("playerPlaylistTitlePlaceholder"),
      maxLength: 140,
    });
    if (title === null) return;

    const trimmedTitle = String(title || "").trim();
    if (!trimmedTitle) return;

    const currentState = runtime.getState();
    const saveable = currentState.queue.filter((tr) => tr.name && !tr._demo);
    if (saveable.length === 0) return;

    clearQueueSaveStatusTimer();
    queueSaveBtn.disabled = true;
    queueSaveBtn.textContent = t("playerSavingPlaylist");

    let statusKey = "playerPlaylistSaveFailed";
    let gate = null;
    try {
      gate = await getProtectedMediaRequestGate();
      if (!gate.allowed) {
        return;
      }

      const result = await createBackendPlaylist({ title: trimmedTitle, signal: gate.signal });
      if (!result.ok || !result.playlist?.name) {
        return;
      }

      const bulkResult = await bulkAddBackendPlaylistItems({
        name: result.playlist.name,
        mediaAssetNames: saveable.map((tr) => tr.name),
        signal: gate.signal,
      });

      if (bulkResult?.ok) {
        statusKey = bulkResult.skipped?.length
          ? "playerPlaylistSavedPartial"
          : "playerPlaylistSaved";
      }
    } catch {
      statusKey = "playerPlaylistSaveFailed";
    } finally {
      gate?.cleanup?.();
      showQueueSaveButtonStatus(statusKey);
    }
  });

  // ── Library content pane ────────────────────────────────────────
  let libraryOpen = false;
  let libraryFilter = "";

  function setLibraryOpen(open) {
    setContentOpen(open, "library");
  }

  function renderLibraryList(filter = "") {
    libraryListUl.innerHTML = "";
    const audioTracks = allTracks.filter(isAudioAsset);

    const tracks = filter
      ? audioTracks.filter((tr) => {
          const hay = `${tr.title || ""} ${tr.artist || ""} ${tr.album || ""} ${tr.original_filename || ""} ${tr.folder_path || ""}`.toLowerCase();
          return hay.includes(filter);
        })
      : audioTracks;

    if (tracks.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "player-library-empty";
      emptyLi.textContent = allTracks.length === 0 ? t("playerEmptyLibrary") : t("playerNoTracks");
      libraryListUl.append(emptyLi);
      return;
    }

    for (const track of tracks) {
      const li = document.createElement("li");
      li.className = "player-library-item";
      li.dataset.trackName = track.name;

      const infoDiv = document.createElement("div");
      infoDiv.className = "player-library-item-info";

      const nameSpan = document.createElement("span");
      nameSpan.className = "player-library-item-name";
      nameSpan.textContent = track.title || track.original_filename || track.name;

      const artistSpan = document.createElement("span");
      artistSpan.className = "player-library-item-artist";
      artistSpan.textContent = track.artist || "";

      const durationSpan = document.createElement("span");
      durationSpan.className = "player-library-item-duration";
      if (track.duration != null && Number.isFinite(track.duration)) {
        durationSpan.textContent = formatTime(track.duration);
      }

      const badge = document.createElement("span");
      badge.className = "player-library-item-badge";
      if (track._offline) {
        badge.classList.add("offline");
        badge.title = t("playerOffline");
      }

      infoDiv.append(nameSpan, artistSpan, durationSpan, badge);

      // Action buttons
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "player-library-item-actions";

      function playTrackNow() {
        _gestureUnlocked = true;
        primeAudioContext();
        void runtime.playLibraryTrackNow(track, audioTracks);
      }

      const playNowBtn = makeActionBtn(
        "player-library-action-btn player-library-action-btn--primary",
        IconPlay,
        t("playerPlayNow"),
        t("playerPlayNowShort"),
      );
      playNowBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        playTrackNow();
      });

      const playNextBtn = makeActionBtn(
        "player-library-action-btn",
        IconSkipForward,
        t("playerPlayNext"),
        t("playerPlayNextShort"),
      );
      playNextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        runtime.playNext([track]);
      });

      const addToQueueBtn = makeActionBtn(
        "player-library-action-btn",
        IconQueue,
        t("playerAddToQueue"),
        t("playerAddToQueueShort"),
      );
      addToQueueBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        runtime.enqueue([track]);
      });

      actionsDiv.append(playNowBtn, playNextBtn, addToQueueBtn);
      li.append(infoDiv, actionsDiv);

      // Default click = play now
      li.addEventListener("click", () => {
        playTrackNow();
      });

      libraryListUl.append(li);
    }
  }

  librarySearchInput.addEventListener("input", () => {
    libraryFilter = librarySearchInput.value.trim().toLowerCase();
    renderLibraryList(libraryFilter);
  });

  // ── Playlist content pane ──────────────────────────────────────
  let playlistOpen = false;
  let playlistDetailView = null; // null = list view, string = viewing a playlist by name
  let cachedPlaylists = [];
  let lastPinResult = null; // { playlistName, results } — tracks partial pin failures for retry

  function setPlaylistOpen(open) {
    if (open) {
      playlistDetailView = null;
    }
    setContentOpen(open, "playlists");
  }

  function renderPlaylistList() {
    playlistListUl.innerHTML = "";
    playlistBackBtn.hidden = true;
    playlistSheetTitle.textContent = t("playerPlaylists");
    playlistDetailView = null;

    if (cachedPlaylists.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "player-playlist-empty";
      emptyLi.textContent = t("playerNoPlaylists");
      playlistListUl.append(emptyLi);
      return;
    }

    for (const pl of cachedPlaylists) {
      const li = document.createElement("li");
      li.className = "player-playlist-item";
      li.dataset.playlistName = pl.name;

      // Cover artwork thumbnail
      const coverDiv = document.createElement("div");
      coverDiv.className = "player-playlist-item-cover";
      coverDiv.innerHTML = IconMusic;
      li.append(coverDiv);
      if (pl.cover_asset_name) {
        resolveArtworkUrl({
          name: pl.cover_asset_name,
          artwork_ref: pl.cover_asset_name,
          has_artwork: false,
        }).then((url) => {
          if (url) {
            coverDiv.innerHTML = "";
            coverDiv.style.backgroundImage = `url(${CSS.escape(url)})`;
            coverDiv.classList.add("has-image");
          }
        });
      }

      const textDiv = document.createElement("div");
      textDiv.className = "player-playlist-item-text";

      const nameSpan = document.createElement("span");
      nameSpan.className = "player-playlist-item-name";
      nameSpan.textContent = pl.title || pl.name;

      const countSpan = document.createElement("span");
      countSpan.className = "player-playlist-item-count";
      const totalDur = pl.total_duration_seconds;
      const countText = t("playerPlaylistTracks", { count: pl.item_count ?? 0 });
      countSpan.textContent = totalDur && Number.isFinite(totalDur)
        ? `${countText} · ${formatTime(totalDur)}`
        : countText;

      textDiv.append(nameSpan, countSpan);
      li.append(textDiv);
      li.addEventListener("click", () => openPlaylistDetail(pl.name, pl.title));
      playlistListUl.append(li);
    }
  }

  async function openPlaylistDetail(name, title) {
    playlistDetailView = name;
    playlistBackBtn.hidden = false;
    playlistSheetTitle.textContent = title || name;
    playlistListUl.innerHTML = "";

    // Check for a local (embedded) playlist first (e.g. demo playlists)
    const localPlaylist = cachedPlaylists.find(
      (pl) => pl.name === name && pl._local && Array.isArray(pl.items)
    );

    if (localPlaylist) {
      renderPlaylistDetailItems(name, title, localPlaylist.items);
      return;
    }

    const loadingLi = document.createElement("li");
    loadingLi.className = "player-playlist-empty";
    loadingLi.textContent = "...";
    playlistListUl.append(loadingLi);

    try {
      const detail = await loadPlaylistDetail(name);
      if (playlistDetailView !== name) return; // user navigated away

      playlistListUl.innerHTML = "";
      const items = Array.isArray(detail?.items) ? detail.items : [];
      renderPlaylistDetailItems(name, title, items);
    } catch {
      if (playlistDetailView !== name) return;
      playlistListUl.innerHTML = "";
      const errorLi = document.createElement("li");
      errorLi.className = "player-playlist-empty";
      errorLi.textContent = t("playerNoTracks");
      playlistListUl.append(errorLi);
    }
  }

  async function renderPlaylistDetailItems(name, title, items) {
    playlistListUl.innerHTML = "";

    if (items.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "player-playlist-empty";
      emptyLi.textContent = t("playerNoTracks");
      playlistListUl.append(emptyLi);
      return;
    }

    // Cover artwork header
    const coverAsset = cachedPlaylists.find((pl) => pl.name === name)?.cover_asset_name
      || items[0]?.snapshot_artwork_ref || "";
    if (coverAsset) {
      const coverLi = document.createElement("li");
      coverLi.className = "player-playlist-detail-cover";
      coverLi.innerHTML = IconMusic;
      playlistListUl.append(coverLi);
      resolveArtworkUrl({
        name: coverAsset,
        artwork_ref: coverAsset,
        has_artwork: false,
      }).then((url) => {
        if (url && playlistDetailView === name) {
          coverLi.innerHTML = "";
          coverLi.style.backgroundImage = `url(${CSS.escape(url)})`;
          coverLi.classList.add("has-image");
        }
      });
    }

    // Check if this is a local playlist (demo) — skip pinning UI
    const isLocal = cachedPlaylists.find((pl) => pl.name === name)?._local === true;

    // Check pinned status for each track (skip for local playlists)
    const trackMap = new Map(allTracks.map((tr) => [tr.name, tr]));
    const pinnedChecks = isLocal
      ? items.map(() => false)
      : await Promise.all(
          items.map(async (item) => {
            try {
              return await isMediaBlobPinned(item.media_asset_name);
            } catch {
              return false;
            }
          })
        );

    const totalTracks = items.length;
    const pinnedCount = pinnedChecks.filter(Boolean).length;

    // Toolbar row: Play All + pin status + pin/unpin
    const toolbarLi = document.createElement("li");
    toolbarLi.className = "player-playlist-toolbar";

    const playAllBtn = document.createElement("button");
    playAllBtn.type = "button";
    playAllBtn.className = "player-playlist-play-all-btn";
    playAllBtn.textContent = t("playerPlayAll");
    playAllBtn.addEventListener("click", () => {
      _gestureUnlocked = true;
      primeAudioContext();
      playPlaylistTracks(items);
    });

    toolbarLi.append(playAllBtn);

    // Only show pin/offline status for non-local playlists
    if (!isLocal) {
      const statusSpan = document.createElement("span");
      statusSpan.className = "player-playlist-offline-status";
      if (pinnedCount === totalTracks) {
        statusSpan.textContent = t("playerPlaylistFullyPinned");
        statusSpan.classList.add("fully-offline");
      } else if (pinnedCount > 0) {
        statusSpan.textContent = t("playerPlaylistPartiallyPinned").replace("{0}", pinnedCount).replace("{1}", totalTracks);
      } else {
        statusSpan.textContent = t("playerPlaylistCloudOnly");
      }
      toolbarLi.append(statusSpan);

      // Pin or unpin button
      if (pinnedCount === totalTracks) {
        const unpinBtn = document.createElement("button");
        unpinBtn.type = "button";
        unpinBtn.className = "player-playlist-download-btn";
        unpinBtn.textContent = t("playerUnpinPlaylist");
        unpinBtn.addEventListener("click", () => {
          unpinBtn.disabled = true;
          unpinBtn.textContent = t("playerUnpinning");
          unpinPlaylistTracks(items).then(() => {
            lastPinResult = null;
            if (playlistDetailView === name) openPlaylistDetail(name, title);
          }).catch(() => {
            unpinBtn.disabled = false;
            unpinBtn.textContent = t("playerUnpinPlaylist");
          });
        });
        toolbarLi.append(unpinBtn);
      } else {
        const pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = "player-playlist-download-btn";
        pinBtn.textContent = t("playerPinPlaylist");
        pinBtn.addEventListener("click", () => {
          pinBtn.disabled = true;
          pinBtn.textContent = t("playerPinning");
          pinPlaylistTracks(items, trackMap, pinnedChecks).then((results) => {
            const failed = results ? results.filter((r) => !r.ok && r.reason !== "already_pinned") : [];
            lastPinResult = failed.length > 0 ? { playlistName: name, results } : null;
            if (playlistDetailView === name) openPlaylistDetail(name, title);
          }).catch(() => {
            pinBtn.disabled = false;
            pinBtn.textContent = t("playerPinPlaylist");
          });
        });
        toolbarLi.append(pinBtn);
      }

      // Show failure summary + retry from last pin attempt
      if (lastPinResult && lastPinResult.playlistName === name) {
        const failedResults = lastPinResult.results.filter((r) => !r.ok && r.reason !== "already_pinned");
        const succeededCount = lastPinResult.results.filter((r) => r.ok).length;
        if (failedResults.length > 0) {
          const resultSpan = document.createElement("span");
          resultSpan.className = "player-playlist-pin-result";
          resultSpan.textContent = t("playerPinResult")
            .replace("{0}", succeededCount)
            .replace("{1}", failedResults.length);
          toolbarLi.append(resultSpan);

          const retryBtn = document.createElement("button");
          retryBtn.type = "button";
          retryBtn.className = "player-playlist-download-btn";
          retryBtn.textContent = t("playerRetryFailed");
          retryBtn.addEventListener("click", () => {
            retryBtn.disabled = true;
            retryBtn.textContent = t("playerPinning");
            const failedNames = new Set(failedResults.map((r) => r.name));
            const retryItems = items.filter((i) => failedNames.has(i.media_asset_name));
            const retryPinnedChecks = retryItems.map(() => false);
            pinPlaylistTracks(retryItems, trackMap, retryPinnedChecks).then((retryResults) => {
              const stillFailed = retryResults ? retryResults.filter((r) => !r.ok && r.reason !== "already_pinned") : [];
              lastPinResult = stillFailed.length > 0 ? { playlistName: name, results: retryResults } : null;
              if (playlistDetailView === name) openPlaylistDetail(name, title);
            }).catch(() => {
              retryBtn.disabled = false;
              retryBtn.textContent = t("playerRetryFailed");
            });
          });
          toolbarLi.append(retryBtn);
        }
      }
    }

    playlistListUl.append(toolbarLi);

    // Track items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isPinned = pinnedChecks[i];
      const li = document.createElement("li");
      li.className = "player-playlist-track-item";

      const catalogTrack = trackMap.get(item.media_asset_name);
      const displayTitle = catalogTrack?.title || item.snapshot_title || item.media_asset_name || "";
      const displayArtist = catalogTrack?.artist || item.snapshot_artist || "";
      const displayAlbum = catalogTrack?.album || item.snapshot_album || "";
      const displayDuration = catalogTrack?.duration ?? item.snapshot_duration ?? null;

      const nameSpan = document.createElement("span");
      nameSpan.className = "player-playlist-track-name";
      nameSpan.textContent = displayTitle;

      const artistSpan = document.createElement("span");
      artistSpan.className = "player-playlist-track-artist";
      artistSpan.textContent = displayAlbum
        ? (displayArtist ? `${displayArtist} · ${displayAlbum}` : displayAlbum)
        : displayArtist;

      const durationSpan = document.createElement("span");
      durationSpan.className = "player-playlist-track-duration";
      if (displayDuration != null && Number.isFinite(displayDuration)) {
        durationSpan.textContent = formatTime(displayDuration);
      }

      const badge = document.createElement("span");
      badge.className = "player-playlist-track-badge";
      if (isPinned) {
        badge.classList.add("offline");
        badge.title = t("playerOffline");
      } else if (!catalogTrack && !isLocal) {
        li.classList.add("unavailable");
      } else if (!isLocal) {
        badge.classList.add("cloud");
        badge.title = t("playerRemote");
      }

      const infoDiv = document.createElement("div");
      infoDiv.className = "player-playlist-track-info";
      infoDiv.append(nameSpan, artistSpan, durationSpan, badge);

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "player-playlist-track-actions";

      const playNextBtn = document.createElement("button");
      playNextBtn.type = "button";
      playNextBtn.className = "player-playlist-track-action-btn";
      playNextBtn.textContent = t("playerPlayNext");
      playNextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const resolved = catalogTrack || normalizeTrack({
          name: item.media_asset_name,
          title: item.snapshot_title || item.media_asset_name,
          artist: item.snapshot_artist || "",
          duration: item.snapshot_duration,
          snapshot_album: item.snapshot_album || "",
          snapshot_genre: item.snapshot_genre || "",
          snapshot_artwork_ref: item.snapshot_artwork_ref || "",
          snapshot_content_hash: item.snapshot_content_hash || "",
          media_kind: "audio",
        });
        if (resolved) runtime.playNext([resolved]);
      });

      const addToQueueBtn = document.createElement("button");
      addToQueueBtn.type = "button";
      addToQueueBtn.className = "player-playlist-track-action-btn";
      addToQueueBtn.textContent = t("playerAddToQueue");
      addToQueueBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const resolved = catalogTrack || normalizeTrack({
          name: item.media_asset_name,
          title: item.snapshot_title || item.media_asset_name,
          artist: item.snapshot_artist || "",
          duration: item.snapshot_duration,
          snapshot_album: item.snapshot_album || "",
          snapshot_genre: item.snapshot_genre || "",
          snapshot_artwork_ref: item.snapshot_artwork_ref || "",
          snapshot_content_hash: item.snapshot_content_hash || "",
          media_kind: "audio",
        });
        if (resolved) runtime.enqueue([resolved]);
      });

      actionsDiv.append(playNextBtn, addToQueueBtn);
      li.append(infoDiv, actionsDiv);
      li.addEventListener("click", () => {
        _gestureUnlocked = true;
        primeAudioContext();
        playPlaylistTracks(items, item);
      });
      playlistListUl.append(li);
    }
  }

  /**
   * Pin all non-pinned tracks in a playlist for durable offline access.
   * Uses the same download flow as the library: signed URL → BFF fallback → pinMediaFromResponse.
   * Promotes existing cached blobs to pinned when possible (no network needed).
   * Returns a per-track results array: { name, ok, reason }.
   */
  async function pinPlaylistTracks(items, trackMap, pinnedChecks) {
    const results = [];
    const pending = [];

    for (let i = 0; i < items.length; i++) {
      const assetName = items[i].media_asset_name;
      if (pinnedChecks[i]) {
        results.push({ name: assetName, ok: true, reason: "already_pinned" });
        continue;
      }

      const catalogTrack = trackMap.get(assetName);
      if (!catalogTrack) {
        results.push({ name: assetName, ok: false, reason: "not_in_catalog" });
        continue;
      }

      const idx = results.length;
      results.push({ name: assetName, ok: false, reason: "pending" });

      pending.push((async () => {
        try {
          // Fast path: promote cached blob to pinned locally
          const cachedBlob = await getCachedMediaBlob(assetName).catch(() => null);
          if (cachedBlob) {
            const cachedMeta = await getCachedBlobMeta(assetName).catch(() => null);
            const cachedHash = cachedMeta?.content_hash || null;
            const assetHash = catalogTrack.content_hash || null;
            const hashMatch = !assetHash || !cachedHash || assetHash === cachedHash;

            if (hashMatch) {
              const pinOk = await pinMediaBlob(assetName, cachedBlob, { contentHash: cachedHash });
              if (pinOk) {
                removeCachedMediaBlob(assetName).catch(() => {});
                results[idx] = { name: assetName, ok: true, reason: "promoted" };
                return;
              }
            }
          }

          // Network path: download and pin
          let gate = null;
          try {
            gate = await getProtectedMediaRequestGate();
            if (!gate.allowed) {
              results[idx] = { name: assetName, ok: false, reason: "not_allowed" };
              return;
            }

            let response = null;

            // 1. Signed download URL
            try {
              const result = await getBackendMediaAssetAccess({
                name: assetName,
                intent: "download",
                signal: gate.signal,
              });
              const signedUrl = result?.access?.download_url;
              if (signedUrl) {
                const r = await fetch(signedUrl, { signal: gate.signal });
                if (r.ok) response = r;
              }
            } catch { /* fall through */ }

            // 2. BFF stream fallback
            if (!response) {
              try {
                const r = await fetchBackendMediaAssetBlob({
                  name: assetName,
                  signal: gate.signal,
                });
                if (r.ok) response = r;
              } catch { /* fall through */ }
            }

            if (!response) {
              results[idx] = { name: assetName, ok: false, reason: "no_source" };
              return;
            }

            const pinOk = await pinMediaFromResponse(assetName, response, {
              contentHash: catalogTrack.content_hash || null,
            });

            if (pinOk) {
              removeCachedMediaBlob(assetName).catch(() => {});
              results[idx] = { name: assetName, ok: true, reason: "pinned" };
            } else {
              results[idx] = { name: assetName, ok: false, reason: "pin_failed" };
            }
          } finally {
            gate?.cleanup?.();
          }
        } catch {
          results[idx] = { name: assetName, ok: false, reason: "error" };
        }
      })());
    }

    await Promise.allSettled(pending);
    return results;
  }

  /**
   * Unpin all tracks in a playlist.
   */
  async function unpinPlaylistTracks(items) {
    const results = [];
    for (const item of items) {
      const assetName = item.media_asset_name;
      try {
        const ok = await unpinMediaBlob(assetName);
        results.push({ name: assetName, ok });
      } catch {
        results.push({ name: assetName, ok: false });
      }
    }
    return results;
  }

  function playPlaylistTracks(items, startItem) {
    // Resolve playlist items against the known track catalog.
    // Unavailable tracks are silently skipped — graceful degradation.
    const trackMap = new Map();
    for (const tr of allTracks) {
      trackMap.set(tr.name, tr);
    }

    const resolved = items
      .map((item) => {
        const catalogTrack = trackMap.get(item.media_asset_name);
        if (catalogTrack) {
          // Track exists in catalog — only include if it's audio
          return isAudioAsset(catalogTrack) ? catalogTrack : null;
        }
        // Track NOT in catalog (deleted?) — fall back to snapshot metadata
        // so the queue shows something meaningful for offline playlists
        if (item.snapshot_title || item.media_asset_name) {
          return normalizeTrack({
            name: item.media_asset_name,
            title: item.snapshot_title || item.media_asset_name,
            artist: item.snapshot_artist || "",
            duration: item.snapshot_duration,
            snapshot_album: item.snapshot_album || "",
            snapshot_genre: item.snapshot_genre || "",
            snapshot_artwork_ref: item.snapshot_artwork_ref || "",
            snapshot_content_hash: item.snapshot_content_hash || "",
            media_kind: "audio",
          });
        }
        return null;
      })
      .filter(Boolean);

    if (resolved.length === 0) return;

    const startIndex = startItem
      ? Math.max(0, resolved.findIndex((tr) => tr.name === startItem.media_asset_name))
      : 0;

    runtime.setQueue(resolved, { startIndex, autoplay: true });
    setPlaylistOpen(false);
  }

  playlistBackBtn.addEventListener("click", () => renderPlaylistList());

  // ── Visualizer controls ─────────────────────────────────────────
  function getRuntimeAudioElement() {
    try {
      const audioElement = typeof runtime.getAudioElement === "function"
        ? runtime.getAudioElement()
        : null;
      return audioElement && typeof audioElement.addEventListener === "function"
        ? audioElement
        : null;
    } catch {
      return null;
    }
  }

  function syncVisualizerUi({ sourceSafe = true } = {}) {
    visualizerStrip.hidden = !visualizerVisible;
    visualizerStrip.dataset.visualizerMode = visualizerMode;
    visualizerStrip.dataset.visualizerState = visualizerFailed
      ? "error"
      : visualizerVisible
        ? sourceSafe ? "ready" : "disabled"
        : "disabled";
    visualizerToggleBtn.classList.toggle("active", visualizerVisible);
    visualizerToggleBtn.setAttribute("aria-pressed", String(visualizerVisible));
    visualizerLabel.textContent = visualizerFailed || (visualizerVisible && !sourceSafe)
      ? t("mediaPlayerVisualizerUnavailable")
      : getVisualizerModeLabel(visualizerMode);
  }

  function getOrCreateVisualizer() {
    if (!visualizerVisible || visualizerFailed) return null;

    const audioElement = getRuntimeAudioElement();
    if (!audioElement || !isSafeVisualizerElement(audioElement)) return null;

    if (visualizerController && visualizerMediaElement === audioElement) {
      return visualizerController;
    }

    visualizerController?.destroy();
    visualizerController = createMiniAudioVisualizer({
      mediaElement: audioElement,
      mount: visualizerHost,
      mode: visualizerMode,
    });
    visualizerMediaElement = audioElement;

    if (!visualizerController.isAvailable) {
      visualizerFailed = true;
      visualizerController = null;
      visualizerMediaElement = null;
      syncVisualizerUi();
      return null;
    }

    return visualizerController;
  }

  function stopVisualizer() {
    visualizerController?.stop();
  }

  function destroyVisualizerController() {
    visualizerController?.destroy();
    visualizerController = null;
    visualizerMediaElement = null;
  }

  function syncVisualizerPlayback(stateSnapshot = runtime.getState()) {
    const audioElement = getRuntimeAudioElement();
    const hasPlayableSource = Boolean(
      stateSnapshot.currentTrack
        && stateSnapshot.sourceType
        && audioElement?.src,
    );
    const sourceSafe = isSafeVisualizerElement(audioElement);
    syncVisualizerUi({ sourceSafe });
    if (!hasPlayableSource) {
      stopVisualizer();
      destroyVisualizerController();
      return;
    }

    if (!visualizerVisible) {
      stopVisualizer();
      return;
    }

    // On iOS Safari, defer visualizer start until the first user gesture
    // so the AudioContext can transition to "running".
    if (!_gestureUnlocked) return;

    if (!sourceSafe) {
      destroyVisualizerController();
      return;
    }

    const controller = getOrCreateVisualizer();
    if (!controller) return;

    controller.setMode(visualizerMode);
    if (!stateSnapshot.playing || document.hidden) {
      controller.stop();
      return;
    }

    controller.start().then((started) => {
      if (!started || !controller.isAvailable) {
        visualizerFailed = true;
        controller.stop();
        syncVisualizerUi();
      }
    }).catch(() => {
      visualizerFailed = true;
      syncVisualizerUi();
    });
  }

  function setVisualizerVisible(visible) {
    visualizerVisible = Boolean(visible);
    saveText(VISUALIZER_VISIBLE_STORAGE_KEY, visualizerVisible ? "true" : "false");
    syncVisualizerPlayback();
  }

  visualizerToggleBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  visualizerToggleBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  visualizerToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    _gestureUnlocked = true;
    primeAudioContext();
    setVisualizerVisible(!visualizerVisible);
  });

  visualizerStrip.addEventListener("click", () => {
    _gestureUnlocked = true;
    primeAudioContext();
    if (visualizerFailed) return;
    visualizerMode = getNextVisualizerMode(visualizerMode);
    saveText(VISUALIZER_MODE_STORAGE_KEY, visualizerMode);
    visualizerController?.setMode(visualizerMode);
    syncVisualizerPlayback();
  });

  // ── Milkdrop panel (lazy) ──────────────────────────────────────
  let milkdropPanel = null;

  function syncMilkdropToggle() {
    const isOpen = milkdropPanel?.isOpen?.() === true;
    milkdropToggleBtn.classList.toggle("active", isOpen);
    milkdropToggleBtn.setAttribute("aria-pressed", String(isOpen));
  }

  function ensureMilkdropPanel() {
    if (!milkdropPanel) {
      milkdropPanel = createMilkdropPanel({
        mount: container,
        onOpen: syncMilkdropToggle,
        onClose: syncMilkdropToggle,
      });
    }
    syncMilkdropToggle();
    return milkdropPanel;
  }

  milkdropToggleBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  milkdropToggleBtn.addEventListener("pointerup", (e) => e.stopPropagation());
  milkdropToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ensureMilkdropPanel().toggle();
    syncMilkdropToggle();
  });

  syncMilkdropToggle();
  if (loadMilkdropPanelVisibility()) {
    ensureMilkdropPanel();
  }

  // ── Event wiring ───────────────────────────────────────────────
  playBtn.addEventListener("click", () => {
    // Pre-warm AudioContext synchronously from the user gesture so iOS
    // Safari allows it to enter the "running" state.  acquireGraph()
    // will reuse this context when the visualizer starts later.
    _gestureUnlocked = true;
    primeAudioContext();

    const s = runtime.getState();
    if (s.paused || !s.playing) {
      if (s.muted) runtime.setMuted(false);
      void runtime.play();
    } else {
      runtime.pause();
    }
  });

  prevBtn.addEventListener("click", () => {
    _gestureUnlocked = true;
    primeAudioContext();
    void runtime.previousTrack();
  });
  nextBtn.addEventListener("click", () => {
    _gestureUnlocked = true;
    primeAudioContext();
    void runtime.nextTrack();
  });
  shuffleBtn.addEventListener("click", () => runtime.toggleShuffle());
  repeatBtn.addEventListener("click", () => runtime.cycleRepeat());

  muteBtn.addEventListener("click", () => runtime.setMuted());
  volumeSlider.addEventListener("input", () => {
    updateRangeVisualFill(volumeSlider);
    runtime.setVolume(Number(volumeSlider.value) / 100);
  });

  progressBar.addEventListener("pointerdown", () => { seeking = true; });
  progressBar.addEventListener("input", () => {
    updateRangeVisualFill(progressBar);
    const s = runtime.getState();
    if (Number.isFinite(s.duration) && s.duration > 0) {
      const time = (Number(progressBar.value) / PROGRESS_MAX) * s.duration;
      timeCurrent.textContent = formatTime(time);
    }
  });
  progressBar.addEventListener("change", () => {
    const s = runtime.getState();
    if (Number.isFinite(s.duration) && s.duration > 0) {
      runtime.seekTo((Number(progressBar.value) / PROGRESS_MAX) * s.duration);
    }
    updateRangeVisualFill(progressBar);
    seeking = false;
  });

  searchInput.addEventListener("input", () => {
    queueFilter = searchInput.value.trim().toLowerCase();
    renderTrackList(queueFilter);
  });

  // ── Render helpers ─────────────────────────────────────────────

  let lastArtworkTrackName = "";

  function renderState(s) {
    // Play/pause
    playBtn.querySelector(".btn-icon").innerHTML = s.playing ? IconPause : IconPlay;
    playBtn.setAttribute("aria-label", s.playing ? t("mediaPlayerPause") : t("mediaPlayerPlay"));

    // Progress
    if (!seeking) {
      if (Number.isFinite(s.duration) && s.duration > 0) {
        progressBar.value = String(Math.round((s.currentTime / s.duration) * PROGRESS_MAX));
        timeCurrent.textContent = formatTime(s.currentTime);
        timeTotal.textContent = formatTime(s.duration);
      } else {
        progressBar.value = "0";
        timeCurrent.textContent = "0:00";
        timeTotal.textContent = "0:00";
      }
    }
    updateRangeVisualFill(progressBar);

    // Metadata
    const track = s.currentTrack;
    metaTitle.textContent = track?.title || track?.original_filename || t("playerNowPlaying");
    metaArtist.textContent = track?.artist || track?.folder_path || "";

    // Genre tag
    const genre = track?.genre || "";
    if (genre) {
      metaGenre.textContent = genre;
      metaGenre.hidden = false;
    } else {
      metaGenre.hidden = true;
    }

    // Compact artwork — resolve on track change via async artwork URL lookup
    const trackName = track?.name || "";
    if (trackName !== lastArtworkTrackName) {
      lastArtworkTrackName = trackName;
      artworkCompact.style.backgroundImage = "";
      artworkCompact.innerHTML = IconMusic;
      artworkCompact.classList.remove("has-image");

      if (track) {
        resolveArtworkUrl(track).then((artUrl) => {
          if (lastArtworkTrackName !== trackName) return;
          if (artUrl) {
            artworkCompact.innerHTML = "";
            artworkCompact.style.backgroundImage = `url(${CSS.escape(artUrl)})`;
            artworkCompact.classList.add("has-image");
            setMediaSessionMetadata({
              title: track.title || track.original_filename || track.name || "",
              artist: track.artist || track.folder_path || "",
              album: "VatioBoard",
              artworkUrl: artUrl,
            });
          }
        });
      }
    }

    // Source badge
    if (s.sourceType === "blob") {
      sourceBadge.textContent = t("playerOffline");
      sourceBadge.hidden = false;
      sourceBadge.className = "player-source-badge offline";
    } else if (s.sourceType === "remote") {
      sourceBadge.textContent = t("playerRemote");
      sourceBadge.hidden = false;
      sourceBadge.className = "player-source-badge remote";
    } else {
      sourceBadge.hidden = true;
    }

    // Shuffle / repeat
    shuffleBtn.classList.toggle("active", s.shuffle);
    repeatBtn.classList.toggle("active", s.repeat !== "off");
    if (s.repeat === "one") {
      repeatBtn.dataset.repeatMode = "one";
    } else {
      delete repeatBtn.dataset.repeatMode;
    }

    // Volume
    muteBtn.querySelector(".btn-icon").innerHTML = s.muted ? IconMuted : IconVolume;
    muteBtn.setAttribute("aria-label", s.muted ? t("mediaPlayerUnmute") : t("mediaPlayerMute"));
    volumeSlider.value = String(Math.round(s.volume * 100));
    updateRangeVisualFill(volumeSlider);

    // Loading/error
    root.classList.toggle("loading", s.loading);
    root.classList.toggle("error", Boolean(s.error));

    if (s.error) {
      errorMsg.textContent = s.error === "unavailable"
        ? t("playerTrackUnavailable")
        : t("playerPlaybackError");
      errorMsg.hidden = false;
    } else {
      errorMsg.hidden = true;
    }

    if (queueOpen) {
      const queueSignature = getQueueRenderSignature(s.queue);
      if (queueSignature !== lastRenderedQueueSignature) {
        renderTrackList(queueFilter);
      }
    }

    // Queue active indicator
    renderQueueActive(s.currentTrack?._queueId || s.currentTrack?.name || "");
    updateOfflineBadges(s.queue);
    syncVisualizerPlayback(s);
  }

  function renderTrackList(filter = queueFilter) {
    queueFilter = filter;
    trackListUl.innerHTML = "";
    const s = runtime.getState();
    // Up Next: always show the runtime queue, not the full catalog
    const source = s.queue;
    lastRenderedQueueSignature = getQueueRenderSignature(source);
    const normalizedFilter = String(filter || "").trim().toLowerCase();
    const tracks = normalizedFilter
      ? source.filter((tr) => {
          const hay = `${tr.title || ""} ${tr.artist || ""} ${tr.original_filename || ""} ${tr.folder_path || ""}`.toLowerCase();
          return hay.includes(normalizedFilter);
        })
      : source;

    if (tracks.length === 0) {
      const emptyLi = document.createElement("li");
      emptyLi.className = "player-queue-empty";
      emptyLi.textContent = t("playerNoTracks");
      trackListUl.append(emptyLi);
      return;
    }

    for (const track of tracks) {
      const li = document.createElement("li");
      li.className = "player-queue-item";
      li.dataset.trackName = track.name;
      li.dataset.queueId = track._queueId || track.name;
      if ((s.currentTrack?._queueId || s.currentTrack?.name) === (track._queueId || track.name)) {
        li.classList.add("active");
      }

      const nameSpan = document.createElement("span");
      nameSpan.className = "player-queue-item-name";
      nameSpan.textContent = track.title || track.original_filename || track.name;

      const artistSpan = document.createElement("span");
      artistSpan.className = "player-queue-item-artist";
      const qArtist = track.artist || "";
      const qAlbum = track.album || "";
      artistSpan.textContent = qAlbum
        ? (qArtist ? `${qArtist} · ${qAlbum}` : qAlbum)
        : qArtist;

      const durationSpan = document.createElement("span");
      durationSpan.className = "player-queue-item-duration";
      if (track.duration != null && Number.isFinite(track.duration)) {
        durationSpan.textContent = formatTime(track.duration);
      }

      const badge = document.createElement("span");
      badge.className = "player-queue-item-badge";
      if (track._offline) {
        badge.classList.add("offline");
        badge.title = t("playerOffline");
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "player-queue-remove-btn";
      removeBtn.textContent = "\u00d7";
      removeBtn.title = t("playerRemoveFromQueue");
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        runtime.removeFromQueue(track._queueId || track.name);
        renderTrackList(filter);
      });

      li.append(nameSpan, artistSpan, durationSpan, badge, removeBtn);
      li.addEventListener("click", () => {
        _gestureUnlocked = true;
        primeAudioContext();
        void runtime.playTrackByName(track._queueId || track.name);
      });

      trackListUl.append(li);
    }
  }

  function renderQueueActive(currentQueueId) {
    for (const li of trackListUl.children) {
      if (li.dataset?.queueId) {
        li.classList.toggle("active", li.dataset.queueId === currentQueueId);
      }
    }
  }

  function updateOfflineBadges(queue) {
    const newOffline = new Set();
    for (const track of queue) {
      if (track._offline) newOffline.add(track.name);
    }
    if (newOffline.size === 0) return;

    // Update existing badge DOM nodes without full re-render
    for (const li of trackListUl.children) {
      const name = li.dataset?.trackName;
      if (!name || !newOffline.has(name)) continue;
      const badge = li.querySelector(".player-queue-item-badge");
      if (badge && !badge.classList.contains("offline")) {
        badge.classList.add("offline");
        badge.title = t("playerOffline");
      }
    }

    // Sync allTracks so queue re-renders preserve the badge
    for (const track of allTracks) {
      if (newOffline.has(track.name)) track._offline = true;
    }
  }

  // ── Runtime subscription ───────────────────────────────────────
  const unsubscribe = runtime.subscribe(renderState);
  updateRangeVisualFill(progressBar);
  updateRangeVisualFill(volumeSlider);
  renderState(runtime.getState());

  // ── Public API ─────────────────────────────────────────────────
  return {
    /** The panel DOM element. */
    root,
    /** The header element (drag handle for the widget). */
    header,
    /** The now-playing row (secondary drag handle for the widget). */
    nowPlaying,
    /** The close button (widget wires its click handler). */
    closeBtn,

    destroy() {
      unsubscribe();
      clearQueueSaveStatusTimer();
      destroyVisualizerController();
      milkdropPanel?.destroy();
      milkdropPanel = null;
      root.remove();
    },

    setTracks(tracks) {
      allTracks = tracks;
      if (queueOpen) renderTrackList();
      if (libraryOpen) renderLibraryList(libraryFilter);
    },

    setPlaylists(playlists) {
      cachedPlaylists = Array.isArray(playlists) ? playlists : [];
      if (playlistOpen && !playlistDetailView) renderPlaylistList();
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeBtn(className, iconHtml, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("aria-label", label);
  const icon = document.createElement("span");
  icon.className = "btn-icon";
  icon.innerHTML = iconHtml;
  btn.append(icon);
  return btn;
}

function makeUtilityBtn(className, iconHtml, label, visibleLabel = label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `player-utility-btn ${className}`;
  btn.setAttribute("aria-label", label);
  btn.title = label;

  const icon = document.createElement("span");
  icon.className = "btn-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = iconHtml;

  const text = document.createElement("span");
  text.className = "player-utility-btn-label";
  text.textContent = visibleLabel;

  btn.addEventListener("pointerdown", (event) => event.stopPropagation());
  btn.addEventListener("pointerup", (event) => event.stopPropagation());

  btn.append(icon, text);
  return btn;
}

function makeTabBtn(tab, iconHtml, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `player-content-tab-btn player-content-tab-${tab}`;
  btn.dataset.contentTab = tab;
  btn.setAttribute("role", "tab");
  btn.setAttribute("aria-selected", "false");
  btn.setAttribute("tabindex", "-1");

  const icon = document.createElement("span");
  icon.className = "btn-icon";
  icon.innerHTML = iconHtml;

  const text = document.createElement("span");
  text.className = "player-content-tab-label";
  text.textContent = label;

  btn.append(icon, text);
  return btn;
}

function makeActionBtn(className, iconHtml, label, visibleLabel = label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("aria-label", label);
  btn.title = label;

  const icon = document.createElement("span");
  icon.className = "btn-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = iconHtml;

  const text = document.createElement("span");
  text.className = "player-action-label";
  text.textContent = visibleLabel;

  btn.addEventListener("pointerdown", (event) => event.stopPropagation());
  btn.addEventListener("pointerup", (event) => event.stopPropagation());

  btn.append(icon, text);
  return btn;
}
