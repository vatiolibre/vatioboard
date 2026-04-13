import { createMediaPlayer } from "../shared/media-player.js";
import { isVisualizerSafeSource } from "../shared/audio-visualizer.js";

/**
 * Library-specific media player integration.
 *
 * Manages a single active media player instance within the library detail
 * preview. Handles URL resolution (remote vs pinned blob) and lifecycle.
 *
 * @returns {{ mount, destroy, isActive }}
 */
export function createLibraryMediaPlayer() {
  let activePlayer = null;
  let activeBlobUrl = null;

  /**
   * Mount a media player into the given container for the specified item.
   *
   * @param {object} options
   * @param {HTMLElement} options.container - DOM element to mount into
   * @param {object} options.item - Cloud library media item
   * @param {string} [options.blobUrl] - Local pinned blob URL (takes priority)
   * @returns {boolean} true if player was created
   */
  function mount({ container, item, blobUrl = "", onFirstRemotePlay = null }) {
    destroy();

    const mediaKind = String(item?.media_kind || "").toLowerCase();
    if (mediaKind !== "audio" && mediaKind !== "video") return false;

    const remoteUrl = item?.playback_url || item?.download_url || item?.downloadUrl || item?.image_url || "";
    const src = blobUrl || remoteUrl;
    if (!src) return false;

    if (blobUrl) {
      activeBlobUrl = blobUrl;
    }

    const posterUrl = mediaKind === "video" ? (item?.image_url || item?.preview_image_url || "") : "";

    activePlayer = createMediaPlayer({
      container,
      src,
      kind: mediaKind,
      title: item.title || item.name || "",
      posterUrl,
      visualizer: mediaKind === "audio" && isVisualizerSafeSource(src),
      onFirstRemotePlay,
    });

    return Boolean(activePlayer);
  }

  /**
   * Tear down the active player and revoke any blob URL.
   */
  function destroy() {
    if (activePlayer) {
      activePlayer.destroy();
      activePlayer = null;
    }
    if (activeBlobUrl) {
      URL.revokeObjectURL(activeBlobUrl);
      activeBlobUrl = null;
    }
  }

  /**
   * Whether a media player is currently mounted.
   */
  function isActive() {
    return Boolean(activePlayer);
  }

  /**
   * Return the underlying HTMLMediaElement, or null if no player is active.
   */
  function getMediaElement() {
    return activePlayer?.mediaElement ?? null;
  }

  return { mount, destroy, isActive, getMediaElement };
}
