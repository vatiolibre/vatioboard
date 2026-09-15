import { recordBackgroundDiagnostic } from "./background-diagnostics.js";

/**
 * Media Session adapter.
 *
 * Wraps the Media Session API behind a safe facade so consumers do not
 * need to feature-detect or handle partial implementations.  Designed
 * to be shared across pages (player, speed, future integrations).
 *
 * The adapter does NOT own the audio element — it receives playback
 * state updates from the caller and forwards them to the platform.
 */

export interface MediaSessionMetadataPayload {
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  artwork?: MediaImage[];
  fallbackArtwork?: MediaImage[];
}

export interface MediaSessionPositionPayload {
  duration: number;
  position: number;
  playbackRate?: number;
}

export type MediaSessionHandlers = Partial<Record<MediaSessionAction, MediaSessionActionHandler | null>>;

interface MediaSessionClient {
  owner: string;
  active: boolean;
  priority: number;
  metadata: MediaSessionMetadataPayload | null;
  playbackState: MediaSessionPlaybackState;
  handlers: MediaSessionHandlers | null;
  positionState: MediaSessionPositionPayload | null;
  sequence: number;
}

function supported(): boolean {
  return "mediaSession" in navigator;
}

function supportsMetadata(): boolean {
  return supported() && typeof window.MediaMetadata === "function";
}

const DEFAULT_OWNER = "default";
const mediaSessionClients = new Map<string, MediaSessionClient>();
let mediaSessionClientSequence = 0;
let platformPositionStateActive = false;
let appliedOwner: string | null = null;
let appliedPlaybackState: MediaSessionPlaybackState | null = null;
let appliedMetadataKey: string | null = null;
let appliedHandlers: MediaSessionHandlers | null = null;
let appliedPositionKey: string | null = null;

const FALLBACK_ARTWORK: MediaImage[] = [
  { src: "/web-app-manifest-192x192.png", sizes: "192x192", type: "image/png" },
  { src: "/web-app-manifest-512x512.png", sizes: "512x512", type: "image/png" },
];

const ACTION_NAMES: MediaSessionAction[] = [
  "play", "pause", "stop",
  "previoustrack", "nexttrack",
  "seekbackward", "seekforward", "seekto",
];

function normalizeOwner(owner: string | null | undefined): string {
  return String(owner || DEFAULT_OWNER).trim() || DEFAULT_OWNER;
}

function getClient(owner: string | null | undefined): MediaSessionClient {
  const normalizedOwner = normalizeOwner(owner);
  if (!mediaSessionClients.has(normalizedOwner)) {
    mediaSessionClients.set(normalizedOwner, {
      owner: normalizedOwner,
      active: true,
      priority: 0,
      metadata: null,
      playbackState: "none",
      handlers: null,
      positionState: null,
      sequence: 0,
    });
  }

  return mediaSessionClients.get(normalizedOwner);
}

function getTopClient(): MediaSessionClient | null {
  let topClient: MediaSessionClient | null = null;

  for (const client of mediaSessionClients.values()) {
    if (client.active === false) continue;

    if (
      !topClient ||
      client.priority > topClient.priority ||
      (client.priority === topClient.priority && client.sequence > topClient.sequence)
    ) {
      topClient = client;
    }
  }

  return topClient;
}

function buildArtwork(metadata: MediaSessionMetadataPayload = {}): MediaImage[] {
  if (Array.isArray(metadata.artwork)) {
    return metadata.artwork.length > 0
      ? metadata.artwork
      : [...FALLBACK_ARTWORK];
  }

  return metadata.artworkUrl
    ? [{ src: metadata.artworkUrl }, ...FALLBACK_ARTWORK]
    : [...FALLBACK_ARTWORK];
}

function metadataKey(metadata: MediaSessionMetadataPayload | null): string {
  if (!metadata) return "null";
  return JSON.stringify({
    title: metadata.title || "",
    artist: metadata.artist || "",
    album: metadata.album || "",
    artworkUrl: metadata.artworkUrl || "",
    artwork: buildArtwork(metadata).map((image) => ({
      src: image.src,
      sizes: image.sizes || "",
      type: image.type || "",
    })),
  });
}

function handlersEqual(left: MediaSessionHandlers | null, right: MediaSessionHandlers | null): boolean {
  return ACTION_NAMES.every((action) => (left?.[action] ?? null) === (right?.[action] ?? null));
}

function positionKey(position: MediaSessionPositionPayload | null): string {
  if (!position) return "null";
  return `${position.duration}:${position.position}:${position.playbackRate || 1}`;
}

function applyPlatformMediaSessionMetadata(metadata: MediaSessionMetadataPayload | null): void {
  if (!supportsMetadata()) return;

  if (!metadata) {
    try { navigator.mediaSession.metadata = null; } catch { /* ignore */ }
    return;
  }

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: metadata.title || "",
      artist: metadata.artist || "",
      album: metadata.album || "",
      artwork: buildArtwork(metadata),
    });
  } catch {
    if (!Array.isArray(metadata.fallbackArtwork)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata.title || "",
        artist: metadata.artist || "",
        album: metadata.album || "",
        artwork: metadata.fallbackArtwork,
      });
    } catch {
      // Partial implementations may throw
    }
  }
}

