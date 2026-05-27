/**
 * Playlist cache.
 *
 * Persists the playlist manifest snapshot to IndexedDB so the player
 * can display playlist names and track listings while fully offline.
 *
 * Uses the same user-scoped namespace strategy as media-cache.js but
 * keeps its own IndexedDB database so the two caches are independently
 * clearable.
 */

import { createIndexedJsonKeyValueStore } from "./indexed-storage.js";
import { getMediaCacheUser } from "./media-cache.js";
import type { JsonObject } from "../types/storage";

export interface PlaylistManifestItem {
  media_asset_name?: string;
  position?: number;
  snapshot_title?: string;
  snapshot_artist?: string;
  snapshot_album?: string;
  snapshot_genre?: string;
  snapshot_duration?: number | null;
  snapshot_artwork_ref?: string;
  snapshot_content_hash?: string;
  [key: string]: unknown;
}

export interface PlaylistManifestEntry {
  name?: string;
  title?: string;
  item_count?: number;
  total_duration_seconds?: number;
  cover_asset_name?: string | null;
  created_at?: string | number | null;
  modified_at?: string | number | null;
  items?: PlaylistManifestItem[];
  [key: string]: unknown;
}

export interface PlaylistManifestSnapshot {
  playlists: PlaylistManifestEntry[];
  token: string | null;
}

interface PersistedPlaylistManifestSnapshot extends PlaylistManifestSnapshot {
  cached_at?: number;
}

export type PlaylistDetail = PlaylistManifestEntry;

const PLAYLIST_DB_NAME = "vatioboard_playlist_metadata";
const PLAYLIST_STORE_NAME = "playlist_metadata";

const playlistStore = createIndexedJsonKeyValueStore({
  dbName: PLAYLIST_DB_NAME,
  storeName: PLAYLIST_STORE_NAME,
});

function userKey(key: string): string | null {
  const user = getMediaCacheUser();
  if (!user) return null;
  return `${user}:${key}`;
}

// ── Manifest snapshot ────────────────────────────────────────────────

/**
 * Persist the full playlists manifest atomically — playlists array and
 * freshness token written as a single IndexedDB record.
 */
export async function cachePlaylistsManifestSnapshot({
  playlists,
  token = null,
}: {
  playlists: PlaylistManifestEntry[];
  token?: string | null;
}): Promise<boolean> {
  const key = userKey("__playlists_manifest__");
  if (!key || !Array.isArray(playlists)) return false;
  return playlistStore.setValue(key, {
    playlists: playlists.map(mapPlaylistEntry),
    token: token || null,
    cached_at: Date.now(),
  } as JsonObject);
}

/**
 * Return the full playlists manifest snapshot (playlists + token).
 * Returns ``null`` when nothing is stored.
 */
export async function getCachedPlaylistsManifestSnapshot(): Promise<PlaylistManifestSnapshot | null> {
  const key = userKey("__playlists_manifest__");
  if (!key) return null;
  const result = await playlistStore.getValue(key) as unknown as PersistedPlaylistManifestSnapshot | undefined;
  if (!result?.playlists) return null;
  return { playlists: result.playlists, token: result.token || null };
}

/** Convenience — returns the cached playlists array or null. */
export async function getCachedPlaylistsList(): Promise<PlaylistManifestEntry[] | null> {
  const snapshot = await getCachedPlaylistsManifestSnapshot();
  return snapshot?.playlists || null;
}

/** Convenience — returns the cached freshness token or null. */
export async function getCachedPlaylistsToken(): Promise<string | null> {
  const snapshot = await getCachedPlaylistsManifestSnapshot();
  return snapshot?.token || null;
}

// ── Individual playlist detail ───────────────────────────────────────

/**
 * Cache a single playlist detail for offline display (includes items).
 */
export async function cachePlaylistDetail(
  playlistName: string,
  detail: PlaylistManifestEntry | null | undefined,
): Promise<boolean> {
  const key = userKey(`detail:${playlistName}`);
  if (!key || !detail) return false;
  return playlistStore.setValue(key, {
    ...detail,
    cached_at: Date.now(),
  } as JsonObject);
}

/**
 * Return cached detail for a single playlist, or null.
 */
export async function getCachedPlaylistDetail(playlistName: string): Promise<PlaylistDetail | null> {
  const key = userKey(`detail:${playlistName}`);
  if (!key) return null;
  const result = await playlistStore.getValue(key) as PlaylistDetail | undefined;
  return result ?? null;
}

/**
 * Fan out a manifest response into per-playlist detail cache entries.
 *
 * Each manifest playlist that carries an ``items`` array is cached as
 * an individual detail entry so ``loadPlaylistDetail()`` can resolve
 * offline without a separate ``getBackendPlaylistDetail`` call.
 */
export async function fanOutManifestDetails(playlists: PlaylistManifestEntry[] | null | undefined): Promise<void> {
  if (!Array.isArray(playlists)) return;
  const user = getMediaCacheUser();
  if (!user) return;
  const promises = [];
  for (const pl of playlists) {
    if (!pl?.name || !Array.isArray(pl.items)) continue;
    promises.push(cachePlaylistDetail(pl.name, pl).catch(() => {}));
  }
  await Promise.all(promises);
}

// ── Helpers ──────────────────────────────────────────────────────────

function mapPlaylistEntry(playlist: PlaylistManifestEntry): PlaylistManifestEntry {
  return {
    name: playlist.name,
    title: playlist.title,
    item_count: playlist.item_count ?? 0,
    total_duration_seconds: playlist.total_duration_seconds ?? 0,
    cover_asset_name: playlist.cover_asset_name ?? null,
    created_at: playlist.created_at ?? null,
    modified_at: playlist.modified_at ?? null,
    items: Array.isArray(playlist.items) ? playlist.items.map(mapPlaylistItem) : undefined,
  };
}

function mapPlaylistItem(item: PlaylistManifestItem): PlaylistManifestItem {
  return {
    media_asset_name: item.media_asset_name,
    position: item.position ?? 0,
    snapshot_title: item.snapshot_title || "",
    snapshot_artist: item.snapshot_artist || "",
    snapshot_album: item.snapshot_album || "",
    snapshot_genre: item.snapshot_genre || "",
    snapshot_duration: item.snapshot_duration ?? null,
    snapshot_artwork_ref: item.snapshot_artwork_ref || "",
    snapshot_content_hash: item.snapshot_content_hash || "",
  };
}
