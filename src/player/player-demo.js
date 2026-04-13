import "../styles/player.less";
import { applyTranslations } from "../i18n.js";
import { createPlayerShell } from "./player-shell.js";
import { loadAudioCatalog, syncAudioCatalog, annotateOfflineAvailability } from "../shared/audio-catalog.js";
import * as runtime from "../shared/audio-runtime.js";
import {
  getBackendSessionState,
  fetchBackendLoggedUser,
} from "../shared/backend-auth.js";
import {
  setMediaCacheUser,
  restorePersistedMediaCacheUser,
  clearPersistedMediaCacheUser,
} from "../shared/media-cache.js";

applyTranslations();

document.body.classList.add("player-page");

const container = document.getElementById("player-root");
const shell = createPlayerShell({ container });

/**
 * Bootstrap the media cache user namespace.
 *
 * Mirrors the library.js refreshAuthState pattern:
 *  1. Check backend session
 *  2. If authenticated → fetch logged user → setMediaCacheUser
 *  3. If unreachable → restorePersistedMediaCacheUser (offline fallback)
 *  4. If unauthenticated → clearPersistedMediaCacheUser
 */
async function bootstrapAuth() {
  try {
    const session = await getBackendSessionState();
    if (session.authenticated) {
      const loggedUser = await fetchBackendLoggedUser().catch(() => null);
      const user = loggedUser?.user || null;
      if (user) setMediaCacheUser(user);
    } else {
      clearPersistedMediaCacheUser();
    }
  } catch {
    // Backend unreachable — restore persisted namespace for offline mode
    restorePersistedMediaCacheUser();
  }
}

// Boot: auth → load catalog → annotate offline → populate shell → restore session
export const initPromise = (async () => {
  try {
    await bootstrapAuth();

    const { tracks } = await loadAudioCatalog();
    const annotated = await annotateOfflineAvailability(tracks);

    shell.setTracks(annotated);

    // Restore previous session (or do nothing if cold start)
    await runtime.restoreSession(annotated, { autoplay: false });

    // If no session restored, seed the full catalog as queue
    const s = runtime.getState();
    if (s.queue.length === 0 && annotated.length > 0) {
      runtime.setQueue(annotated, { autoplay: false });
    }

    // Non-blocking background revalidation — fetch latest manifest
    // and update the track list if new tracks are available.
    syncAudioCatalog().then(async (refreshed) => {
      if (!refreshed) return;
      try {
        const fresh = await loadAudioCatalog();
        const freshAnnotated = await annotateOfflineAvailability(fresh.tracks);
        if (freshAnnotated.length > 0) {
          shell.setTracks(freshAnnotated);
          // Only update the queue if the user hasn't started playing yet
          const current = runtime.getState();
          if (current.paused && current.currentIndex <= 0) {
            runtime.setQueue(freshAnnotated, { autoplay: false });
          }
        }
      } catch { /* ignore revalidation failures */ }
    }).catch(() => {});
  } catch {
    // Offline or no manifest — shell starts empty, user can retry later
  }
})();