function applyPlatformMediaSessionPlaybackState(state: MediaSessionPlaybackState): void {
  if (!supported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch { /* ignore */ }
}

function applyPlatformMediaSessionPositionState({
  duration,
  position,
  playbackRate = 1,
}: Partial<MediaSessionPositionPayload> = {}): void {
  if (!supported()) return;
  if (typeof navigator.mediaSession.setPositionState !== "function") return;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)
    || !Number.isFinite(playbackRate) || playbackRate <= 0) {
    clearPlatformMediaSessionPositionState();
    return;
  }
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.max(0, Math.min(position, duration)),
      playbackRate,
    });
    platformPositionStateActive = true;
  } catch { /* ignore */ }
}

function clearPlatformMediaSessionPositionState(): void {
  if (!platformPositionStateActive || !supported()) return;
  if (typeof navigator.mediaSession.setPositionState !== "function") return;
  try {
    navigator.mediaSession.setPositionState();
  } catch { /* ignore */ }
  platformPositionStateActive = false;
}

function applyPlatformMediaSessionActionHandlers(handlers: MediaSessionHandlers | null = {}): void {
  if (!supported()) return;

  for (const action of ACTION_NAMES) {
    const handler = handlers?.[action] ?? null;
    try {
      navigator.mediaSession.setActionHandler(action, handler ? (details) => {
        recordBackgroundDiagnostic("media-session-action", { action });
        // Resolve the current owner and handler at dispatch time, including handoffs.
        getTopClient()?.handlers?.[action]?.(details);
      } : null);
    } catch {
      // Some browsers do not support all actions
    }
  }
}

function applyMediaSessionClients(): void {
  const topClient = getTopClient();
  const owner = topClient?.owner || null;
  const ownerChanged = owner !== appliedOwner;

  if (!topClient) {
    if (ownerChanged || appliedPlaybackState !== "none") applyPlatformMediaSessionPlaybackState("none");
    if (ownerChanged || appliedMetadataKey !== "null") applyPlatformMediaSessionMetadata(null);
    if (ownerChanged || !handlersEqual(appliedHandlers, null)) applyPlatformMediaSessionActionHandlers(null);
    if (ownerChanged || appliedPositionKey !== "null") clearPlatformMediaSessionPositionState();
    appliedOwner = null;
    appliedPlaybackState = "none";
    appliedMetadataKey = "null";
    appliedHandlers = null;
    appliedPositionKey = "null";
    return;
  }

  const playbackState = topClient.playbackState || "none";
  const nextMetadataKey = metadataKey(topClient.metadata);
  const nextPositionKey = positionKey(topClient.positionState);
  if (ownerChanged || playbackState !== appliedPlaybackState) {
    applyPlatformMediaSessionPlaybackState(playbackState);
  }
  if (ownerChanged || nextMetadataKey !== appliedMetadataKey) {
    applyPlatformMediaSessionMetadata(topClient.metadata);
  }
  if (ownerChanged || !handlersEqual(appliedHandlers, topClient.handlers)) {
    applyPlatformMediaSessionActionHandlers(topClient.handlers);
  }

  if (ownerChanged || nextPositionKey !== appliedPositionKey) {
    if (topClient.positionState) {
      applyPlatformMediaSessionPositionState(topClient.positionState);
    } else {
      clearPlatformMediaSessionPositionState();
    }
  }
  appliedOwner = owner;
  appliedPlaybackState = playbackState;
  appliedMetadataKey = nextMetadataKey;
  appliedHandlers = topClient.handlers ? { ...topClient.handlers } : null;
  appliedPositionKey = nextPositionKey;
}

export function updateMediaSessionClient(
  owner: string | null | undefined,
  patch: Partial<Omit<MediaSessionClient, "owner" | "sequence">> = {},
): void {
  const client = getClient(owner);
  Object.assign(client, patch);
  client.owner = normalizeOwner(owner);
  client.sequence = ++mediaSessionClientSequence;
  applyMediaSessionClients();
}

export function clearMediaSessionClient(owner: string | null | undefined): void {
  mediaSessionClients.delete(normalizeOwner(owner));
  applyMediaSessionClients();
}

/**
 * Update the lock-screen / notification metadata for the current track.
 *
 * @param {{ title?: string, artist?: string, album?: string, artworkUrl?: string }} meta
 */
export function setMediaSessionMetadata({
  title = "",
  artist = "",
  album = "",
  artworkUrl = "",
}: MediaSessionMetadataPayload = {}): void {
  updateMediaSessionClient(DEFAULT_OWNER, {
    metadata: { title, artist, album, artworkUrl },
  });
}

/**
 * Update the playback state shown on the lock screen.
 *
 * @param {"none"|"paused"|"playing"} state
 */
export function setMediaSessionPlaybackState(state: MediaSessionPlaybackState): void {
  updateMediaSessionClient(DEFAULT_OWNER, { playbackState: state });
}

/**
 * Update the position state (progress bar on lock screen).
 *
 * @param {{ duration: number, position: number, playbackRate?: number }} pos
 */
export function setMediaSessionPositionState({
  duration,
  position,
  playbackRate = 1,
}: MediaSessionPositionPayload): void {
  updateMediaSessionClient(DEFAULT_OWNER, {
    positionState: { duration, position, playbackRate },
  });
}

/**
 * Bind Media Session action handlers.
 * Pass null for an action to release it.
 *
 * @param {Record<string, Function|null>} handlers
 */
export function setMediaSessionActionHandlers(handlers: MediaSessionHandlers | null): void {
  updateMediaSessionClient(DEFAULT_OWNER, { handlers });
}

/**
 * Clear all Media Session state (metadata, handlers, playback state).
 */
export function clearMediaSession(): void {
  mediaSessionClients.clear();
  applyMediaSessionClients();
}
